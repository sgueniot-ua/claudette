/** Mirror of `agent::sanitize_branch_name` (src/agent/naming.rs). */
function sanitizeBranchName(raw: string, maxLen: number): string {
  const slug = Array.from(raw)
    .map((c) => (/^[A-Za-z0-9-]$/.test(c) ? c.replace(/[A-Z]/, (u) => u.toLowerCase()) : "-"))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLen).replace(/-+$/, "");
}

/**
 * Mirror of `ops::workspace::resolve_branch_prefix`: the prefix the backend
 * puts before a default workspace's branch name. Always empty or ending in `/`.
 * `mode` is the `git_branch_prefix_mode` setting (anything but `custom` /
 * `none` means the git username).
 */
export function resolveBranchPrefix(
  mode: string | null,
  customValue: string | null,
  gitUsername: string | null,
): string {
  if (mode === "none") return "";
  if (mode === "custom") {
    const sanitized = (customValue ?? "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .map((segment) => sanitizeBranchName(segment.trim(), 30))
      .filter((s) => s !== "")
      .join("/");
    return sanitized ? `${sanitized}/` : "";
  }
  const slug = gitUsername ? sanitizeBranchName(gitUsername, 30) : "";
  return slug ? `${slug}/` : "claudette/";
}
