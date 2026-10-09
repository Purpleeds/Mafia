/**
 * The geometry behind the square crop: the picture is shown in a square
 * viewport, always covering it, at a zoom of 1 (the short side fits) up to
 * MAX_ZOOM. `offset` is where the picture's top-left corner sits relative to
 * the viewport's (so it is always zero or negative).
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface CropState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Scale (viewport pixels per picture pixel) at this zoom. */
export function scaleFor(image: Size, viewport: number, zoom: number): number {
  return (viewport / Math.min(image.width, image.height)) * zoom;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : MIN_ZOOM));
}

/** Keeps the picture covering the whole viewport (no empty edges). */
export function clampCrop(image: Size, viewport: number, crop: CropState): CropState {
  const zoom = clampZoom(crop.zoom);
  const scale = scaleFor(image, viewport, zoom);
  const minX = viewport - image.width * scale;
  const minY = viewport - image.height * scale;
  const clamp = (v: number, min: number) => Math.min(0, Math.max(min, Number.isFinite(v) ? v : 0));
  return { zoom, offsetX: clamp(crop.offsetX, minX), offsetY: clamp(crop.offsetY, minY) };
}

/** The starting crop: zoom 1, centred. */
export function initialCrop(image: Size, viewport: number): CropState {
  const scale = scaleFor(image, viewport, 1);
  return clampCrop(image, viewport, {
    zoom: 1,
    offsetX: (viewport - image.width * scale) / 2,
    offsetY: (viewport - image.height * scale) / 2,
  });
}

/**
 * Zooms around a point of the viewport (the centre for the slider, the
 * pointer for a wheel), so what is under it stays put.
 */
export function zoomAround(image: Size, viewport: number, crop: CropState, zoom: number, at = viewport / 2): CropState {
  const next = clampZoom(zoom);
  const before = scaleFor(image, viewport, crop.zoom);
  const after = scaleFor(image, viewport, next);
  const ratio = after / before;
  return clampCrop(image, viewport, {
    zoom: next,
    offsetX: at - (at - crop.offsetX) * ratio,
    offsetY: at - (at - crop.offsetY) * ratio,
  });
}

/** The square of the original picture (in its own pixels) that the viewport shows. */
export function sourceSquare(image: Size, viewport: number, crop: CropState): { x: number; y: number; size: number } {
  const c = clampCrop(image, viewport, crop);
  const scale = scaleFor(image, viewport, c.zoom);
  const size = Math.min(viewport / scale, image.width, image.height);
  const x = Math.min(Math.max(0, -c.offsetX / scale), image.width - size);
  const y = Math.min(Math.max(0, -c.offsetY / scale), image.height - size);
  return { x, y, size };
}
