import type {
  ChatHistoryPayload,
  ChatMessage,
  GameStatePayload,
  NarratorRequestPayload,
  RemovedPayload,
} from "@mafia/shared";
import { mulberry32 } from "../../game/index.js";
import { createMemoryLogger } from "../../logger.js";
import { MemoryRoomStore } from "../roomStore.js";
import { RoomService, type Broadcaster, type RoomServiceOptions } from "../roomService.js";
import type { Scheduler } from "../scheduler.js";

export type Sent =
  | { kind: "state"; room: string; player: string; payload: GameStatePayload }
  | { kind: "chat"; room: string; player: string; payload: ChatMessage }
  | { kind: "history"; room: string; player: string; payload: ChatHistoryPayload }
  | { kind: "removed"; room: string; player: string; payload: RemovedPayload }
  | { kind: "narration"; room: string; player: string; payload: NarratorRequestPayload };

export class FakeBroadcaster implements Broadcaster {
  sent: Sent[] = [];
  state(room: string, player: string, payload: GameStatePayload) {
    this.sent.push({ kind: "state", room, player, payload });
  }
  chat(room: string, player: string, payload: ChatMessage) {
    this.sent.push({ kind: "chat", room, player, payload });
  }
  chatHistory(room: string, player: string, payload: ChatHistoryPayload) {
    this.sent.push({ kind: "history", room, player, payload });
  }
  removed(room: string, player: string, payload: RemovedPayload) {
    this.sent.push({ kind: "removed", room, player, payload });
  }
  narrationRequest(room: string, player: string, payload: NarratorRequestPayload) {
    this.sent.push({ kind: "narration", room, player, payload });
  }
  /** Narrator requests, and who they were sent to. */
  narrationRequests(): Array<{ player: string; payload: NarratorRequestPayload }> {
    return this.sent.flatMap((s) => (s.kind === "narration" ? [{ player: s.player, payload: s.payload }] : []));
  }
  to(player: string): Sent[] {
    return this.sent.filter((s) => s.player === player);
  }
  lastState(player: string): GameStatePayload {
    const states = this.sent.filter((s): s is Extract<Sent, { kind: "state" }> => s.kind === "state" && s.player === player);
    const last = states[states.length - 1];
    if (!last) throw new Error(`no state sent to ${player}`);
    return last.payload;
  }
  chatsTo(player: string): ChatMessage[] {
    return this.sent.filter((s): s is Extract<Sent, { kind: "chat" }> => s.kind === "chat" && s.player === player).map((s) => s.payload);
  }
}

export class FakeScheduler implements Scheduler {
  timers = new Map<string, { at: number; fn: () => void }>();
  set(key: string, at: number, fn: () => void) {
    this.timers.set(key, { at, fn });
  }
  clear(key: string) {
    this.timers.delete(key);
  }
  clearAll() {
    this.timers.clear();
  }
  at(key: string): number | undefined {
    return this.timers.get(key)?.at;
  }
}

export function makeService(overrides: Partial<RoomServiceOptions> = {}) {
  const clock = { now: 1_000_000 };
  const broadcaster = new FakeBroadcaster();
  const scheduler = new FakeScheduler();
  const store = new MemoryRoomStore();
  const logger = createMemoryLogger();
  const service = new RoomService({
    store,
    broadcaster,
    scheduler,
    logger,
    clock: () => clock.now,
    rng: mulberry32(3),
    ...overrides,
  });
  /** Runs the room's timer as if its deadline had arrived. */
  const fireTimer = async (code: string) => {
    const timer = scheduler.timers.get(code);
    if (!timer) throw new Error(`no timer for ${code}`);
    clock.now = Math.max(clock.now, timer.at);
    await service.handleTimer(code);
  };
  return { service, clock, broadcaster, scheduler, store, logger, fireTimer };
}
