import { describe, expect, it } from "vitest";
import { BREAKFASTS, compare, PRESETS } from "./compare";

const body = { sex: "male" as const, age: 30, heightCm: 180, weightKg: 80 };

describe("the lab panel page", () => {
  for (const breakfast of BREAKFASTS) {
    it(`a panel to watch lifts the peak and the time above range after ${breakfast.id}`, () => {
      const { typical, yours } = compare({
        body: { ...body, labs: PRESETS.surveiller },
        breakfast: breakfast.id,
        coffee: true,
      });
      expect(yours.breakfastPeak.mmol).toBeGreaterThan(typical.breakfastPeak.mmol + 0.5);
      expect(yours.minutesAbove).toBeGreaterThan(typical.minutesAbove);
      expect(yours.insulinPeak).toBeGreaterThan(typical.insulinPeak);
    });
  }

  it("leaves the typical run on a body with no panel", () => {
    const { typical, yours } = compare({ body, breakfast: "porridge", coffee: false });
    expect(yours.breakfastPeak.mmol).toBe(typical.breakfastPeak.mmol);
  });
});
