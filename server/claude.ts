// A session started from inside Claude Code inherits variables that point its child at that session.
// Anything the bridge runs should be a plain Claude Code of its own. Anthropic's terms have apps built on the
// Agent SDK use an API key, so a session never falls back to whatever Claude login this machine has.
export function claudeEnvironment(from: NodeJS.ProcessEnv = process.env) {
  if (!from.ANTHROPIC_API_KEY)
    throw new Error(
      "ANTHROPIC_API_KEY isn't set. Create a key at console.anthropic.com, set it, and restart the server.",
    );
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(from)) {
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
  env: claudeEnvironment(),
});

// A build spends about $0.80 and commits to this checkout, so a person turns builds on themselves.
export const buildsAllowed = (from: NodeJS.ProcessEnv = process.env) => from.BODYLANG_BUILDS === "1";
