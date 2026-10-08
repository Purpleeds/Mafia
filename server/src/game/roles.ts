import { OPTIONAL_ROLES, type OptionalRole, type Role } from "@mafia/shared";
import { shuffle, type Rng } from "./rng.js";

/**
 * The multiset of roles for a game: `mafiaCount` Mafia, one Doctor, one
 * Detective, each switched-on optional role once, and Villagers for the rest.
 * Returns null if the special roles don't fit in `playerCount`.
 */
export function buildRoleList(
  playerCount: number,
  mafiaCount: number,
  optionalRoles: Record<OptionalRole, boolean>,
): Role[] | null {
  const roles: Role[] = [];
  for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
  roles.push("doctor", "detective");
  for (const role of OPTIONAL_ROLES) {
    if (optionalRoles[role]) roles.push(role);
  }
  if (roles.length > playerCount) return null;
  while (roles.length < playerCount) roles.push("villager");
  return roles;
}

/** Randomly deals the role list to the players. */
export function dealRoles(playerIds: readonly string[], roles: readonly Role[], rng: Rng): Record<string, Role> {
  const shuffled = shuffle(roles, rng);
  const out: Record<string, Role> = {};
  playerIds.forEach((id, i) => {
    out[id] = shuffled[i] ?? "villager";
  });
  return out;
}
