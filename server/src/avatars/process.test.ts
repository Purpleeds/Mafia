import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, AVATAR_SIZE, sniffImageType } from "@mafia/shared";
import { processAvatarImage, toDataUrl } from "./process.js";

const solid = (format: "png" | "jpeg" | "webp" | "gif", width = 300, height = 200) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 90 } } })
    .toFormat(format)
    .toBuffer();

const SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
);

async function expectInvalid(input: Buffer, message?: RegExp) {
  const result = await processAvatarImage(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe("AVATAR_INVALID");
    if (message) expect(result.message).toMatch(message);
  }
}

describe("avatar pictures: what is accepted", () => {
  it.each(["png", "jpeg", "webp"] as const)("turns a %s into a fresh 128x128 WebP", async (format) => {
    const result = await processAvatarImage(await solid(format));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sniffImageType(result.webp)).toBe("webp");
    const meta = await sharp(result.webp).metadata();
    expect(meta).toMatchObject({ format: "webp", width: AVATAR_SIZE, height: AVATAR_SIZE });
    expect(toDataUrl(result.webp)).toMatch(/^data:image\/webp;base64,/);
  });

  it("crops a wide picture to a square rather than squashing it", async () => {
    const result = await processAvatarImage(await solid("png", 1000, 200));
    expect(result.ok && (await sharp(result.webp).metadata()).width).toBe(AVATAR_SIZE);
  });

  it("drops everything but the pixels: metadata, comments and anything hidden after the image", async () => {
    const tagged = await sharp(await solid("jpeg"))
      .withMetadata({ exif: { IFD0: { Copyright: "secret-owner", ImageDescription: "GPS 51.5,-0.12" } } })
      .jpeg()
      .toBuffer();
    // A "polyglot": a real picture with a script tucked on after its end.
    const smuggled = Buffer.concat([tagged, Buffer.from("<script>alert('hi')</script>")]);
    for (const input of [tagged, smuggled]) {
      const result = await processAvatarImage(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const meta = await sharp(result.webp).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(result.webp.toString("latin1")).not.toMatch(/secret-owner|GPS|script|alert/);
    }
  });
});

describe("avatar pictures: what is refused", () => {
  it("refuses GIFs, even animated ones that claim to be PNGs", async () => {
    await expectInvalid(await solid("gif"), /GIFs can't be used/);
  });

  it("refuses SVGs (which can carry scripts), with or without an XML header or a byte-order mark", async () => {
    await expectInvalid(SVG, /SVG files can't be used/);
    await expectInvalid(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'), /SVG/);
    await expectInvalid(Buffer.concat([Buffer.from("﻿  \n"), SVG]), /SVG/);
  });

  it("goes by the bytes, not the name: a renamed file is still what it really is", async () => {
    // "photo.png" that is really a GIF, an SVG or a script: the name and claimed type are never looked at.
    await expectInvalid(await solid("gif"), /GIF/);
    await expectInvalid(SVG, /SVG/);
    await expectInvalid(Buffer.from("#!/bin/sh\necho hi\n"), /isn't a PNG, JPG or WebP/);
    await expectInvalid(Buffer.from("<html><body>hi</body></html>"), /isn't a PNG, JPG or WebP/);
  });

  it("refuses a file that starts like a PNG but isn't one", async () => {
    const png = await solid("png");
    await expectInvalid(Buffer.concat([png.subarray(0, 16), Buffer.alloc(400, 7)]), /couldn't be read/);
    await expectInvalid(png.subarray(0, Math.floor(png.length / 2)), /couldn't be read/); // cut short
    // PNG signature, then a JPEG inside: the decoder must agree with the signature.
    const jpeg = await solid("jpeg");
    await expectInvalid(Buffer.concat([png.subarray(0, 8), jpeg]), /couldn't be read|isn't a PNG/);
  });

  it("refuses other formats a decoder could read (TIFF, AVIF/HEIF) and garbage", async () => {
    const tiff = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#123456" } }).tiff().toBuffer();
    await expectInvalid(tiff, /isn't a PNG, JPG or WebP/);
    await expectInvalid(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), /isn't a PNG, JPG or WebP/);
    await expectInvalid(Buffer.alloc(0), /empty/);
  });

  it("refuses files over 2 MB, before trying to read them", async () => {
    const big = Buffer.concat([await solid("png"), Buffer.alloc(AVATAR_MAX_BYTES)]);
    const result = await processAvatarImage(big);
    expect(result).toEqual({ ok: false, code: "AVATAR_TOO_LARGE", message: "Pictures can be at most 2 MB." });
  });

  it("refuses an animated WebP", async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 16, height: 16, channels: 4, background } }).png().toBuffer();
    const animated = await sharp([await frame("#ff0000"), await frame("#00ff00")], { join: { animated: true } })
      .webp({ loop: 0 })
      .toBuffer();
    expect(sniffImageType(animated)).toBe("webp");
    await expectInvalid(animated, /Animated/);
  });

  it("refuses a decompression bomb (a small file that unpacks to an enormous picture)", async () => {
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#000000" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.length).toBeLessThan(AVATAR_MAX_BYTES);
    await expectInvalid(huge, /couldn't be read/);
  });
});
