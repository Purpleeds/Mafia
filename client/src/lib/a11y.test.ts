import { describe, expect, it } from "vitest";
import { DEFAULT_A11Y, MOTION_OPTIONS, TEXT_SIZES, motionOverrideFor, parseA11y } from "./a11y";

describe("accessibility preferences", () => {
  it("default to following the device, at normal text size", () => {
    expect(parseA11y(null)).toEqual({ motion: "auto", textSize: "normal" });
    expect(DEFAULT_A11Y).toEqual({ motion: "auto", textSize: "normal" });
  });

  it("read what was saved, ignoring anything unknown", () => {
    expect(parseA11y('{"motion":"reduce","textSize":"larger"}')).toEqual({ motion: "reduce", textSize: "larger" });
    expect(parseA11y('{"motion":"spin","textSize":42}')).toEqual(DEFAULT_A11Y);
    expect(parseA11y("not json")).toEqual(DEFAULT_A11Y);
  });

  it("turn reduce motion on, off, or leave it to the device", () => {
    expect(motionOverrideFor("reduce")).toBe(true);
    expect(motionOverrideFor("full")).toBe(false);
    expect(motionOverrideFor("auto")).toBeNull();
    expect(MOTION_OPTIONS.map((o) => o.value)).toEqual(["auto", "reduce", "full"]);
  });

  it("offer text sizes that only grow", () => {
    const scales = TEXT_SIZES.map((t) => t.scale);
    expect(scales[0]).toBe(1);
    expect([...scales].sort((a, b) => a - b)).toEqual(scales);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.25);
  });
});
