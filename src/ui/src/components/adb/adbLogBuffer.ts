import type { LogcatLine } from "../../types/adb";

// FR-006b: at most 50 000 lines per workspace, the oldest evicted first.
export const ADB_LOG_CAPACITY = 50_000;

interface WorkspaceLog {
  // Grows by push until it holds `capacity` lines, then wraps around.
  slots: LogcatLine[];
  // Ring position of the oldest line; only moves once the buffer is full.
  start: number;
  // Cumulative count of lines dropped from the front. Also the absolute
  // index of the oldest retained line, so indexes stay stable after eviction.
  evicted: number;
}

export interface AdbLogBuffer {
  append(workspaceId: string, lines: readonly LogcatLine[], reset?: boolean): void;
  get(workspaceId: string, absoluteIndex: number): LogcatLine | undefined;
  size(workspaceId: string): number;
  evicted(workspaceId: string): number;
  firstIndex(workspaceId: string): number;
  // Session counter: bumped by clear and by append with reset, never decreases.
  generation(workspaceId: string): number;
  clear(workspaceId: string): void;
}

export function createAdbLogBuffer(capacity = ADB_LOG_CAPACITY): AdbLogBuffer {
  const workspaces = new Map<string, WorkspaceLog>();
  const generations = new Map<string, number>();

  function bump(workspaceId: string) {
    generations.set(workspaceId, (generations.get(workspaceId) ?? 0) + 1);
  }

  function ensure(workspaceId: string): WorkspaceLog {
    let log = workspaces.get(workspaceId);
    if (!log) {
      log = { slots: [], start: 0, evicted: 0 };
      workspaces.set(workspaceId, log);
    }
    return log;
  }

  function push(log: WorkspaceLog, line: LogcatLine) {
    if (log.slots.length < capacity) {
      log.slots.push(line);
      return;
    }
    log.slots[log.start] = line;
    log.start = (log.start + 1) % capacity;
    log.evicted += 1;
  }

  return {
    append(workspaceId, lines, reset = false) {
      if (reset) {
        workspaces.delete(workspaceId);
        bump(workspaceId);
      }
      const log = ensure(workspaceId);
      for (const line of lines) {
        push(log, line);
      }
    },

    get(workspaceId, absoluteIndex) {
      const log = workspaces.get(workspaceId);
      if (!log) {
        return undefined;
      }
      const offset = absoluteIndex - log.evicted;
      if (offset < 0 || offset >= log.slots.length) {
        return undefined;
      }
      return log.slots[(log.start + offset) % capacity];
    },

    size(workspaceId) {
      return workspaces.get(workspaceId)?.slots.length ?? 0;
    },

    evicted(workspaceId) {
      return workspaces.get(workspaceId)?.evicted ?? 0;
    },

    firstIndex(workspaceId) {
      return workspaces.get(workspaceId)?.evicted ?? 0;
    },

    generation(workspaceId) {
      return generations.get(workspaceId) ?? 0;
    },

    clear(workspaceId) {
      workspaces.delete(workspaceId);
      bump(workspaceId);
    },
  };
}

// Module-level instance shared by the ADB panel, kept outside the Zustand store.
export const adbLogBuffer = createAdbLogBuffer();
