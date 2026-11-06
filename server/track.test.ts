import { describe, expect, it } from "vitest";
import { traceTrack } from "./track";

const names = (...args: Parameters<typeof traceTrack>) => traceTrack(...args).map((part) => part.name);

describe("what a straight line through the body crosses", () => {
  it("always crosses the organ it was aimed at", () => {
    for (const organ of ["liver", "heart", "brain", "spleen", "pancreas", "bladder"] as const) {
      expect(traceTrack(organ, "front", "male").some((part) => part.organ === organ)).toBe(true);
    }
  });

  it("reaches things in order from the side it came in", () => {
    const organs = (from: "front" | "back") =>
      traceTrack("liver", from, "male").flatMap((part) => (part.organ ? [part.name] : []));
    const fromFront = organs("front");
    expect(organs("back")).toEqual([...fromFront].reverse());
    expect(fromFront[0]).toBe("liver");
  });

  it("goes through the right kidney on the way to the liver from behind, on the person's right", () => {
    const fromBack = names("kidneys", "back", "male");
    expect(fromBack).toContain("right kidney");
    expect(fromBack).not.toContain("left kidney");
  });

  it("crosses both lungs when it comes in from the side at chest height", () => {
    const parts = names("heart", "right", "male");
    expect(parts).toContain("right lung");
    expect(parts).toContain("heart");
    expect(parts.indexOf("right lung")).toBeLessThan(parts.indexOf("heart"));
  });

  it("names large vessels it passes through and leaves out the small ones", () => {
    const throughHeart = names("heart", "front", "male");
    expect(throughHeart.some((name) => /aorta|pulmonary|vena cava/.test(name))).toBe(true);
    expect(throughHeart.length).toBeLessThan(14);
  });

  it("finds a stomach even though the atlas has no mesh for one", () => {
    expect(traceTrack("stomach", "front", "male").some((part) => part.organ === "stomach")).toBe(true);
  });

  it("has nothing to say about what has no place of its own", () => {
    expect(traceTrack("fat", "front", "male")).toEqual([]);
  });

  it("reaches the organs only one body has", () => {
    expect(traceTrack("uterus", "front", "female").some((part) => part.organ === "uterus")).toBe(true);
    expect(traceTrack("ovaries", "front", "female").some((part) => part.organ === "ovaries")).toBe(true);
    expect(traceTrack("prostate", "front", "male").some((part) => part.organ === "prostate")).toBe(true);
  });

  it("works on both bodies", () => {
    expect(traceTrack("liver", "right", "female").some((part) => part.organ === "liver")).toBe(true);
  });
});
