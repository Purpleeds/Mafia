import type { Room } from "./types.js";

/**
 * Where rooms live. Async so it can be backed by Redis later (get/save as JSON,
 * `create` as SET NX). Callers serialise access per room code themselves (see
 * RoomService), so implementations only need atomic single-key operations.
 */
export interface RoomStore {
  get(code: string): Promise<Room | undefined>;
  /** Inserts the room only if its code is free; returns false if the code is taken. */
  create(room: Room): Promise<boolean>;
  save(room: Room): Promise<void>;
  delete(code: string): Promise<void>;
  codes(): Promise<string[]>;
  count(): Promise<number>;
}

/**
 * In-process store backed by a Map. Rooms are copied in and out so callers
 * can't change stored data without calling save() (the same behaviour a
 * networked store would have).
 */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();

  async get(code: string): Promise<Room | undefined> {
    const room = this.rooms.get(code);
    return room ? structuredClone(room) : undefined;
  }

  async create(room: Room): Promise<boolean> {
    if (this.rooms.has(room.code)) return false;
    this.rooms.set(room.code, structuredClone(room));
    return true;
  }

  async save(room: Room): Promise<void> {
    this.rooms.set(room.code, structuredClone(room));
  }

  async delete(code: string): Promise<void> {
    this.rooms.delete(code);
  }

  async codes(): Promise<string[]> {
    return [...this.rooms.keys()];
  }

  async count(): Promise<number> {
    return this.rooms.size;
  }
}
