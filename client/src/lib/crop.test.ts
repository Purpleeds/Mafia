import { describe, expect, it } from "vitest";
import { MAX_ZOOM, clampCrop, initialCrop, sourceSquare, zoomAround } from "./crop";

const V = 240;

describe("cropping a picture to a square", () => {
  it("starts centred, with the short side filling the square", () => {
    const wide = { width: 1200, height: 600 };
    const crop = initialCrop(wide, V);
    expect(crop.zoom).toBe(1);
    expect(sourceSquare(wide, V, crop)).toEqual({ x: 300, y: 0, size: 600 });
    const tall = { width: 400, height: 1000 };
    expect(sourceSquare(tall, V, initialCrop(tall, V))).toEqual({ x: 0, y: 300, size: 400 });
  });

  it("never leaves an empty edge, however far you drag", () => {
    const image = { width: 800, height: 800 };
    expect(clampCrop(image, V, { zoom: 2, offsetX: 500, offsetY: -5000 })).toEqual({ zoom: 2, offsetX: 0, offsetY: -240 });
    const square = sourceSquare(image, V, { zoom: 2, offsetX: 500, offsetY: -5000 });
    expect(square.x).toBe(0);
    expect(square.y + square.size).toBeCloseTo(800);
  });

  it("zooms between 1x and 4x around the centre, keeping it in place", () => {
    const image = { width: 1000, height: 1000 };
    const zoomed = zoomAround(image, V, initialCrop(image, V), 2);
    expect(sourceSquare(image, V, zoomed)).toEqual({ x: 250, y: 250, size: 500 });
    expect(zoomAround(image, V, zoomed, 99).zoom).toBe(MAX_ZOOM);
    expect(zoomAround(image, V, zoomed, 0.1).zoom).toBe(1);
  });

  it("copes with nonsense numbers", () => {
    const image = { width: 300, height: 200 };
    const crop = clampCrop(image, V, { zoom: Number.NaN, offsetX: Number.NaN, offsetY: Infinity });
    expect(crop.zoom).toBe(1);
    expect(Number.isFinite(crop.offsetX) && Number.isFinite(crop.offsetY)).toBe(true);
  });
});
