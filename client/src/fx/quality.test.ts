import { describe, expect, it } from "vitest";
import { TIER_SPECS, chooseAutoTier, lowerTier, renderSize, tierForPreference, type DeviceInfo } from "./quality";

const device = (patch: Partial<DeviceInfo> = {}): DeviceInfo => ({
  webgl: true,
  highp: true,
  majorPerformanceCaveat: false,
  renderer: "ANGLE (NVIDIA GeForce RTX 3060)",
  maxTextureSize: 16384,
  cores: 8,
  memoryGb: 8,
  saveData: false,
  mobile: false,
  ...patch,
});

describe("chooseAutoTier", () => {
  it("gives a capable computer full effects and a phone the standard tier", () => {
    expect(chooseAutoTier(device()).tier).toBe("high");
    expect(chooseAutoTier(device({ mobile: true, renderer: "Apple GPU" })).tier).toBe("medium");
    expect(chooseAutoTier(device({ mobile: true, renderer: "Adreno (TM) 642L" })).tier).toBe("medium");
  });

  it("falls back to the static picture without usable WebGL", () => {
    expect(chooseAutoTier(device({ webgl: false })).tier).toBe("static");
    expect(chooseAutoTier(device({ highp: false })).tier).toBe("static");
    expect(chooseAutoTier(device({ majorPerformanceCaveat: true })).tier).toBe("static");
    expect(chooseAutoTier(device({ renderer: "Google SwiftShader" })).tier).toBe("static");
    expect(chooseAutoTier(device({ renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" })).tier).toBe("static");
    expect(chooseAutoTier(device({ maxTextureSize: 1024 })).tier).toBe("static");
  });

  it("uses the lite tier on weak or data-saving devices", () => {
    expect(chooseAutoTier(device({ saveData: true })).tier).toBe("low");
    expect(chooseAutoTier(device({ mobile: true, renderer: "Mali-400 MP" })).tier).toBe("low");
    expect(chooseAutoTier(device({ mobile: true, renderer: "Adreno (TM) 308" })).tier).toBe("low");
    expect(chooseAutoTier(device({ mobile: true, renderer: "PowerVR SGX 544MP" })).tier).toBe("low");
    expect(chooseAutoTier(device({ memoryGb: 2 })).tier).toBe("low");
    expect(chooseAutoTier(device({ cores: 2 })).tier).toBe("low");
  });

  it("doesn't mistake newer chips for old ones", () => {
    expect(chooseAutoTier(device({ mobile: true, renderer: "Mali-G78 MP14" })).tier).toBe("medium");
    expect(chooseAutoTier(device({ mobile: true, renderer: "Adreno (TM) 740" })).tier).toBe("medium");
    expect(chooseAutoTier(device({ mobile: true, renderer: "Adreno (TM) 4000" })).tier).toBe("medium");
  });

  it("gives a modest computer the standard tier", () => {
    expect(chooseAutoTier(device({ cores: 4, memoryGb: 4 })).tier).toBe("medium");
    // Unknown memory (Safari, Firefox) isn't held against a desktop.
    expect(chooseAutoTier(device({ cores: 4, memoryGb: null })).tier).toBe("high");
  });

  it("always explains its choice", () => {
    expect(chooseAutoTier(device({ saveData: true })).reason).toMatch(/data saver/i);
  });
});

describe("tierForPreference", () => {
  it("follows the player's choice", () => {
    expect(tierForPreference("off", "high", true, "high")).toBe("static");
    expect(tierForPreference("full", "low", true, "static")).toBe("high");
    expect(tierForPreference("lite", "high", true, "high")).toBe("low");
  });

  it("lets Auto step down after slow frames, but never up", () => {
    expect(tierForPreference("auto", "high", true, "high")).toBe("high");
    expect(tierForPreference("auto", "high", true, "low")).toBe("low");
    expect(tierForPreference("auto", "medium", true, "high")).toBe("medium");
  });

  it("can't render without WebGL whatever the choice", () => {
    expect(tierForPreference("full", "static", false, "high")).toBe("static");
  });
});

describe("lowerTier", () => {
  it("steps down to the static picture and stays there", () => {
    expect(lowerTier("high")).toBe("medium");
    expect(lowerTier("medium")).toBe("low");
    expect(lowerTier("low")).toBe("static");
    expect(lowerTier("static")).toBe("static");
  });
});

describe("renderSize", () => {
  it("keeps sharpness up to the tier's limit", () => {
    const size = renderSize(390, 844, 3, "high");
    expect(size.scale).toBe(TIER_SPECS.high.maxScale);
    expect(size.width).toBe(780);
    expect(size.height).toBe(1688);
  });

  it("caps the number of pixels drawn each frame", () => {
    for (const tier of ["high", "medium", "low"] as const) {
      const size = renderSize(2560, 1440, 2, tier);
      expect(size.width * size.height).toBeLessThanOrEqual(TIER_SPECS[tier].maxPixels * 1.01);
    }
  });

  it("never returns an empty canvas", () => {
    expect(renderSize(0, 0, 1, "low")).toMatchObject({ width: 1, height: 1 });
  });
});
