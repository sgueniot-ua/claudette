use std::io;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStdout};

use crate::model::{LogLevel, LogcatLine};

/// Lines asked from the device buffer when a session starts on a device (FR-006b).
pub const INITIAL_TAIL: u32 = 500;
/// A batch is emitted as soon as it holds this many lines (R3).
pub const BATCH_MAX_LINES: usize = 500;
/// A partial batch is emitted at most this long after its first line arrived (R3).
pub const BATCH_MAX_DELAY: Duration = Duration::from_millis(50);

/// Where `logcat -T` starts: the last `n` lines, or every line since a timestamp (resume, FR-009).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TailFrom {
    Count(u32),
    Since(String),
}

/// Arguments of `adb` for a logcat stream. The timestamp is one argument, without shell quoting.
pub fn logcat_args(serial: &str, tail: &TailFrom) -> Vec<String> {
    let tail = match tail {
        TailFrom::Count(count) => count.to_string(),
        TailFrom::Since(ts) => ts.clone(),
    };
    ["-s", serial, "logcat", "-v", "threadtime", "-T", &tail]
        .iter()
        .map(|arg| arg.to_string())
        .collect()
}

/// Raw stdout of a running logcat. Dropping it ends the stream.
// async_trait's expansion marks the boxed futures `#[must_use]`, which newer
// clippy flags as `double_must_use` on the generated trait methods.
#[allow(clippy::double_must_use)]
#[async_trait::async_trait]
pub trait LogcatStream: Send {
    /// Next chunk of bytes, `None` once the output ended. Must be cancel-safe (used in `select!`).
    async fn next_chunk(&mut self) -> Option<Vec<u8>>;
}

struct ProcessLogcatStream {
    // Held so `kill_on_drop` kills the process when the stream is dropped.
    _child: Child,
    stdout: ChildStdout,
    buf: Box<[u8]>,
}

#[async_trait::async_trait]
impl LogcatStream for ProcessLogcatStream {
    async fn next_chunk(&mut self) -> Option<Vec<u8>> {
        match self.stdout.read(&mut self.buf).await {
            Ok(0) | Err(_) => None,
            Ok(n) => Some(self.buf[..n].to_vec()),
        }
    }
}

/// Start `adb -s <serial> logcat -v threadtime -T <tail>`; the process is killed when the stream drops.
pub fn spawn_logcat(
    adb: &Path,
    serial: &str,
    tail: &TailFrom,
) -> io::Result<Box<dyn LogcatStream>> {
    let mut cmd = crate::process::command(adb);
    cmd.args(logcat_args(serial, tail));
    crate::env::enriched_env().apply(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("logcat stdout not captured"))?;
    Ok(Box::new(ProcessLogcatStream {
        _child: child,
        stdout,
        buf: vec![0; 64 * 1024].into_boxed_slice(),
    }))
}

/// Turns stdout chunks into parsed lines, grouped in batches of at most [`BATCH_MAX_LINES`].
/// Bytes after the last newline (partial line or partial UTF-8 character) wait for the next chunk.
#[derive(Debug, Default)]
pub struct LineBatcher {
    carry: Vec<u8>,
    pending: Vec<LogcatLine>,
    last_ts: Option<String>,
    /// Lines received with the timestamp `last_ts` (`logcat -T` is inclusive, FR-009).
    last_ts_lines: Vec<LogcatLine>,
    /// Lines of the previous process still expected at the start of a resumed one.
    replayed: Vec<LogcatLine>,
}

impl LineBatcher {
    /// Add a chunk; returns the full batches ready to emit now. Remaining lines stay pending.
    pub fn push_chunk(&mut self, chunk: &[u8]) -> Vec<Vec<LogcatLine>> {
        self.carry.extend_from_slice(chunk);
        if let Some(end) = self.carry.iter().rposition(|&b| b == b'\n') {
            let complete: Vec<u8> = self.carry.drain(..=end).collect();
            for line in split_lines_lossy(&complete) {
                self.push_line(&line);
            }
        }
        let mut full = Vec::new();
        while self.pending.len() >= BATCH_MAX_LINES {
            let rest = self.pending.split_off(BATCH_MAX_LINES);
            full.push(std::mem::replace(&mut self.pending, rest));
        }
        full
    }

    /// Take every pending line (deadline flush).
    pub fn take_pending(&mut self) -> Vec<LogcatLine> {
        std::mem::take(&mut self.pending)
    }

    /// End of the stream: the unterminated tail becomes a last line; returns everything pending.
    pub fn finish(&mut self) -> Vec<LogcatLine> {
        let tail = std::mem::take(&mut self.carry);
        for line in split_lines_lossy(&tail) {
            self.push_line(&line);
        }
        self.take_pending()
    }

    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// Timestamp of the last parsed line that had one (resume point, FR-009).
    pub fn last_ts(&self) -> Option<&str> {
        self.last_ts.as_deref()
    }

    /// A new process for the same device: drop the partial line of the previous one, keep the
    /// resume point. When `resume` (started with `-T <ts>`), the lines it replays from the last
    /// timestamp are dropped (FR-009).
    pub fn start_stream(&mut self, resume: bool) {
        self.carry.clear();
        self.replayed = if resume {
            self.last_ts_lines.clone()
        } else {
            Vec::new()
        };
    }

    fn push_line(&mut self, raw: &str) {
        let line = parse_threadtime_line(raw);
        if !self.replayed.is_empty() {
            if let Some(pos) = self.replayed.iter().position(|seen| *seen == line) {
                self.replayed.remove(pos);
                return;
            }
            self.replayed.clear();
        }
        if let Some(ts) = &line.ts {
            if self.last_ts.as_ref() != Some(ts) {
                self.last_ts = Some(ts.clone());
                self.last_ts_lines.clear();
            }
            self.last_ts_lines.push(line.clone());
        }
        self.pending.push(line);
    }
}

/// Split raw logcat bytes into lines. Invalid UTF-8 is replaced, `\r` is dropped.
pub fn split_lines_lossy(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect()
}

/// Parse one `logcat -v threadtime` line: `MM-DD HH:MM:SS.mmm PID TID L TAG: message`.
/// A line that does not match this shape keeps its raw text as `message`.
pub fn parse_threadtime_line(line: &str) -> LogcatLine {
    parse_fields(line).unwrap_or_else(|| LogcatLine {
        ts: None,
        pid: None,
        tid: None,
        level: None,
        tag: None,
        message: line.to_string(),
    })
}

fn parse_fields(line: &str) -> Option<LogcatLine> {
    let mut rest = line;
    let date = next_token(&mut rest)?;
    let time = next_token(&mut rest)?;
    let pid = next_token(&mut rest)?.parse::<u32>().ok()?;
    let tid = next_token(&mut rest)?.parse::<u32>().ok()?;
    let level = parse_level(next_token(&mut rest)?)?;
    let (tag, message) = rest.trim_start().split_once(": ")?;
    Some(LogcatLine {
        ts: Some(format!("{date} {time}")),
        pid: Some(pid),
        tid: Some(tid),
        level: Some(level),
        tag: Some(tag.trim_end().to_string()),
        message: message.to_string(),
    })
}

/// Take the next whitespace-separated token and advance `rest` past it.
fn next_token<'a>(rest: &mut &'a str) -> Option<&'a str> {
    let trimmed = rest.trim_start();
    let end = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());
    let (token, tail) = trimmed.split_at(end);
    *rest = tail;
    (!token.is_empty()).then_some(token)
}

fn parse_level(token: &str) -> Option<LogLevel> {
    Some(match token {
        "V" => LogLevel::V,
        "D" => LogLevel::D,
        "I" => LogLevel::I,
        "W" => LogLevel::W,
        "E" => LogLevel::E,
        "F" => LogLevel::F,
        "A" => LogLevel::A,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // FR-006
    #[test]
    fn threadtime_line_fills_every_field() {
        let l = parse_threadtime_line(
            "11-21 10:15:02.123  1234  1250 W ActivityManager: Slow operation",
        );
        assert_eq!(l.ts.as_deref(), Some("11-21 10:15:02.123"));
        assert_eq!(l.pid, Some(1234));
        assert_eq!(l.tid, Some(1250));
        assert_eq!(l.level, Some(LogLevel::W));
        assert_eq!(l.tag.as_deref(), Some("ActivityManager"));
        assert_eq!(l.message, "Slow operation");
    }

    // FR-006
    #[test]
    fn non_threadtime_line_keeps_raw_text_as_message() {
        let h = parse_threadtime_line("--------- beginning of main");
        assert_eq!(h.ts, None);
        assert_eq!(h.pid, None);
        assert_eq!(h.level, None);
        assert_eq!(h.tag, None);
        assert_eq!(h.message, "--------- beginning of main");
    }

    // FR-006
    #[test]
    fn unknown_level_letter_keeps_raw_text_as_message() {
        let raw = "11-21 10:15:02.123  1234  1250 X Tag: body";
        let l = parse_threadtime_line(raw);
        assert_eq!(l.level, None);
        assert_eq!(l.message, raw);
    }

    // FR-006
    #[test]
    fn message_may_contain_colons_and_spaces() {
        let l = parse_threadtime_line("11-21 10:15:02.123  1  1 E Tag: a: b c");
        assert_eq!(l.tag.as_deref(), Some("Tag"));
        assert_eq!(l.message, "a: b c");
    }

    // FR-006 (pas de panique, ligne très longue)
    #[test]
    fn very_long_line_is_parsed_without_truncation() {
        let long = format!("11-21 10:15:02.123  1  1 I T: {}", "x".repeat(20_000));
        assert_eq!(parse_threadtime_line(&long).message.len(), 20_000);
    }

    // FR-006 (pas de panique sur octets invalides)
    #[test]
    fn invalid_utf8_is_split_into_lossy_lines() {
        let lines = split_lines_lossy(&[0xff, b'a', b'\n']);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains('\u{FFFD}'));
    }

    // FR-006
    #[test]
    fn parse_threadtime_trims_padded_tag() {
        let l = parse_threadtime_line("11-21 10:15:02.123  1234  1250 I chatty  : uid=1000");
        assert_eq!(l.tag.as_deref(), Some("chatty"));
        assert_eq!(l.message, "uid=1000");
    }

    // FR-006
    #[test]
    fn split_lines_strips_carriage_returns_and_trailing_empty_line() {
        let lines = split_lines_lossy(b"one\r\ntwo\n");
        assert_eq!(lines, vec!["one".to_string(), "two".to_string()]);
    }

    // R3 (lots de 500 lignes, ligne coupée gardée pour le morceau suivant)
    #[test]
    fn batcher_splits_full_batches_and_keeps_partial_line() {
        let mut batcher = LineBatcher::default();
        let mut bytes: Vec<u8> = (0..501)
            .flat_map(|i| format!("11-21 10:15:02.{:03}  1  1 I T: {i}\n", i % 1000).into_bytes())
            .collect();
        bytes.extend_from_slice(b"11-21 10:15:03.000  1  1 I T: par");
        let full = batcher.push_chunk(&bytes);
        assert_eq!(full.len(), 1);
        assert_eq!(full[0].len(), BATCH_MAX_LINES);
        assert_eq!(batcher.take_pending().len(), 1);
        assert_eq!(batcher.last_ts(), Some("11-21 10:15:02.500"));
        let rest = batcher.finish();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].message, "par");
        assert_eq!(batcher.last_ts(), Some("11-21 10:15:03.000"));
    }

    // FR-009 (reprise `-T` inclusive : les lignes rejouées de la fin déjà reçue sont écartées)
    #[test]
    fn resumed_stream_drops_replayed_tail_lines() {
        let mut batcher = LineBatcher::default();
        batcher.push_chunk(b"11-21 10:15:02.123  1  1 I T: a\n11-21 10:15:02.123  1  1 I T: b\n");
        batcher.take_pending();
        batcher.start_stream(true);
        batcher.push_chunk(
            b"11-21 10:15:02.123  1  1 I T: a\n11-21 10:15:02.123  1  1 I T: b\n11-21 10:15:02.123  1  1 I T: new\n",
        );
        let lines = batcher.take_pending();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].message, "new");
    }

    // FR-009 (un nouveau processus sans reprise garde toutes ses lignes)
    #[test]
    fn fresh_stream_keeps_every_line() {
        let mut batcher = LineBatcher::default();
        batcher.push_chunk(b"11-21 10:15:02.123  1  1 I T: a\n");
        batcher.take_pending();
        batcher.start_stream(false);
        batcher.push_chunk(b"11-21 10:15:02.123  1  1 I T: a\n");
        assert_eq!(batcher.take_pending().len(), 1);
    }

    // FR-009 (horodatage passé en un seul argument, sans guillemets)
    #[test]
    fn logcat_args_since_timestamp_is_one_argument() {
        assert_eq!(
            logcat_args("R58M12345", &TailFrom::Since("11-21 10:15:02.123".into())),
            [
                "-s",
                "R58M12345",
                "logcat",
                "-v",
                "threadtime",
                "-T",
                "11-21 10:15:02.123"
            ]
        );
    }

    // R3 (vrai processus : arguments transmis, sortie lue en octets)
    #[cfg(unix)]
    #[tokio::test]
    async fn spawn_logcat_runs_adb_with_logcat_args() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let adb = dir.path().join("adb");
        std::fs::write(&adb, "#!/bin/sh\necho \"$@\"\n").unwrap();
        std::fs::set_permissions(&adb, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut stream =
            spawn_logcat(&adb, "emulator-5560", &TailFrom::Count(INITIAL_TAIL)).unwrap();
        let mut out = Vec::new();
        while let Some(chunk) = stream.next_chunk().await {
            out.extend(chunk);
        }
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "-s emulator-5560 logcat -v threadtime -T 500\n"
        );
    }
}
