import type { IncomingMessage } from "node:http";
import type { Request, RequestHandler, Response } from "express";
import { AVATAR_MAX_BYTES, AVATAR_ROOM_HEADER, normalizeRoomCode, type AckResult, type ErrorCode } from "@mafia/shared";
import type { Logger } from "../logger.js";
import type { RoomService } from "../rooms/roomService.js";
import type { RateLimiter, WindowLimiter } from "../socket/rateLimiter.js";
import { processAvatarImage, toDataUrl } from "./process.js";

export interface AvatarUploadOptions {
  service: RoomService;
  logger: Logger;
  /** Per-IP limit ("avatarIp"), checked before anything else. */
  limiter: RateLimiter;
  /** Per player: 3 uploads a minute. */
  perPlayer: WindowLimiter;
}

const STATUS: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  AVATAR_INVALID: 415,
  AVATAR_TOO_LARGE: 413,
  SESSION_INVALID: 401,
  NOT_IN_ROOM: 401,
  ROOM_NOT_FOUND: 404,
  AVATARS_OFF: 403,
  WRONG_PHASE: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
};

function reply(res: Response, result: AckResult<unknown>): void {
  const status = result.ok ? 200 : (STATUS[result.error.code] ?? 400);
  // A refused upload may still be sending its bytes: close the connection rather than read them.
  if (!result.ok) res.set("Connection", "close");
  res.status(status).set("Cache-Control", "no-store").json(result);
}

const failure = (code: ErrorCode, message: string): AckResult<never> => ({ ok: false, error: { code, message } });

/** Reads the request body, giving up as soon as it is bigger than `limit`. Null if too big. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!done) reject(err);
    });
  });
}

function bearerToken(req: Request): string | null {
  const header = req.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(header);
  return match?.[1] ?? null;
}

/**
 * POST /api/avatar: a player's picture, as raw bytes, with the room code in
 * X-Room-Code and their session token as a Bearer token.
 *
 * Nothing about the upload is trusted. In order: a per-IP limit; the session
 * must belong to someone in the room, in the lobby, with pictures allowed;
 * three uploads a minute per player; at most 2 MB (refused as soon as it is
 * bigger, without reading the rest); then the picture is checked from its own
 * bytes and re-encoded (see processAvatarImage) before anyone can see it.
 */
export function avatarUploadHandler(options: AvatarUploadOptions): RequestHandler {
  const { service, logger, limiter, perPlayer } = options;
  return (req, res) => {
    req.setTimeout(20_000);
    void (async () => {
      const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
      if (!limiter.consume(`ip:${ip}`, "avatarIp")) {
        reply(res, failure("RATE_LIMITED", "Too many uploads from here. Wait a minute and try again."));
        return;
      }
      const roomCode = normalizeRoomCode(req.get(AVATAR_ROOM_HEADER));
      const token = bearerToken(req);
      if (roomCode === null || token === null) {
        reply(res, failure("BAD_REQUEST", "Join a room before uploading a picture."));
        return;
      }
      const declared = Number(req.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
        reply(res, failure("AVATAR_TOO_LARGE", "Pictures can be at most 2 MB."));
        return;
      }

      const auth = await service.authorizeAvatarUpload(roomCode, token);
      if (!auth.ok) {
        reply(res, { ok: false, error: auth.error });
        return;
      }
      const { memberId } = auth.value;
      if (!perPlayer.consume(`${roomCode}:${memberId}`)) {
        reply(res, failure("RATE_LIMITED", "You can upload 3 pictures a minute. Wait a moment and try again."));
        return;
      }

      const body = await readBody(req, AVATAR_MAX_BYTES);
      if (body === null) {
        reply(res, failure("AVATAR_TOO_LARGE", "Pictures can be at most 2 MB."));
        return;
      }
      const processed = await processAvatarImage(body);
      if (!processed.ok) {
        logger.warn("avatar.rejected", { room: roomCode, player: memberId, code: processed.code, bytes: body.length });
        reply(res, failure(processed.code, processed.message));
        return;
      }
      const saved = await service.saveAvatar(roomCode, memberId, toDataUrl(processed.webp));
      reply(res, saved.ok ? { ok: true, data: saved.value } : { ok: false, error: saved.error });
    })().catch((err: unknown) => {
      logger.error("avatar.upload_failed", {}, err);
      if (!res.headersSent) reply(res, failure("SERVER_ERROR", "Something went wrong on the server. Try again."));
    });
  };
}
