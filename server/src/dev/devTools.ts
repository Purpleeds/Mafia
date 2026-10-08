/**
 * Everything that only exists in development: the bots and the debug snapshot.
 * app.ts builds this only when dev tools are switched on (never in production)
 * and the socket layer only answers the dev events when it has one.
 */
import type { DevDebugSnapshot } from "@mafia/shared";
import { cryptoRng, nextWake, type Rng } from "../game/index.js";
import type { Logger } from "../logger.js";
import type { RoomStore } from "../rooms/roomStore.js";
import type { RoomService, ServiceResult } from "../rooms/roomService.js";
import { BotManager, type BotOptions } from "./bots.js";

export interface DevToolsOptions {
  service: RoomService;
  store: RoomStore;
  logger: Logger;
  clock: () => number;
  rng?: Rng;
  bots?: Partial<BotOptions>;
}

/** Dev tools are on unless the server runs in production (NODE_ENV, or Render's RENDER=true). */
export function devToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.RENDER !== "true";
}

export class DevTools {
  readonly bots: BotManager;
  private readonly store: RoomStore;
  private readonly clock: () => number;

  constructor(options: DevToolsOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.bots = new BotManager(options.service, options.store, options.logger, {
      rng: options.rng ?? cryptoRng,
      ...options.bots,
    });
  }

  start(): void {
    this.bots.start();
  }

  stop(): void {
    this.bots.stop();
  }

  /** The room's whole state, secrets included. Any member of the room may look (it is a dev tool). */
  async debugSnapshot(code: string, memberId: string): Promise<ServiceResult<DevDebugSnapshot>> {
    const room = await this.store.get(code);
    if (!room) return { ok: false, error: { code: "ROOM_NOT_FOUND", message: "That room doesn't exist." } };
    const { state } = room;
    const member = state.players.some((p) => p.id === memberId) || state.spectators.some((s) => s.id === memberId);
    if (!member) return { ok: false, error: { code: "NOT_IN_ROOM", message: "You are not in this room." } };
    return {
      ok: true,
      value: {
        serverNow: this.clock(),
        state,
        botIds: this.bots.botIds(code),
        timerAt: nextWake(state),
        chatMessages: room.chat.length,
        members: state.players.length + state.spectators.length,
      },
    };
  }
}

