import { describe, expect, it } from "vitest";
import { buildsAllowed, claudeEnvironment } from "./claude";

describe("what a Claude session runs with", () => {
  it("refuses to start without an API key, and says what to do", () => {
    expect(() => claudeEnvironment({})).toThrow(/ANTHROPIC_API_KEY isn't set.*console\.anthropic\.com/);
  });

  it("keeps the key and drops what would point it at another session", () => {
    const env = claudeEnvironment({
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_BASE_URL: "http://elsewhere",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      PATH: "/bin",
    });
    expect(env).toEqual({ ANTHROPIC_API_KEY: "test-key", PATH: "/bin" });
  });
});

describe("process builds", () => {
  it("stay off unless a person turns them on", () => {
    expect(buildsAllowed({})).toBe(false);
    expect(buildsAllowed({ BODYLANG_BUILDS: "0" })).toBe(false);
    expect(buildsAllowed({ BODYLANG_BUILDS: "1" })).toBe(true);
  });
});
