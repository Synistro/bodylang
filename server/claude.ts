// A session started from inside Claude Code inherits variables that point its child at that session.
// Anything the bridge runs should be a plain Claude Code of its own.
function cleanEnvironment() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "ANTHROPIC_BASE_URL") continue;
    env[k] = v;
  }
  return env;
}

// Every session here runs alone: no saved history, none of this machine's settings, and only the tools it is given.
export const claudeDefaults = () => ({
  tools: [],
  settingSources: [],
  persistSession: false,
  permissionMode: "dontAsk" as const,
  env: cleanEnvironment(),
});
