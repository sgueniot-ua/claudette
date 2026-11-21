// Mirrors `LogLevel` / `LogcatLine` in src/model/adb.rs. Serde serializes the
// unit variants as their bare names ("V" .. "A"), and the Option fields as null.
export type LogLevel = "V" | "D" | "I" | "W" | "E" | "F" | "A";

export interface LogcatLine {
  ts: string | null;
  pid: number | null;
  tid: number | null;
  level: LogLevel | null;
  tag: string | null;
  message: string;
}
