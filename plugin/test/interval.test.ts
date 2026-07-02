import { describe, it, expect } from "vitest";
import { intervalToMs, INTERVAL_PRESETS } from "../src/interval.js";

describe("intervalToMs", () => {
  it("returns null for Off (0)", () => {
    expect(intervalToMs(0)).toBeNull();
  });
  it("converts minutes to ms", () => {
    expect(intervalToMs(5)).toBe(300000);
    expect(intervalToMs(60)).toBe(3600000);
  });
  it("treats negative/invalid as off", () => {
    expect(intervalToMs(-1)).toBeNull();
  });
  it("exposes the preset list including Off", () => {
    expect(INTERVAL_PRESETS.map((p) => p.minutes)).toEqual([0, 5, 15, 30, 60]);
    expect(INTERVAL_PRESETS[0]!.label).toBe("Off");
  });
});
