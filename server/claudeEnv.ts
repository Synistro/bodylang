// A session started from inside Claude Code inherits variables that point its child at that session.
// Anything the bridge runs should be a plain Claude Code of its own.
export function cleanEnvironment() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "ANTHROPIC_BASE_URL") continue;
    env[k] = v;
  }
  return env;
}
