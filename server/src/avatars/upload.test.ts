import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, AVATAR_ROOM_HEADER, AVATAR_UPLOAD_PATH, type AckResult } from "@mafia/shared";
import { createMafiaServer, type MafiaServerInstance } from "../app.js";
import { createMemoryLogger } from "../logger.js";
import { TestClient, expectError, expectOk, roomWith, waitFor } from "../testing/socketClient.js";

let server: MafiaServerInstance;
let url: string;
const clients: TestClient[] = [];

function client(): TestClient {
  const c = new TestClient(url);
  clients.push(c);
  return c;
}

const png = () =>
  sharp({ create: { width: 200, height: 160, channels: 3, background: { r: 20, g: 140, b: 220 } } }).png().toBuffer();
const gif = () => sharp({ create: { width: 20, height: 20, channels: 3, background: "#ff00ff" } }).gif().toBuffer();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="9" height="9"/></svg>');

async function upload(
  who: TestClient,
  body: Buffer,
  opts: { contentType?: string; token?: string; room?: string } = {},
): Promise<{ status: number; result: AckResult<{ status: "pending" | "approved" }> }> {
  const session = who.session;
  const response = await fetch(`${url}${AVATAR_UPLOAD_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token ?? session?.sessionToken ?? ""}`,
      [AVATAR_ROOM_HEADER]: opts.room ?? session?.roomCode ?? "",
      "Content-Type": opts.contentType ?? "application/octet-stream",
    },
    body: new Uint8Array(body),
  });
  return { status: response.status, result: (await response.json()) as AckResult<{ status: "pending" | "approved" }> };
}

async function settings(host: TestClient, patch: Record<string, unknown>) {
  expectOk(await host.call("host:updateSettings", patch));
}

beforeAll(async () => {
  server = createMafiaServer({
    clientDist: null,
    logger: createMemoryLogger(),
    service: { maxRoomsPerOwner: 1000 },
    rateLimits: {
      connection: { capacity: 1000, refillPerSecond: 100 },
      joinRoom: { capacity: 1000, refillPerSecond: 100 },
      createRoom: { capacity: 1000, refillPerSecond: 100 },
      avatarIp: { capacity: 1000, refillPerSecond: 100 },
    },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

afterAll(async () => {
  await server.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

describe("avatar uploads: who sees what", () => {
  it("shows a picture to everyone in the room straight away when pictures are on, and to nobody outside it", async () => {
    const [host, ana, ben] = [client(), client(), client()];
    const outsider = client();
    await roomWith(host, [ana, ben]);
    await roomWith(outsider, []);
    await settings(host, { contentMode: "normal" }); // Normal Mode: pictures on by default
    expect(host.view.settings.customAvatars).toBe("on");

    const { status, result } = await upload(ana, await png(), { contentType: "image/png" });
    expect(status).toBe(200);
    expect(result).toEqual({ ok: true, data: { status: "approved" } });

    await waitFor(() => ben.view.players.some((p) => p.id === ana.id && p.avatar.photo), "Ben sees Ana's picture");
    const photo = ben.view.players.find((p) => p.id === ana.id)?.avatar.photo ?? "";
    for (const c of [host, ana, ben]) {
      await waitFor(() => c.images.has(photo), "the picture itself");
      expect(c.images.get(photo)).toMatch(/^data:image\/webp;base64,/);
    }
    expect(ana.view.you?.photo).toEqual({ id: photo, status: "approved" });
    // Someone in another room gets nothing.
    await new Promise((r) => setTimeout(r, 50));
    expect(outsider.images.size).toBe(0);
    expect(JSON.stringify(outsider.received)).not.toContain(photo);
  });

  it("waits for the host's approval in Safe Mode: only the uploader and the host see it until then", async () => {
    const [host, ana, ben] = [client(), client(), client()];
    await roomWith(host, [ana, ben]);
    expect(host.view.settings).toMatchObject({ contentMode: "safe", customAvatars: "approval" });

    const { result } = await upload(ana, await png());
    expect(result).toEqual({ ok: true, data: { status: "pending" } });
    await waitFor(() => host.view.avatarRequests.length === 1, "the host's request");
    const request = host.view.avatarRequests[0];
    expect(request?.playerId).toBe(ana.id);
    await waitFor(() => host.images.has(request?.photo ?? "") && ana.images.has(request?.photo ?? ""), "pending picture");
    expect(ana.view.you?.photo).toMatchObject({ status: "pending" });
    // Others see the drawn avatar, and never get the picture or the request.
    expect(ben.view.players.find((p) => p.id === ana.id)?.avatar.photo).toBeUndefined();
    expect(ben.view.avatarRequests).toEqual([]);
    expect(ben.images.size).toBe(0);
    expect(expectError(await ben.call("host:reviewAvatar", { playerId: ana.id, approve: true }), "NOT_HOST"));

    expectOk(await host.call("host:reviewAvatar", { playerId: ana.id, approve: true }));
    await waitFor(() => ben.images.has(request?.photo ?? ""), "Ben gets the approved picture");
    await waitFor(() => ana.notices.some((n) => n.kind === "avatar_approved"), "Ana is told");
    expect(ben.view.players.find((p) => p.id === ana.id)?.avatar.photo).toBe(request?.photo);
  });

  it("deletes a picture the host turns down, and tells the player", async () => {
    const [host, ana] = [client(), client()];
    const code = await roomWith(host, [ana]);
    await upload(ana, await png());
    await waitFor(() => host.view.avatarRequests.length === 1, "request");
    expectOk(await host.call("host:reviewAvatar", { playerId: ana.id, approve: false }));
    await waitFor(() => ana.notices.some((n) => n.kind === "avatar_rejected"), "Ana is told");
    expect(server.service.avatars.get(code, ana.id)).toBeUndefined();
    await waitFor(() => ana.view.you?.photo === null, "Ana's view");
  });

  it("lets the host remove anyone's picture at any time, back to the drawn avatar", async () => {
    const [host, ana, ben] = [client(), client(), client()];
    const code = await roomWith(host, [ana, ben]);
    await settings(host, { customAvatars: "on" });
    await upload(ana, await png());
    await waitFor(() => ben.view.players.some((p) => p.avatar.photo), "picture showing");
    expectError(await ben.call("host:removeAvatar", { playerId: ana.id }), "NOT_HOST");
    expectOk(await host.call("host:removeAvatar", { playerId: ana.id }));
    await waitFor(() => ben.view.players.every((p) => !p.avatar.photo), "picture gone");
    await waitFor(() => ana.notices.some((n) => n.kind === "avatar_removed"), "Ana is told");
    expect(server.service.avatars.get(code, ana.id)).toBeUndefined();
  });

  it("forgets a picture when its player leaves, and every picture when the room closes", async () => {
    const [host, ana] = [client(), client()];
    const code = await roomWith(host, [ana]);
    await settings(host, { customAvatars: "on" });
    await upload(ana, await png());
    await upload(host, await png());
    expect(server.service.avatars.get(code, ana.id)).toBeDefined();
    expectOk(await ana.call("room:leave", {}));
    expect(server.service.avatars.get(code, ana.id)).toBeUndefined();
    expect(server.service.avatars.get(code, host.id)).toBeDefined();
    expectOk(await host.call("room:leave", {}));
    expect(server.service.avatars.entries(code)).toEqual([]);
  });
});

describe("avatar uploads: what is refused", () => {
  it("refuses files that aren't really PNG, JPG or WebP, whatever their name or claimed type", async () => {
    for (const [body, type] of [
      [SVG, "image/png"],
      [SVG, "image/svg+xml"],
      [await gif(), "image/png"],
      [Buffer.from("MZ\x90\x00 not a picture"), "image/jpeg"],
    ] as const) {
      // A fresh player each time (failed tries count towards the 3 a minute too).
      const host = client();
      await roomWith(host, []);
      const { status, result } = await upload(host, body, { contentType: type });
      expect(status, type).toBe(415);
      expect(!result.ok && result.error.code).toBe("AVATAR_INVALID");
      expect(host.view.you?.photo).toBeNull();
    }
  });

  it("refuses files over 2 MB without reading them", async () => {
    const [host] = [client()];
    await roomWith(host, []);
    const { status, result } = await upload(host, Buffer.alloc(AVATAR_MAX_BYTES + 1, 1));
    expect(status).toBe(413);
    expect(!result.ok && result.error.code).toBe("AVATAR_TOO_LARGE");
  });

  it("allows 3 uploads a minute per player", async () => {
    const [host, ana] = [client(), client()];
    await roomWith(host, [ana]);
    const picture = await png();
    for (let i = 0; i < 3; i++) expect((await upload(ana, picture)).status).toBe(200);
    const fourth = await upload(ana, picture);
    expect(fourth.status).toBe(429);
    expect(!fourth.result.ok && fourth.result.error.code).toBe("RATE_LIMITED");
    // It's per player: the host can still upload.
    expect((await upload(host, picture)).status).toBe(200);
  });

  it("needs a real seat in that room, in the lobby, with pictures allowed", async () => {
    const [host, ana] = [client(), client()];
    const other = client();
    const code = await roomWith(host, [ana]);
    await roomWith(other, []);
    const picture = await png();
    expect((await upload(ana, picture, { token: "x".repeat(40) })).status).toBe(401);
    expect((await upload(ana, picture, { token: "" })).status).toBe(400);
    // A real token, but for another room.
    expect((await upload(other, picture, { room: code })).status).toBe(401);
    expect((await upload(ana, picture, { room: "ZZZZ" })).status).toBe(404);

    await settings(host, { customAvatars: "off" });
    const off = await upload(ana, picture);
    expect(off.status).toBe(403);
    expect(!off.result.ok && off.result.error.code).toBe("AVATARS_OFF");
  });
});
