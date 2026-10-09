import { AVATAR_MAX_BYTES, avatarFileProblem, sniffImageType } from "@mafia/shared";
import { describe, expect, it } from "vitest";
import { isSavedPhotoUrl, parseSavedPhoto } from "./photo";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new TextEncoder().encode(s);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const WEBP = text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
const GIF = text("GIF89a\u0001\u0000");
const SVG = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("checking a picture before it is cropped (on the device)", () => {
  it("knows a file by its bytes, not its name", () => {
    expect(sniffImageType(PNG)).toBe("png");
    expect(sniffImageType(JPEG)).toBe("jpeg");
    expect(sniffImageType(WEBP)).toBe("webp");
    expect(sniffImageType(GIF)).toBe("gif");
    expect(sniffImageType(SVG)).toBe("svg");
    expect(sniffImageType(text('﻿ \n<?xml version="1.0"?><svg/>'))).toBe("svg");
    expect(sniffImageType(text("<!DOCTYPE svg><svg/>"))).toBe("svg");
    // "cat.png" that is really a web page or a program: still not a picture.
    expect(sniffImageType(text("<html><body>hi</body></html>"))).toBe("other");
    expect(sniffImageType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBe("other");
    expect(sniffImageType(bytes())).toBe("other");
  });

  it("refuses GIFs, SVGs, anything else, empty files and files over 2 MB, in plain words", () => {
    expect(avatarFileProblem("png", 1000)).toBeNull();
    expect(avatarFileProblem("jpeg", AVATAR_MAX_BYTES)).toBeNull();
    expect(avatarFileProblem("webp", 5)).toBeNull();
    expect(avatarFileProblem("gif", 1000)).toMatch(/GIFs can't be used/);
    expect(avatarFileProblem("svg", 1000)).toMatch(/SVG files can't be used/);
    expect(avatarFileProblem("other", 1000)).toMatch(/isn't a PNG, JPG or WebP/);
    expect(avatarFileProblem("png", AVATAR_MAX_BYTES + 1)).toMatch(/at most 2 MB/);
    expect(avatarFileProblem("png", 0)).toMatch(/empty/);
  });

  it("only keeps a cropped picture saved on this device if it is a real image data URL", () => {
    expect(isSavedPhotoUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isSavedPhotoUrl("data:image/webp;base64,UklGRg==")).toBe(true);
    expect(isSavedPhotoUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSavedPhotoUrl("data:image/gif;base64,R0lGOD==")).toBe(false);
    expect(isSavedPhotoUrl("javascript:alert(1)")).toBe(false);
    expect(isSavedPhotoUrl(`data:image/png;base64,${"A".repeat(500_000)}`)).toBe(false);
    expect(parseSavedPhoto({ dataUrl: "data:image/png;base64,iVBO", use: false })).toEqual({ dataUrl: "data:image/png;base64,iVBO", use: false });
    expect(parseSavedPhoto({ dataUrl: "https://example.com/x.png" })).toBeNull();
  });
});
