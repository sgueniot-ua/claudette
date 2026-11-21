import type { AdbLogBuffer } from "./adbLogBuffer";

// FR-006c: case-insensitive search over tag and message. Returns absolute
// indexes into the buffer, in ascending order.
export function findMatches(buf: AdbLogBuffer, workspaceId: string, query: string): number[] {
  if (query === "") {
    return [];
  }
  const needle = query.toLowerCase();
  const first = buf.firstIndex(workspaceId);
  const end = first + buf.size(workspaceId);
  const matches: number[] = [];
  for (let index = first; index < end; index += 1) {
    const line = buf.get(workspaceId, index);
    if (!line) {
      continue;
    }
    const haystack = `${line.tag ?? ""} ${line.message}`.toLowerCase();
    if (haystack.includes(needle)) {
      matches.push(index);
    }
  }
  return matches;
}

// FR-006c: next match after `current`, wrapping from the last back to the first.
export function nextMatch(matches: readonly number[], current: number | null): number | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (current === null) {
    return matches[0];
  }
  return matches.find((index) => index > current) ?? matches[0];
}

// FR-006c: previous match before `current`, wrapping from the first back to the last.
export function prevMatch(matches: readonly number[], current: number | null): number | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (current === null) {
    return matches[matches.length - 1];
  }
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (matches[i] < current) {
      return matches[i];
    }
  }
  return matches[matches.length - 1];
}
