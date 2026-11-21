use crate::model::{LogLevel, LogcatLine};

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
        tag: Some(tag.to_string()),
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
        assert!(split_lines_lossy(&[0xff, b'a', b'\n']).len() == 1);
    }

    // FR-006
    #[test]
    fn split_lines_strips_carriage_returns_and_trailing_empty_line() {
        let lines = split_lines_lossy(b"one\r\ntwo\n");
        assert_eq!(lines, vec!["one".to_string(), "two".to_string()]);
    }
}
