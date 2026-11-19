# Claudette Constitution

## Core Principles

### I. Layered Crates, Thin Shells

- Business logic MUST live in the `claudette` core crate (`src/`), which has no UI or Tauri
  dependency.
- `claudette-tauri` (`src-tauri/`) commands MUST be thin `#[tauri::command]` wrappers, organized
  by domain under `src-tauri/src/commands/`, that call into `claudette`.
- `claudette-server` hosts the WSS transport behind the `RpcHost` trait; `claudette-cli` drives the
  running GUI over the local IPC socket and reuses the GUI command core; `claudette-mobile` is a
  thin WSS remote-control client and MUST NOT run agents locally.
- Service/IO modules (`db/`, `git.rs`, `diff.rs`, `agent/`) live at `src/` level of the core crate.
- Git worktree operations shell out to `git` via `tokio::process::Command`.
- Chat-send dispatch MUST go through the per-backend `runtime_harness`
  (`AgentBackendConfig::effective_harness`), not through `AgentBackendKind` directly.

Rationale: one command core serves GUI, CLI, remote server and mobile; logic outside it diverges.

### II. Pure Data Model and Clear State Ownership

- Data types MUST go in `model/`, free of UI and IO dependencies, and MUST derive `Serialize`.
- UI state lives in the Zustand store (`useAppStore`, single store with domain slices); agent
  sessions live in the Rust-side `AppState`.
- Request/response flows use Tauri commands; streaming data (agent events, PTY output) MUST flow
  via Tauri events consumed by React hooks.
- UI-only state (collapsed sections, panel widths, selection) MUST NOT be persisted.
- A fresh `rusqlite` connection MUST be opened per Tauri command (`Database::open`), since
  `Connection` is not `Send`.
- Notification sound and commands run on the Rust side, never in the webview.

### III. Contract Stability and Regression Discipline (NON-NEGOTIABLE)

- Regressions are the main risk, ahead of style. Before changing behavior, identify the current
  contract: persisted DB fields, Tauri command payloads, CLI output, plugin manifests, settings
  keys, localized strings, terminal/session semantics, worktree behavior, visible UI workflows.
- These MUST NOT be removed, renamed or silently reinterpreted unless the task explicitly asks.
- An intentional behavior change MUST be called out in the PR summary and pinned by tests; an
  incidental one MUST be reverted to preserve compatibility.
- A type, lint or test failure MUST NOT be fixed by deleting tests, removing UI controls, dropping
  state fields, weakening assertions or broadening types.

### IV. Forward-Only Schema Migrations

- Migrations are `.sql` files under `src/migrations/` named
  `YYYYMMDDHHMMSS_snake_case_description.sql` (UTC) and registered in the `MIGRATIONS` slice.
- The SQL of a released migration MUST NEVER be edited or renamed; fix forward with a new one.
- Migrations MUST be strictly forward-only and additive, preferring `IF NOT EXISTS`; they MUST NOT
  rely on the runner's "already exists" leniency.
- New code MUST NOT read or write `PRAGMA user_version`.

### V. Design Tokens Only

- Colors and styling MUST use CSS custom properties defined in `styles/theme.css`; every color is
  a `var(--token-name)` reference.
- Raw hex/rgba literals outside `theme.css` are forbidden (enforced by `bun run lint:css` in CI).
  Only exceptions: `rgba(var(--*-rgb), <alpha>)`, `getPropertyValue(...) || "#..."` fallbacks in
  `theme.ts`, and `accentPreview` swatches in CommandPalette mirroring theme values.

### VI. Platform Safety

- No subprocess may be spawned with a raw `Command::new`: use the `claudette::process` helper or
  `.no_console_window()`; `.new_console_window()` only for a terminal the user intentionally opens
  (enforced by `clippy.toml` `disallowed-methods`).
- Windows-specific code MUST be gated with `#[cfg(windows)]` / `#[cfg(not(windows))]`; new Windows
  audio code belongs in `src/audio.rs`.
- No CoreAudio or Speech.framework TCC prompt may be triggered at app launch: voice uses
  `availability()` for status and `prepare()` only when the user starts recording. Changing mDNS
  launch-time discovery requires an intentional replacement UX.
- Spawn sites SHOULD apply the captured shell env via `crate::env::enriched_env().apply(&mut cmd)`.

Rationale: these bugs are invisible in dev builds and surface only in shipped releases.

### VII. Surgical Changes to God Files

- Files listed as god files in CLAUDE.md (e.g. `src/diff.rs`, `src/git.rs`, `src-tauri/src/ipc.rs`,
  `Sidebar.tsx`, `ChatPanel.tsx`, `services/tauri.ts`) MUST NOT gain unrelated responsibilities.
- New behavior MUST be extracted into a focused helper, hook, slice or child component near the
  owning feature, then wired through the existing entry point; if that home does not exist yet,
  build it first in a separate (or stacked) commit.

## Performance and Dependency Constraints

- Binary size target: < 30 MB. Cold start target: < 2 seconds to interactive UI.
- Dependencies MUST be added conservatively, preferring well-maintained crates with minimal
  transitive dependencies.
- Frontend package manager is `bun`; `bun.lock` MUST NOT change without intention
  (`--frozen-lockfile` in CI).
- Targets: macOS (Apple Silicon + Intel), Linux (x86_64 + aarch64, Wayland + X11), Windows
  (x86_64 + ARM64).

## Development Workflow and Quality Gates

- Rust edition 2024, default `rustfmt` and `clippy`; CI runs with `RUSTFLAGS="-Dwarnings"` and
  clippy MUST pass with zero warnings; `cargo fmt --all --check` MUST pass.
- TypeScript strict mode, no `any`; `bunx tsc -b` MUST pass after any TypeScript change, tests
  included (vitest does not type-check).
- Tests: Rust uses `tempfile::tempdir()` ephemeral repos and `#[tokio::test]`, modules at the bottom
  of each file; frontend uses vitest, resetting Zustand via `useAppStore.setState()`, with fixtures
  built from the actual type definitions.
- Debug-only code MUST be gated by `#[cfg(debug_assertions)]` / `import.meta.env.DEV`.
- User-visible changes (settings, commands, CLI flags, shortcuts, env vars, file locations, plugin
  manifests, notification triggers) MUST update `site/src/content/docs/` in the same PR, or the PR
  MUST state why the omission is intentional.
- Commits and PR titles MUST follow Conventional Commits, header ≤ 100 characters.

## Governance

- CLAUDE.md is the project's detailed source of truth; this constitution codifies its
  non-negotiable principles for Spec Kit. An amendment to either MUST be reflected in the other,
  and in the aligned AI configs (`.github/copilot-instructions.md`, `.github/instructions/*`), in
  the same PR. `AGENTS.md` is a symlink and is never edited.
- Amendments go through a reviewed PR. Versioning: MAJOR for removed or redefined principles,
  MINOR for added or materially expanded ones, PATCH for clarifications.
- Every spec, plan and review MUST check compliance with these principles; any deviation MUST be
  justified in the plan's Complexity Tracking.

**Version**: 1.0.0 | **Ratified**: 2026-11-19 | **Last Amended**: 2026-11-19
