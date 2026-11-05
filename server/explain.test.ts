import { describe, expect, it } from "vitest";
import { firstDay } from "../src/model/day";
import { cleanName, renderExplainPrompt } from "./explain";

const { version: _v, date: _d, ...day } = firstDay("2026-11-05", { sex: "male", age: 30, heightCm: 180, weightKg: 80 });
const base = { term: "TRH", around: "A deep part of the brain sends less TRH in the daytime.", page: "Thyroid", turns: [], now: 900, day };

describe("what Haiku is told", () => {
  it("gives the words, the sentence and the page", () => {
    const prompt = renderExplainPrompt(base);
    expect(prompt).toContain("They selected: TRH");
    expect(prompt).toContain("A deep part of the brain");
    expect(prompt).toContain("Thyroid");
    expect(prompt).toContain("Explain what they selected.");
  });

  it("carries the model's numbers for this moment", () => {
    expect(renderExplainPrompt(base)).toMatch(/<simulation time="15:00">/);
  });

  it("carries the conversation, and answers the last question", () => {
    const prompt = renderExplainPrompt({ ...base, turns: [{ role: "claude", text: "It is a signal." }, { role: "you", text: "Is mine low?" }] });
    expect(prompt).toContain("You answered: It is a signal.");
    expect(prompt).toContain("They asked: Is mine low?");
    expect(prompt).toContain("Answer what they just asked.");
  });
});

describe("the name of a question", () => {
  it("keeps a short name, without quotes or a final mark", () => {
    expect(cleanName(' "Why athletes feel less soreness." ')).toBe("Why athletes feel less soreness");
    expect(cleanName("A bowl of pasta now?")).toBe("A bowl of pasta now");
  });

  it("gives up on anything that isn't a name, so the question stays", () => {
    expect(cleanName("")).toBeNull();
    expect(cleanName("Here is a name:\nSoreness")).toBeNull();
    expect(cleanName("x".repeat(61))).toBeNull();
  });
});
