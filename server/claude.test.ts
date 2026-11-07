import { describe, expect, it } from "vitest";
import { claudeDefaults, claudeEnvironment } from "./claude";
import { buildsAllowed, chosenLlm, modelFor, runFailure } from "./llm";

describe("what a Claude session runs with", () => {
  it("starts without an API key, so Claude Code uses the subscription this machine is logged in with", () => {
    expect(claudeEnvironment({ PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });

  it("keeps a key if there is one and drops what would point it at another session", () => {
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

describe("what a session may reach", () => {
  it("leaves out the connectors on a subscription account, which made one Tell cost about 100 times as much", () => {
    expect(claudeDefaults().strictMcpConfig).toBe(true);
  });
});

describe("what a person sees when a session can't run", () => {
  it("says how to log in when Claude Code is logged out", () => {
    expect(runFailure("Claude Code returned an error result: Not logged in · Please run /login", {})).toMatch(
      /claude auth login.*ANTHROPIC_API_KEY/,
    );
  });

  it("says how to log in when Codex is logged out", () => {
    expect(runFailure("Not logged in.", { BODYLANG_LLM: "openai" })).toMatch(/pnpm login:openai/);
  });

  it("says to log in to another workspace when a ChatGPT one has no credits", () => {
    expect(
      runFailure("Your workspace is out of credits. Add credits to continue.", { BODYLANG_LLM: "openai" }),
    ).toMatch(/pnpm login:openai.*workspace your plan is on/);
  });

  it("passes any other failure on in its own words", () => {
    expect(runFailure("rate limited", {})).toBe("The LLM could not run: rate limited");
  });
});

describe("which LLM answers", () => {
  it("is Claude unless a person says otherwise", () => {
    expect(chosenLlm({})).toBe("claude");
    expect(modelFor("deep", {})).toBe("claude-opus-5-5");
  });

  it("gives each role an OpenAI model on OpenAI, and a setting still wins", () => {
    expect(modelFor("talk", { BODYLANG_LLM: "openai" })).toBe("gpt-6.1-terra");
    expect(modelFor("talk", { BODYLANG_LLM: "openai", BODYLANG_MODEL: "mine" })).toBe("mine");
  });

  it("fails in words on an unknown LLM", () => {
    expect(() => chosenLlm({ BODYLANG_LLM: "gemini" })).toThrow(/BODYLANG_LLM is "gemini".*claude or openai/);
  });
});

describe("process builds", () => {
  it("stay off unless a person turns them on", () => {
    expect(buildsAllowed({})).toBe(false);
    expect(buildsAllowed({ BODYLANG_BUILDS: "0" })).toBe(false);
    expect(buildsAllowed({ BODYLANG_BUILDS: "1" })).toBe(true);
  });

  it("stay off on OpenAI, because the build session runs on the Claude Agent SDK alone", () => {
    expect(buildsAllowed({ BODYLANG_BUILDS: "1", BODYLANG_LLM: "openai" })).toBe(false);
  });
});
