// Mirrors `LogLevel` / `LogcatLine` in src/model/adb.rs. LogLevel is
// `#[serde(rename_all = "snake_case")]`, so the wire values are lowercase
// ("v" .. "a"), and the Option fields serialize as null.
export type LogLevel = "v" | "d" | "i" | "w" | "e" | "f" | "a";

export interface LogcatLine {
  ts: string | null;
  pid: number | null;
  tid: number | null;
  level: LogLevel | null;
  tag: string | null;
  message: string;
}
