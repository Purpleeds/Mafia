import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMafiaServer, type MafiaServerInstance } from "../app.js";
import { createMemoryLogger } from "../logger.js";
import { AVATAR, TestClient, expectError, expectOk, roomWith, waitFor } from "../testing/socketClient.js";

let server: MafiaServerInstance;
let url: string;
const clients: TestClient[] = [];

function client(): TestClient {
  const c = new TestClient(url);
  clients.push(c);
  return c;
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
      hostAction: { capacity: 1000, refillPerSecond: 100 },
      chat: { capacity: 1000, refillPerSecond: 100 },
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

const lastChat = (c: TestClient) => c.chat[c.chat.length - 1]?.text;

describe("Uncensored chat can't be turned on in Safe Mode", () => {
  it("refuses every way of asking for it, and the room stays strict", async () => {
    const [host, ana] = [client(), client()];
    await roomWith(host, [ana]);
    expect(host.view.settings).toMatchObject({ contentMode: "safe", chatFilter: "strict" });

    for (const patch of [
      { chatFilter: "uncensored" },
      { chatFilter: "standard" },
      { contentMode: "safe", chatFilter: "uncensored" },
      { chatFilter: "uncensored", contentMode: "safe" },
      { profanityFilter: false },
      { chatFilter: "uncensored", sneakyGang: true },
    ]) {
      const result = (await host.raw("host:updateSettings", patch)) as { ok: boolean; error?: { code: string } };
      expectError(result, "INVALID_SETTINGS");
    }
    // Not even a non-host trying the Normal Mode route.
    expectError(await ana.call("host:updateSettings", { contentMode: "normal", chatFilter: "uncensored" }), "NOT_HOST");
    // Bad shapes are refused before they reach the rules.
    expectError((await host.raw("host:updateSettings", "uncensored")) as { ok: boolean; error?: { code: string } }, "BAD_REQUEST");

    expect(host.view.settings).toMatchObject({ contentMode: "safe", chatFilter: "strict", sneakyGang: false });
    // And chat really is strict: strong and mild words are hidden for everyone.
    expectOk(await ana.call("chat:send", { text: "damn this shit" }));
    await waitFor(() => host.chat.length > 0, "the message");
    expect(lastChat(host)).toBe("**** this ****");
  });

  it("ignores it in a new room's remembered settings too", async () => {
    const host = client();
    host.session = expectOk(
      await host.call("room:create", { name: "Ana", avatar: AVATAR, settings: { contentMode: "safe", chatFilter: "uncensored" } }),
    );
    await waitFor(() => host.state !== null, "state");
    expect(host.view.settings).toMatchObject({ contentMode: "safe", chatFilter: "strict" });

    const normal = client();
    normal.session = expectOk(
      await normal.call("room:create", { name: "Ben", avatar: AVATAR, settings: { contentMode: "normal", chatFilter: "uncensored" } }),
    );
    await waitFor(() => normal.state !== null, "state");
    expect(normal.view.settings).toMatchObject({ contentMode: "normal", chatFilter: "uncensored" });
  });

  it("switches back to strict the moment the host returns to Safe Mode", async () => {
    const [host, ana] = [client(), client()];
    await roomWith(host, [ana]);
    expectOk(await host.call("host:updateSettings", { contentMode: "normal", chatFilter: "uncensored" }));
    expectOk(await ana.call("chat:send", { text: "what the shit" }));
    await waitFor(() => lastChat(host) === "what the shit", "uncensored message");
    expectOk(await host.call("host:updateSettings", { contentMode: "safe" }));
    await waitFor(() => host.view.settings.chatFilter === "strict", "strict again");
    expectOk(await ana.call("chat:send", { text: "what the shit" }));
    await waitFor(() => lastChat(host) === "what the ****", "filtered message");
  });
});

describe("chat limits that stay on in Uncensored", () => {
  it("still blocks links, long messages and floods, and the host can still remove people", async () => {
    const [host, ana, ben] = [client(), client(), client()];
    await roomWith(host, [ana, ben]);
    expectOk(await host.call("host:updateSettings", { contentMode: "normal", chatFilter: "uncensored" }));
    expectError(await ana.call("chat:send", { text: "free stuff at https://scam.example/win" }), "CHAT_LINK");
    expectError(await ana.call("chat:send", { text: "go to free-robux.com" }), "CHAT_LINK");
    expectError(await ana.call("chat:send", { text: "x".repeat(301) }), "BAD_REQUEST");
    expectOk(await host.call("host:kick", { playerId: ana.id }));
    await waitFor(() => ana.removed !== null, "Ana removed");
    expect(ben.chat).toEqual([]);
  });
});
