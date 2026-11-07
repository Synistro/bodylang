// Signs Codex in for Bodylang alone. Its own Codex home keeps a person's Codex settings, MCP servers and instructions
// out of Bodylang's sessions, and server/codex.ts runs every session from the same folder.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = join(homedir(), ".bodylang", "codex");
mkdirSync(home, { recursive: true, mode: 0o700 });
const codex = join(process.cwd(), "node_modules", "@openai", "codex", "bin", "codex.js");
const login = spawnSync(process.execPath, [codex, "login", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, CODEX_HOME: home },
});
process.exit(login.status ?? 1);
