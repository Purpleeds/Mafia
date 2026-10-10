/**
 * Development only: the debug snapshot (the whole game state, secrets
 * included). app.ts builds this only when dev tools are switched on (never in
 * production) and the socket layer only answers the dev event when it has one.
 * Bots are a real feature now (see ../bots); they don't live here.
 */
import type { DevDebugSnapshot } from "@mafia/shared";
import { nextWake } from "../game/index.js";
import type { RoomStore } from "../rooms/roomStore.js";
import type { ServiceResult } from "../rooms/roomService.js";

export interface DevToolsOptions {
  store: RoomStore;
  clock: () => number;
}

/** Dev tools are on unless the server runs in production (NODE_ENV, or Render's RENDER=true). */
export function devToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.RENDER !== "true";
}

export class DevTools {
  private readonly store: RoomStore;
  private readonly clock: () => number;

  constructor(options: DevToolsOptions) {
    this.store = options.store;
    this.clock = options.clock;
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
        botIds: state.players.filter((p) => p.isBot || p.botControlled).map((p) => p.id),
        timerAt: nextWake(state),
        chatMessages: room.chat.length,
        members: state.players.length + state.spectators.length,
      },
    };
  }
}
