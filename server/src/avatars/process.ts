import sharp from "sharp";
import { AVATAR_MAX_BYTES, AVATAR_SIZE, avatarFileProblem, sniffImageType } from "@mafia/shared";

/**
 * Turns an uploaded file into a fresh avatar picture, trusting nothing about it.
 *
 *  1. Size: at most 2 MB, and not empty.
 *  2. Type from the bytes themselves (not the file name or the claimed type):
 *     only PNG, JPEG and WebP. GIF and SVG are refused before any decoder sees them.
 *  3. The decoder must agree it is that format, with one frame and a sane size.
 *  4. Re-encoded from the pixels alone into a new 128x128 WebP. Nothing from the
 *     original file survives: metadata (EXIF, location, comments), extra chunks
 *     and anything appended or hidden in it are gone.
 *
 * Anything that fails to decode cleanly is rejected.
 */
export type AvatarProblem = "AVATAR_INVALID" | "AVATAR_TOO_LARGE";
export type ProcessedAvatar = { ok: true; webp: Buffer } | { ok: false; code: AvatarProblem; message: string };

/** A decompression bomb (a small file that unpacks to a huge image) stops here. */
const MAX_INPUT_PIXELS = 4096 * 4096;

const SHARP_FORMAT = { png: "png", jpeg: "jpeg", webp: "webp" } as const;

sharp.cache(false);
sharp.concurrency(1);

const invalid = (message: string): ProcessedAvatar => ({ ok: false, code: "AVATAR_INVALID", message });

export async function processAvatarImage(input: Buffer): Promise<ProcessedAvatar> {
  if (input.length > AVATAR_MAX_BYTES) return { ok: false, code: "AVATAR_TOO_LARGE", message: "Pictures can be at most 2 MB." };
  const kind = sniffImageType(input);
  const problem = avatarFileProblem(kind, input.length);
  if (problem !== null || (kind !== "png" && kind !== "jpeg" && kind !== "webp")) {
    return invalid(problem ?? "That file isn't a PNG, JPG or WebP picture.");
  }

  try {
    const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning", animated: false } as const;
    const meta = await sharp(input, options).metadata();
    if (meta.format !== SHARP_FORMAT[kind]) return invalid("That file isn't a PNG, JPG or WebP picture.");
    if ((meta.pages ?? 1) > 1) return invalid("Animated pictures can't be used. Pick a still picture.");
    if (!meta.width || !meta.height) return invalid("That picture couldn't be read. Try another one.");

    const webp = await sharp(input, options)
      .rotate() // upright, from the camera's orientation tag (which is then dropped with the rest)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    if (sniffImageType(webp) !== "webp" || webp.length > 64 * 1024) {
      return invalid("That picture couldn't be read. Try another one.");
    }
    return { ok: true, webp };
  } catch {
    return invalid("That picture couldn't be read. Try another one.");
  }
}

export function toDataUrl(webp: Buffer): string {
  return `data:image/webp;base64,${webp.toString("base64")}`;
}
