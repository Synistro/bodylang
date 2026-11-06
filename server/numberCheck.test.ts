import { describe, expect, it } from "vitest";
import { NumberBook, unverifiedNumbers } from "./numberCheck";

const book = (...texts: string[]) => {
  const b = new NumberBook();
  for (const text of texts) b.add(text);
  return b;
};

describe("checking Claude's numbers against the model's", () => {
  const readout = book(
    JSON.stringify({ glucose: 6.31, insulin_fold: 4.3, stomach: "65%", share: 0.42, settles: "17:36", hours: 12 }),
  );

  it("passes what the model returned, at any rounding", () => {
    expect(unverifiedNumbers("Blood sugar is 6.3 mmol/L, with insulin at 4.3 times resting.", readout)).toEqual([]);
    expect(unverifiedNumbers("It settles around 17:36, with 65% still in your stomach.", readout)).toEqual([]);
    expect(unverifiedNumbers("42% has moved on.", readout)).toEqual([]);
    expect(unverifiedNumbers("That is 12 hours.", readout)).toEqual([]);
  });

  it("marks a number the model never returned", () => {
    expect(unverifiedNumbers("Blood sugar is 7.9 mmol/L.", readout)).toEqual(["7.9"]);
    expect(unverifiedNumbers("Most people need 8 hours of sleep and 30% more.", readout)).toEqual(["8", "30%"]);
    expect(unverifiedNumbers("It settles around 19:00.", readout)).toEqual(["19:00"]);
  });

  it("doesn't let a clock vouch for its parts", () => {
    expect(unverifiedNumbers("About 36 of them, 17 in all.", book("settles at 17:36"))).toEqual(["36", "17"]);
  });

  it("takes the person's own numbers as known", () => {
    expect(unverifiedNumbers("Your 2 slices at 13:10.", book("I had 2 slices at 13:10"))).toEqual([]);
  });

  it("leaves numbers inside words alone", () => {
    expect(unverifiedNumbers("B12 and H2O are not readings.", readout)).toEqual([]);
  });

  it("doesn't read the end of a sentence as a decimal", () => {
    expect(unverifiedNumbers("It reached 6.3. Then it fell.", readout)).toEqual([]);
  });

  it("passes a whole number said to its nearest hundred, and nothing further away", () => {
    const told = book("fluid_balance_ml: -385");
    expect(unverifiedNumbers("About 400 ml short.", told)).toEqual([]);
    expect(unverifiedNumbers("About 500 ml short.", told)).toEqual(["500"]);
    expect(unverifiedNumbers("About 390 ml short.", told)).toEqual([]);
    expect(unverifiedNumbers("About 380 ml short.", book("reads 395"))).toEqual(["380"]);
  });

  it("passes a time rounded to the quarter hour, and nothing further away", () => {
    const told = book("empties near 01:16, peak 23:53");
    expect(unverifiedNumbers("Done around 01:15.", told)).toEqual([]);
    expect(unverifiedNumbers("Peaks around 00:00.", told)).toEqual([]);
    expect(unverifiedNumbers("Done around 01:30.", told)).toEqual(["01:30"]);
    expect(unverifiedNumbers("Done at 01:17.", told)).toEqual(["01:17"]);
  });

  it("matches a clock with or without its leading zero", () => {
    expect(unverifiedNumbers("Since 8:30 this morning.", book("at 08:30"))).toEqual([]);
  });
});
