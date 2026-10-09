import { randomBytes } from "node:crypto";

/** A player's uploaded picture, as the server re-encoded it. Never written to Key Value or disk. */
export interface StoredAvatar {
  /** Random, new for every upload, so a browser never shows an old picture by mistake. */
  id: string;
  /** data:image/webp;base64,... (always the server's own encoding). */
  dataUrl: string;
  status: "pending" | "approved";
}

export function newAvatarId(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Uploaded avatar pictures, in memory only, per room and member. They go
 * when the member leaves or the room closes (and on a restart, which the
 * free hosting plan has no disk to survive). Also remembers which pictures
 * each member's browser has already been sent, so each is sent once.
 */
export class AvatarStore {
  private readonly rooms = new Map<string, Map<string, StoredAvatar>>();
  private readonly delivered = new Map<string, Map<string, Set<string>>>();

  get(code: string, memberId: string): StoredAvatar | undefined {
    return this.rooms.get(code)?.get(memberId);
  }

  /** Every picture in a room, by member id. */
  entries(code: string): Array<[memberId: string, avatar: StoredAvatar]> {
    return [...(this.rooms.get(code) ?? new Map<string, StoredAvatar>()).entries()];
  }

  set(code: string, memberId: string, avatar: StoredAvatar): void {
    const room = this.rooms.get(code) ?? new Map<string, StoredAvatar>();
    room.set(memberId, avatar);
    this.rooms.set(code, room);
  }

  /** Forgets a member's picture (and what was sent to them). True if they had one. */
  remove(code: string, memberId: string): boolean {
    const room = this.rooms.get(code);
    const had = room?.delete(memberId) ?? false;
    if (room?.size === 0) this.rooms.delete(code);
    this.delivered.get(code)?.delete(memberId);
    return had;
  }

  removeRoom(code: string): void {
    this.rooms.delete(code);
    this.delivered.delete(code);
  }

  /** The picture with this id, if it is still in the room. */
  byId(code: string, id: string): StoredAvatar | undefined {
    for (const avatar of this.rooms.get(code)?.values() ?? []) if (avatar.id === id) return avatar;
    return undefined;
  }

  /** Of `visible`, the ids this member hasn't been sent yet; they count as sent from now on. */
  takeUndelivered(code: string, memberId: string, visible: Iterable<string>): string[] {
    const room = this.delivered.get(code) ?? new Map<string, Set<string>>();
    this.delivered.set(code, room);
    const sent = room.get(memberId) ?? new Set<string>();
    room.set(memberId, sent);
    const fresh = [...visible].filter((id) => !sent.has(id));
    for (const id of fresh) sent.add(id);
    return fresh;
  }

  /** The member's browser starts afresh (a new connection): send everything again. */
  resetDelivered(code: string, memberId: string): void {
    this.delivered.get(code)?.delete(memberId);
  }

  /** How many pictures are held, for the logs. */
  get size(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.size;
    return n;
  }
}
