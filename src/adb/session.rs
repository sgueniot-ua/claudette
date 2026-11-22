//! Per-workspace logcat sessions (R3, R12): one task and one `adb logcat` process per workspace,
//! re-resolved on every device-list change, resumed after a disconnection.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use super::logcat::{BATCH_MAX_DELAY, INITIAL_TAIL, LineBatcher, LogcatStream, TailFrom};
use super::monitor::DeviceList;
use super::resolve::{matches_key, resolve_device};
pub use super::runner::{AdbRunner, ProcessAdbRunner};
use crate::model::{
    AdbDevice, AdbDeviceState, AdbSessionStatus, DeviceKey, LogcatLine, Resolution,
    ResolutionSource, WaitReason,
};

/// Receives what sessions produce; Task 6 forwards it as Tauri events.
pub trait AdbSink: Send + Sync {
    /// A batch of lines. `reset: true` (sent with an empty batch when the session switches to
    /// another device) means the lines shown so far belong to the previous device.
    fn lines(&self, workspace_id: &str, lines: Vec<LogcatLine>, reset: bool);
    fn status(&self, workspace_id: &str, status: AdbSessionStatus);
    fn devices(&self, devices: &[AdbDevice]);
}

/// What `open` needs to start a workspace session.
#[derive(Debug, Clone)]
pub struct SessionContext {
    pub workspace_id: String,
    pub worktree: PathBuf,
    pub manual: Option<DeviceKey>,
}

/// All logcat sessions of the app, keyed by workspace id.
pub struct AdbSessions {
    runner: Arc<dyn AdbRunner>,
    sink: Arc<dyn AdbSink>,
    devices_tx: Arc<watch::Sender<DeviceList>>,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    sessions: HashMap<String, SessionHandle>,
    monitor: Option<JoinHandle<()>>,
}

struct SessionHandle {
    manual_tx: mpsc::UnboundedSender<Option<DeviceKey>>,
    status_rx: watch::Receiver<Option<AdbSessionStatus>>,
    task: JoinHandle<()>,
}

impl AdbSessions {
    pub fn new(runner: Arc<dyn AdbRunner>, sink: Arc<dyn AdbSink>) -> Arc<Self> {
        Arc::new(Self {
            runner,
            sink,
            devices_tx: Arc::new(watch::channel(None).0),
            state: Mutex::new(State::default()),
        })
    }

    /// Start the workspace session, or join the running one (idempotent: one task and one logcat
    /// process per workspace). Returns the session status once the first resolution is done.
    pub async fn open(&self, ctx: SessionContext) -> AdbSessionStatus {
        let mut status_rx = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(handle) = state.sessions.get(&ctx.workspace_id) {
                handle.status_rx.clone()
            } else {
                if state.monitor.is_none() {
                    // A fresh monitor run: sessions wait for its first poll, not a stale list.
                    self.devices_tx.send_replace(None);
                    state.monitor = Some(tokio::spawn(super::monitor::run(
                        self.runner.clone(),
                        self.sink.clone(),
                        self.devices_tx.clone(),
                    )));
                }
                let (manual_tx, manual_rx) = mpsc::unbounded_channel();
                let (status_tx, status_rx) = watch::channel(None);
                let workspace_id = ctx.workspace_id.clone();
                let task = SessionTask {
                    workspace_id: ctx.workspace_id,
                    worktree: ctx.worktree,
                    manual: ctx.manual,
                    runner: self.runner.clone(),
                    sink: self.sink.clone(),
                    devices_rx: self.devices_tx.subscribe(),
                    devices: Arc::default(),
                    manual_rx,
                    status_tx,
                    stream: None,
                    streaming_serial: None,
                    selected: None,
                    waiting_for: None,
                    batcher: LineBatcher::default(),
                    deadline: None,
                    retry: false,
                };
                let handle = SessionHandle {
                    manual_tx,
                    status_rx: status_rx.clone(),
                    task: tokio::spawn(task.run()),
                };
                state.sessions.insert(workspace_id, handle);
                status_rx
            }
        };
        match status_rx.wait_for(Option::is_some).await {
            Ok(status) => status.clone().unwrap_or(AdbSessionStatus::Stopped),
            Err(_) => AdbSessionStatus::Stopped,
        }
    }

    /// The manual choice of a workspace changed: resolve its device again.
    pub async fn re_resolve(&self, workspace_id: &str, manual: Option<DeviceKey>) {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = state.sessions.get(workspace_id) {
            let _ = handle.manual_tx.send(manual);
        }
    }

    /// End a workspace session: kill its logcat process, then emit `Stopped`. The device poll
    /// stops with the last session.
    pub async fn stop(&self, workspace_id: &str) {
        let (handle, monitor) = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let handle = state.sessions.remove(workspace_id);
            let monitor = if state.sessions.is_empty() {
                state.monitor.take()
            } else {
                None
            };
            (handle, monitor)
        };
        if let Some(monitor) = monitor {
            monitor.abort();
        }
        let Some(handle) = handle else {
            return;
        };
        handle.task.abort();
        let _ = handle.task.await;
        self.sink.status(workspace_id, AdbSessionStatus::Stopped);
    }

    pub async fn stop_all(&self) {
        let ids: Vec<String> = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.sessions.keys().cloned().collect()
        };
        for id in ids {
            self.stop(&id).await;
        }
    }

    /// Current status of a workspace session; `None` when it has no session or its first
    /// resolution is not done yet.
    pub fn status(&self, workspace_id: &str) -> Option<AdbSessionStatus> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let handle = state.sessions.get(workspace_id)?;
        handle.status_rx.borrow().clone()
    }

    /// Last polled device list.
    pub fn devices(&self) -> Vec<AdbDevice> {
        self.devices_tx
            .borrow()
            .as_deref()
            .cloned()
            .unwrap_or_default()
    }
}

/// The task that owns one workspace session and every sink call for it.
struct SessionTask {
    workspace_id: String,
    worktree: PathBuf,
    manual: Option<DeviceKey>,
    runner: Arc<dyn AdbRunner>,
    sink: Arc<dyn AdbSink>,
    devices_rx: watch::Receiver<DeviceList>,
    devices: Arc<Vec<AdbDevice>>,
    manual_rx: mpsc::UnboundedReceiver<Option<DeviceKey>>,
    status_tx: watch::Sender<Option<AdbSessionStatus>>,
    stream: Option<Box<dyn LogcatStream>>,
    streaming_serial: Option<String>,
    /// Device the session follows (streamed or waited for); decides resume vs reset.
    selected: Option<DeviceKey>,
    /// Device the current association waits for when it leaves the list; cleared when the
    /// manual choice changes (association becomes automatic again).
    waiting_for: Option<DeviceKey>,
    batcher: LineBatcher,
    deadline: Option<Instant>,
    /// The logcat process ended or failed to start: try again at the next poll.
    retry: bool,
}

impl SessionTask {
    async fn run(mut self) {
        let first = match self.devices_rx.wait_for(Option::is_some).await {
            Ok(list) => list.clone().unwrap_or_default(),
            Err(_) => return,
        };
        self.devices = first;
        self.resolve().await;
        loop {
            let deadline = self.deadline;
            tokio::select! {
                changed = self.devices_rx.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    let Some(list) = self.devices_rx.borrow_and_update().clone() else {
                        continue;
                    };
                    if list != self.devices {
                        self.devices = list;
                        self.resolve().await;
                    } else if self.retry {
                        self.resolve().await;
                    }
                }
                Some(manual) = self.manual_rx.recv() => {
                    self.manual = manual;
                    self.waiting_for = None;
                    self.resolve().await;
                }
                chunk = next_chunk(&mut self.stream) => match chunk {
                    Some(bytes) => self.on_chunk(&bytes),
                    None => self.on_end(),
                },
                _ = sleep_until_opt(deadline), if deadline.is_some() => self.flush(),
            }
        }
    }

    async fn resolve(&mut self) {
        self.retry = false;
        let dedicated = match self.manual {
            Some(_) => None,
            None => self.runner.dedicated_avd(&self.worktree).await,
        };
        // FR-007e: the device streamed as the only ready one stays while it is ready.
        let current = match self.status_tx.borrow().as_ref() {
            Some(AdbSessionStatus::Streaming {
                device,
                source: ResolutionSource::OnlyDevice,
            }) if self.stream.is_some() => Some(device.serial.clone()),
            _ => None,
        };
        match resolve_device(
            self.manual.as_ref(),
            dedicated.as_deref(),
            current.as_deref(),
            &self.devices,
        ) {
            Resolution::Device { serial, source } => {
                let Some(device) = self.devices.iter().find(|d| d.serial == serial).cloned() else {
                    return;
                };
                if self.stream.is_some() && self.streaming_serial.as_deref() == Some(&serial) {
                    // Same process; its key may have gained an AVD name since the last poll.
                    self.selected = Some(device_key(&device));
                    self.waiting_for = self.selected.clone();
                    self.set_status(AdbSessionStatus::Streaming { device, source });
                    return;
                }
                self.end_stream();
                let key = device_key(&device);
                let tail = match (self.selected == Some(key.clone()), self.batcher.last_ts()) {
                    (true, Some(ts)) => TailFrom::Since(ts.to_string()),
                    (true, None) => TailFrom::Count(INITIAL_TAIL),
                    (false, _) => {
                        self.select(key.clone());
                        TailFrom::Count(INITIAL_TAIL)
                    }
                };
                match self.runner.spawn_logcat(&serial, &tail) {
                    Ok(stream) => {
                        self.batcher.start_stream();
                        self.stream = Some(stream);
                        self.streaming_serial = Some(serial);
                        self.waiting_for = Some(key);
                        self.set_status(AdbSessionStatus::Streaming { device, source });
                    }
                    Err(_) => {
                        self.retry = true;
                        self.waiting_for = Some(key.clone());
                        self.set_status(self.waiting(key));
                    }
                }
            }
            Resolution::Unavailable { key, .. } => {
                self.end_stream();
                if self.selected.as_ref() != Some(&key) {
                    self.select(key.clone());
                }
                self.waiting_for = Some(key.clone());
                self.set_status(self.waiting(key));
            }
            Resolution::NoDevice => {
                self.end_stream();
                // A followed device that left the list is waited for (Streaming → Waiting).
                let status = match self.waiting_for.clone() {
                    Some(key) => self.waiting(key),
                    None => AdbSessionStatus::NoDevice,
                };
                self.set_status(status);
            }
            Resolution::NeedsChoice => {
                self.end_stream();
                self.set_status(AdbSessionStatus::NeedsChoice);
            }
        }
    }

    /// Follow another device: the lines shown so far belong to the previous one.
    fn select(&mut self, key: DeviceKey) {
        if self.selected.replace(key).is_some() {
            self.batcher = LineBatcher::default();
            self.sink.lines(&self.workspace_id, Vec::new(), true);
        }
    }

    fn waiting(&self, key: DeviceKey) -> AdbSessionStatus {
        let unauthorized = self.devices.iter().any(|device| {
            device.state == AdbDeviceState::Unauthorized && matches_key(device, &key)
        });
        AdbSessionStatus::Waiting {
            device: key,
            reason: if unauthorized {
                WaitReason::Unauthorized
            } else {
                WaitReason::Disconnected
            },
        }
    }

    fn on_chunk(&mut self, bytes: &[u8]) {
        for batch in self.batcher.push_chunk(bytes) {
            self.sink.lines(&self.workspace_id, batch, false);
        }
        if !self.batcher.has_pending() {
            self.deadline = None;
        } else if self.deadline.is_none() {
            self.deadline = Some(Instant::now() + BATCH_MAX_DELAY);
        }
    }

    fn flush(&mut self) {
        self.deadline = None;
        let lines = self.batcher.take_pending();
        if !lines.is_empty() {
            self.sink.lines(&self.workspace_id, lines, false);
        }
    }

    /// The logcat output ended: flush, wait for the device, retry at the next poll.
    fn on_end(&mut self) {
        self.stream = None;
        self.streaming_serial = None;
        self.deadline = None;
        let lines = self.batcher.finish();
        if !lines.is_empty() {
            self.sink.lines(&self.workspace_id, lines, false);
        }
        self.retry = true;
        if let Some(key) = self.waiting_for.clone() {
            self.set_status(self.waiting(key));
        }
    }

    /// Kill the running logcat (if any) after emitting its pending lines.
    fn end_stream(&mut self) {
        self.stream = None;
        self.streaming_serial = None;
        self.flush();
    }

    fn set_status(&self, status: AdbSessionStatus) {
        if self.status_tx.borrow().as_ref() == Some(&status) {
            return;
        }
        self.sink.status(&self.workspace_id, status.clone());
        self.status_tx.send_replace(Some(status));
    }
}

/// Emulators are identified by AVD name (their serial changes between boots), others by serial.
fn device_key(device: &AdbDevice) -> DeviceKey {
    match &device.avd_name {
        Some(name) => DeviceKey::Avd(name.clone()),
        None => DeviceKey::Serial(device.serial.clone()),
    }
}

async fn next_chunk(stream: &mut Option<Box<dyn LogcatStream>>) -> Option<Vec<u8>> {
    match stream {
        Some(stream) => stream.next_chunk().await,
        None => std::future::pending().await,
    }
}

async fn sleep_until_opt(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    use super::*;
    use crate::adb::logcat::logcat_args;

    const ONE: &str = "List of devices attached\nemulator-5560\tdevice model:sdk_gphone\n";
    const NONE: &str = "List of devices attached\n\n";

    #[derive(Default)]
    struct FakeRunner {
        devices_out: Mutex<String>,
        devices_calls: AtomicUsize,
        avd_names: Mutex<HashMap<String, String>>,
        avd_calls: AtomicUsize,
        dedicated: Mutex<Option<String>>,
        spawns: Mutex<Vec<Vec<String>>>,
        streams: Mutex<Vec<FakeStreamCtl>>,
    }

    struct FakeStreamCtl {
        tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
        dropped: Arc<AtomicBool>,
    }

    struct FakeStream {
        rx: mpsc::UnboundedReceiver<Vec<u8>>,
        dropped: Arc<AtomicBool>,
    }

    impl Drop for FakeStream {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    #[async_trait::async_trait]
    impl LogcatStream for FakeStream {
        async fn next_chunk(&mut self) -> Option<Vec<u8>> {
            self.rx.recv().await
        }
    }

    impl FakeRunner {
        fn with_devices(out: &str) -> Arc<Self> {
            let runner = Self::default();
            runner.set_devices(out);
            Arc::new(runner)
        }
        fn set_devices(&self, out: &str) {
            *self.devices_out.lock().unwrap() = out.to_string();
        }
        fn spawns(&self) -> Vec<Vec<String>> {
            self.spawns.lock().unwrap().clone()
        }
        fn push(&self, stream: usize, bytes: &[u8]) {
            let streams = self.streams.lock().unwrap();
            let _ = streams[stream].tx.as_ref().unwrap().send(bytes.to_vec());
        }
        fn end(&self, stream: usize) {
            self.streams.lock().unwrap()[stream].tx = None;
        }
        fn dropped(&self, stream: usize) -> bool {
            self.streams.lock().unwrap()[stream]
                .dropped
                .load(Ordering::SeqCst)
        }
    }

    #[async_trait::async_trait]
    impl AdbRunner for FakeRunner {
        async fn devices(&self) -> io::Result<String> {
            self.devices_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.devices_out.lock().unwrap().clone())
        }
        async fn avd_name(&self, serial: &str) -> Option<String> {
            self.avd_calls.fetch_add(1, Ordering::SeqCst);
            self.avd_names.lock().unwrap().get(serial).cloned()
        }
        fn spawn_logcat(&self, serial: &str, tail: &TailFrom) -> io::Result<Box<dyn LogcatStream>> {
            self.spawns.lock().unwrap().push(logcat_args(serial, tail));
            let (tx, rx) = mpsc::unbounded_channel();
            let dropped = Arc::new(AtomicBool::new(false));
            self.streams.lock().unwrap().push(FakeStreamCtl {
                tx: Some(tx),
                dropped: dropped.clone(),
            });
            Ok(Box::new(FakeStream { rx, dropped }))
        }
        async fn dedicated_avd(&self, _worktree: &Path) -> Option<String> {
            self.dedicated.lock().unwrap().clone()
        }
    }

    #[derive(Debug, Clone, PartialEq)]
    enum Event {
        Lines(Vec<LogcatLine>, bool),
        Status(AdbSessionStatus),
        Devices(Vec<AdbDevice>),
    }

    #[derive(Default)]
    struct FakeSink {
        events: Mutex<Vec<Event>>,
    }

    impl AdbSink for FakeSink {
        fn lines(&self, _workspace_id: &str, lines: Vec<LogcatLine>, reset: bool) {
            self.events.lock().unwrap().push(Event::Lines(lines, reset));
        }
        fn status(&self, _workspace_id: &str, status: AdbSessionStatus) {
            self.events.lock().unwrap().push(Event::Status(status));
        }
        fn devices(&self, devices: &[AdbDevice]) {
            self.events
                .lock()
                .unwrap()
                .push(Event::Devices(devices.to_vec()));
        }
    }

    impl FakeSink {
        fn events(&self) -> Vec<Event> {
            self.events.lock().unwrap().clone()
        }
        fn statuses(&self) -> Vec<AdbSessionStatus> {
            self.events()
                .into_iter()
                .filter_map(|event| match event {
                    Event::Status(status) => Some(status),
                    _ => None,
                })
                .collect()
        }
        fn batches(&self) -> Vec<(usize, bool)> {
            self.events()
                .into_iter()
                .filter_map(|event| match event {
                    Event::Lines(lines, reset) => Some((lines.len(), reset)),
                    _ => None,
                })
                .collect()
        }
    }

    fn setup(devices: &str) -> (Arc<FakeRunner>, Arc<FakeSink>, Arc<AdbSessions>) {
        let runner = FakeRunner::with_devices(devices);
        let sink = Arc::new(FakeSink::default());
        let sessions = AdbSessions::new(runner.clone(), sink.clone());
        (runner, sink, sessions)
    }

    fn ctx(manual: Option<DeviceKey>) -> SessionContext {
        SessionContext {
            workspace_id: "ws-1".into(),
            worktree: PathBuf::from("/tmp/ws-1"),
            manual,
        }
    }

    /// Let tasks run (and virtual time pass) until `cond` holds; panics after 30 virtual seconds.
    async fn until(mut cond: impl FnMut() -> bool) {
        tokio::time::timeout(Duration::from_secs(30), async {
            while !cond() {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("condition not reached");
    }

    fn device(serial: &str, state: AdbDeviceState, avd: Option<&str>) -> AdbDevice {
        AdbDevice {
            serial: serial.into(),
            state,
            model: Some("sdk gphone".into()),
            avd_name: avd.map(Into::into),
        }
    }

    fn streaming(serial: &str, avd: Option<&str>, source: ResolutionSource) -> AdbSessionStatus {
        AdbSessionStatus::Streaming {
            device: device(serial, AdbDeviceState::Device, avd),
            source,
        }
    }

    fn waiting(key: DeviceKey, reason: WaitReason) -> AdbSessionStatus {
        AdbSessionStatus::Waiting {
            device: key,
            reason,
        }
    }

    fn threadtime(n: usize) -> Vec<u8> {
        (0..n)
            .map(|i| format!("11-21 10:15:02.{:03}  1  1 I Tag: line {i}\n", i % 1000))
            .collect::<String>()
            .into_bytes()
    }

    // FR-006b
    #[tokio::test(start_paused = true)]
    async fn first_start_uses_tail_500() {
        let (runner, _sink, sessions) = setup(ONE);
        let status = sessions.open(ctx(None)).await;
        assert_eq!(
            status,
            streaming("emulator-5560", None, ResolutionSource::OnlyDevice)
        );
        assert_eq!(
            runner.spawns(),
            vec![vec![
                "-s",
                "emulator-5560",
                "logcat",
                "-v",
                "threadtime",
                "-T",
                "500"
            ]]
        );
    }

    // FR-009
    #[tokio::test(start_paused = true)]
    async fn resume_uses_last_timestamp() {
        let (runner, sink, sessions) = setup(ONE);
        sessions.open(ctx(None)).await;
        runner.push(
            0,
            b"11-21 10:15:01.000  1  1 I T: a\n11-21 10:15:02.123  1  1 I T: b\n",
        );
        until(|| sink.batches() == vec![(2, false)]).await;

        runner.set_devices(NONE);
        runner.end(0);
        until(|| sink.statuses().len() == 2).await;
        runner.set_devices(ONE);
        until(|| runner.spawns().len() == 2).await;
        until(|| sink.statuses().len() == 3).await;

        assert_eq!(
            runner.spawns()[1],
            vec![
                "-s",
                "emulator-5560",
                "logcat",
                "-v",
                "threadtime",
                "-T",
                "11-21 10:15:02.123"
            ]
        );
        assert_eq!(
            sink.statuses(),
            vec![
                streaming("emulator-5560", None, ResolutionSource::OnlyDevice),
                waiting(
                    DeviceKey::Serial("emulator-5560".into()),
                    WaitReason::Disconnected
                ),
                streaming("emulator-5560", None, ResolutionSource::OnlyDevice),
            ]
        );
        assert!(sink.batches().iter().all(|(_, reset)| !reset));
    }

    // FR-009 (fin de logcat alors que l'appareil reste listé : nouvel essai au sondage suivant)
    #[tokio::test(start_paused = true)]
    async fn logcat_exit_with_device_still_listed_retries_on_next_poll() {
        let (runner, sink, sessions) = setup(ONE);
        sessions.open(ctx(None)).await;
        runner.push(0, b"11-21 10:15:02.123  1  1 I T: b\n");
        until(|| !sink.batches().is_empty()).await;
        runner.end(0);
        until(|| runner.spawns().len() == 2).await;
        assert_eq!(runner.spawns()[1][6], "11-21 10:15:02.123");
        until(|| sink.statuses().len() == 3).await;
        assert!(matches!(
            sink.statuses()[1],
            AdbSessionStatus::Waiting { .. }
        ));
    }

    // Review Focus 4 (open idempotent)
    #[tokio::test(start_paused = true)]
    async fn open_twice_spawns_once() {
        let (runner, _sink, sessions) = setup(ONE);
        let (a, b) = tokio::join!(sessions.open(ctx(None)), sessions.open(ctx(None)));
        assert_eq!(a, b);
        tokio::time::sleep(Duration::from_secs(10)).await;
        sessions.open(ctx(None)).await;
        assert_eq!(runner.spawns().len(), 1);
    }

    // FR-004a
    #[tokio::test(start_paused = true)]
    async fn session_survives_without_viewer() {
        let (runner, sink, sessions) = setup(ONE);
        sessions.open(ctx(None)).await;
        tokio::time::sleep(Duration::from_secs(600)).await;
        runner.push(0, b"11-21 10:15:02.123  1  1 I T: still here\n");
        until(|| sink.batches() == vec![(1, false)]).await;
        assert!(!runner.dropped(0));
        assert_eq!(runner.spawns().len(), 1);
        assert!(!sink.statuses().contains(&AdbSessionStatus::Stopped));
    }

    // FR-011
    #[tokio::test(start_paused = true)]
    async fn stop_kills_process_and_emits_stopped() {
        let (runner, sink, sessions) = setup(ONE);
        sessions.open(ctx(None)).await;
        sessions.stop("ws-1").await;
        assert!(runner.dropped(0));
        assert_eq!(sink.statuses().last(), Some(&AdbSessionStatus::Stopped));
        // A new open after stop starts a fresh session.
        sessions.open(ctx(None)).await;
        assert_eq!(runner.spawns().len(), 2);
        sessions.stop_all().await;
        assert!(runner.dropped(1));
    }

    #[tokio::test(start_paused = true)]
    async fn status_is_none_without_session() {
        let (_runner, _sink, sessions) = setup(ONE);
        assert_eq!(sessions.status("ws-1"), None);
        let opened = sessions.open(ctx(None)).await;
        assert_eq!(sessions.status("ws-1"), Some(opened));
        sessions.stop("ws-1").await;
        assert_eq!(sessions.status("ws-1"), None);
    }

    // Review Focus 3 / R4
    #[tokio::test(start_paused = true)]
    async fn avd_name_failure_keeps_device_by_serial() {
        let (runner, _sink, sessions) = setup(ONE);
        let status = sessions
            .open(ctx(Some(DeviceKey::Serial("emulator-5560".into()))))
            .await;
        assert_eq!(
            status,
            streaming("emulator-5560", None, ResolutionSource::Manual)
        );
        assert_eq!(
            sessions.devices(),
            vec![device("emulator-5560", AdbDeviceState::Device, None)]
        );
        assert!(runner.avd_calls.load(Ordering::SeqCst) >= 1);
    }

    // R4 (nom d'AVD mis en cache par série)
    #[tokio::test(start_paused = true)]
    async fn avd_name_is_cached_per_serial() {
        let (runner, _sink, sessions) = setup(ONE);
        runner
            .avd_names
            .lock()
            .unwrap()
            .insert("emulator-5560".into(), "Pixel_8".into());
        let status = sessions.open(ctx(None)).await;
        assert_eq!(
            status,
            streaming(
                "emulator-5560",
                Some("Pixel_8"),
                ResolutionSource::OnlyDevice
            )
        );
        tokio::time::sleep(Duration::from_secs(10)).await;
        assert_eq!(runner.avd_calls.load(Ordering::SeqCst), 1);
    }

    // R4
    #[tokio::test(start_paused = true)]
    async fn polling_stops_when_no_session() {
        let (runner, sink, sessions) = setup(ONE);
        tokio::time::sleep(Duration::from_secs(10)).await;
        assert_eq!(runner.devices_calls.load(Ordering::SeqCst), 0);

        sessions.open(ctx(None)).await;
        tokio::time::sleep(Duration::from_millis(4_100)).await;
        // Immediate poll, then one every 2 s.
        assert_eq!(runner.devices_calls.load(Ordering::SeqCst), 3);
        // Unchanged list: the sink heard about it once.
        let device_events = sink
            .events()
            .into_iter()
            .filter(|event| matches!(event, Event::Devices(_)))
            .count();
        assert_eq!(device_events, 1);

        sessions.stop("ws-1").await;
        let calls = runner.devices_calls.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(20)).await;
        assert_eq!(runner.devices_calls.load(Ordering::SeqCst), calls);
    }

    // R3 (lots de 500 lignes ou 50 ms)
    #[tokio::test(start_paused = true)]
    async fn lines_are_batched() {
        let (runner, sink, sessions) = setup(ONE);
        sessions.open(ctx(None)).await;
        runner.push(0, &threadtime(1_200));
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(sink.batches(), vec![(500, false), (500, false)]);
        tokio::time::sleep(Duration::from_millis(45)).await;
        assert_eq!(
            sink.batches(),
            vec![(500, false), (500, false), (200, false)]
        );
    }

    // FR-006 (ligne et caractère UTF-8 coupés entre deux morceaux)
    #[tokio::test(start_paused = true)]
    async fn partial_line_and_utf8_are_carried_to_next_chunk() {
        let (runner, sink, sessions) = setup(ONE);
        sessions.open(ctx(None)).await;
        let line = "11-21 10:15:02.123  1  1 I T: caf\u{e9}\n".as_bytes();
        let cut = line.len() - 2; // inside the two-byte 'é'
        runner.push(0, &line[..cut]);
        runner.push(0, &line[cut..]);
        until(|| !sink.batches().is_empty()).await;
        let Event::Lines(lines, _) = sink
            .events()
            .into_iter()
            .find(|event| matches!(event, Event::Lines(..)))
            .unwrap()
        else {
            unreachable!()
        };
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].message, "caf\u{e9}");
    }

    // FR-007 / FR-006b (changement d'appareil : reset puis -T 500)
    #[tokio::test(start_paused = true)]
    async fn device_change_resets_lines_and_restarts_tail_500() {
        let (runner, sink, sessions) = setup(
            "List of devices attached\nemulator-5560\tdevice model:sdk_gphone\nR58M12345\tdevice model:sdk_gphone\n",
        );
        sessions
            .open(ctx(Some(DeviceKey::Serial("emulator-5560".into()))))
            .await;
        runner.push(0, b"11-21 10:15:02.123  1  1 I T: a\n");
        until(|| !sink.batches().is_empty()).await;

        sessions
            .re_resolve("ws-1", Some(DeviceKey::Serial("R58M12345".into())))
            .await;
        until(|| runner.spawns().len() == 2).await;
        assert!(runner.dropped(0));
        assert_eq!(runner.spawns()[1][1], "R58M12345");
        assert_eq!(runner.spawns()[1][6], "500");
        until(|| sink.statuses().len() == 2).await;
        assert_eq!(sink.batches(), vec![(1, false), (0, true)]);
        assert_eq!(
            sink.statuses()[1],
            streaming("R58M12345", None, ResolutionSource::Manual)
        );
    }

    // FR-007c / FR-008 (appareil choisi absent : attente, pas d'autre appareil)
    #[tokio::test(start_paused = true)]
    async fn missing_manual_device_waits_without_fallback() {
        let (runner, _sink, sessions) = setup(ONE);
        let status = sessions
            .open(ctx(Some(DeviceKey::Avd("Pixel_8".into()))))
            .await;
        assert_eq!(
            status,
            waiting(DeviceKey::Avd("Pixel_8".into()), WaitReason::Disconnected)
        );
        tokio::time::sleep(Duration::from_secs(10)).await;
        assert!(runner.spawns().is_empty());
    }

    // FR-005 (appareil non autorisé, reprise une fois autorisé)
    #[tokio::test(start_paused = true)]
    async fn unauthorized_device_waits_then_streams() {
        let (runner, sink, sessions) =
            setup("List of devices attached\nR58M12345\tunauthorized usb:1-1\n");
        let status = sessions.open(ctx(None)).await;
        assert_eq!(
            status,
            waiting(
                DeviceKey::Serial("R58M12345".into()),
                WaitReason::Unauthorized
            )
        );
        runner.set_devices("List of devices attached\nR58M12345\tdevice model:sdk_gphone\n");
        until(|| sink.statuses().len() == 2).await;
        assert_eq!(
            sink.statuses()[1],
            streaming("R58M12345", None, ResolutionSource::OnlyDevice)
        );
        assert_eq!(runner.spawns()[0][6], "500");
    }

    // FR-005 (aucun appareil)
    #[tokio::test(start_paused = true)]
    async fn no_device_reports_no_device() {
        let (_runner, _sink, sessions) = setup(NONE);
        assert_eq!(sessions.open(ctx(None)).await, AdbSessionStatus::NoDevice);
    }

    // US3 sc.7 / FR-008 (choix manuel effacé : association automatique, NoDevice sans appareil)
    #[tokio::test(start_paused = true)]
    async fn clearing_manual_choice_without_device_reports_no_device() {
        let (runner, sink, sessions) = setup(NONE);
        let status = sessions
            .open(ctx(Some(DeviceKey::Avd("Pixel_8".into()))))
            .await;
        assert_eq!(
            status,
            waiting(DeviceKey::Avd("Pixel_8".into()), WaitReason::Disconnected)
        );

        sessions.re_resolve("ws-1", None).await;
        until(|| sink.statuses().len() == 2).await;
        assert_eq!(sink.statuses()[1], AdbSessionStatus::NoDevice);

        runner.set_devices("List of devices attached\nR58M12345\tdevice model:sdk_gphone\n");
        until(|| runner.spawns().len() == 1).await;
        assert_eq!(runner.spawns()[0][1], "R58M12345");
        assert_eq!(runner.spawns()[0][6], "500");
        until(|| sink.statuses().len() == 3).await;
        assert_eq!(
            sink.statuses()[2],
            streaming("R58M12345", None, ResolutionSource::OnlyDevice)
        );
        assert_eq!(sink.batches(), vec![(0, true)]);
    }

    // FR-007e (un second appareil prêt se connecte : l'appareil en cours est gardé)
    #[tokio::test(start_paused = true)]
    async fn second_ready_device_keeps_current_stream() {
        let (runner, sink, sessions) =
            setup("List of devices attached\nR58M12345\tdevice model:sdk_gphone\n");
        sessions.open(ctx(None)).await;
        runner.set_devices(
            "List of devices attached\nR58M12345\tdevice model:sdk_gphone\nemulator-5554\tdevice model:sdk_gphone\n",
        );
        let calls = runner.devices_calls.load(Ordering::SeqCst);
        until(|| runner.devices_calls.load(Ordering::SeqCst) >= calls + 2).await;

        assert_eq!(runner.spawns().len(), 1);
        assert!(!runner.dropped(0));
        assert_eq!(
            sink.statuses(),
            vec![streaming("R58M12345", None, ResolutionSource::OnlyDevice)]
        );
    }

    // FR-007d / FR-007 (émulateur dédié choisi parmi plusieurs appareils prêts)
    #[tokio::test(start_paused = true)]
    async fn dedicated_emulator_is_chosen_among_ready_devices() {
        let (runner, _sink, sessions) = setup(
            "List of devices attached\nemulator-5554\tdevice model:sdk_gphone\nemulator-5556\tdevice model:sdk_gphone\nR58M12345\tdevice model:sdk_gphone\n",
        );
        {
            let mut names = runner.avd_names.lock().unwrap();
            names.insert("emulator-5554".into(), "Pixel_8".into());
            names.insert("emulator-5556".into(), "task-demo-feat-a".into());
        }
        *runner.dedicated.lock().unwrap() = Some("task-demo-feat-a".into());
        let status = sessions.open(ctx(None)).await;
        assert_eq!(
            status,
            streaming(
                "emulator-5556",
                Some("task-demo-feat-a"),
                ResolutionSource::DedicatedEmulator
            )
        );
        assert_eq!(runner.spawns()[0][1], "emulator-5556");
    }

    // FR-011 (arrêt pendant l'attente : rien après Stopped)
    #[tokio::test(start_paused = true)]
    async fn stop_while_waiting_emits_nothing_after_stopped() {
        let (runner, sink, sessions) = setup(NONE);
        let status = sessions
            .open(ctx(Some(DeviceKey::Serial("R58M12345".into()))))
            .await;
        assert!(matches!(status, AdbSessionStatus::Waiting { .. }));
        sessions.stop("ws-1").await;
        let events = sink.events().len();
        runner.set_devices("List of devices attached\nR58M12345\tdevice model:sdk_gphone\n");
        tokio::time::sleep(Duration::from_secs(10)).await;
        assert_eq!(sink.statuses().last(), Some(&AdbSessionStatus::Stopped));
        assert_eq!(sink.events().len(), events);
        assert!(runner.spawns().is_empty());
    }
}
