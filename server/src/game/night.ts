import type { GameError, NightActionKind } from "@mafia/shared";
import { killPlayers } from "./deaths.js";
import { pickRandom } from "./rng.js";
import { findPlayer, livingPlayers } from "./state.js";
import type { DeathRecord, GameEnv, GameState, NightLog, PlayerState } from "./types.js";
import { evaluateWinner } from "./win.js";

export interface AvailableNightAction {
  kind: NightActionKind;
  validTargetIds: string[];
}

/** What (if anything) this player can do tonight, and to whom. */
export function availableNightAction(state: GameState, player: PlayerState): AvailableNightAction | null {
  if (!player.alive || player.role === null) return null;
  const living = livingPlayers(state);
  const ids = (list: PlayerState[]) => list.map((p) => p.id);

  switch (player.role) {
    case "mafia":
      return { kind: "kill", validTargetIds: ids(living.filter((p) => p.role !== "mafia")) };
    case "doctor":
      return {
        kind: "protect",
        validTargetIds: ids(living.filter((p) => p.id !== state.doctorLastProtectedId)),
      };
    case "detective":
      return { kind: "investigate", validTargetIds: ids(living.filter((p) => p.id !== player.id)) };
    case "bodyguard":
      return { kind: "guard", validTargetIds: ids(living.filter((p) => p.id !== player.id)) };
    case "cupid":
      // Cupid links once, on the first night.
      if (state.round !== 1 || state.lovers) return null;
      return { kind: "link", validTargetIds: ids(living) };
    default:
      return null;
  }
}

const err = (code: GameError["code"], message: string): GameError => ({ code, message });

export function submitNightAction(
  state: GameState,
  actor: PlayerState,
  targetId: string,
  secondTargetId?: string,
): GameError | null {
  const action = availableNightAction(state, actor);
  if (!action) return err("NO_ABILITY", "You have nothing to do tonight.");

  if (action.kind === "link") {
    if (secondTargetId === undefined) return err("INVALID_TARGET", "Pick two players to link.");
    if (targetId === secondTargetId) return err("INVALID_TARGET", "Pick two different players.");
    if (!action.validTargetIds.includes(targetId) || !action.validTargetIds.includes(secondTargetId)) {
      return err("INVALID_TARGET", "Both players must be alive.");
    }
    state.night.link = [targetId, secondTargetId];
    return null;
  }

  if (!action.validTargetIds.includes(targetId)) {
    if (action.kind === "protect" && targetId === state.doctorLastProtectedId) {
      return err("REPEAT_PROTECTION", "You can't protect the same person two nights in a row.");
    }
    return err("INVALID_TARGET", "That isn't a valid choice.");
  }

  switch (action.kind) {
    case "kill":
      state.night.mafiaVotes[actor.id] = targetId;
      break;
    case "protect":
      state.night.protect = targetId;
      break;
    case "investigate":
      state.night.investigate = targetId;
      break;
    case "guard":
      state.night.guard = targetId;
      break;
  }
  return null;
}

function hasActed(state: GameState, player: PlayerState, kind: NightActionKind): boolean {
  switch (kind) {
    case "kill":
      return Object.hasOwn(state.night.mafiaVotes, player.id);
    case "protect":
      return state.night.protect !== null;
    case "investigate":
      return state.night.investigate !== null;
    case "guard":
      return state.night.guard !== null;
    case "link":
      return state.night.link !== null;
  }
}

/**
 * True once every living, connected player who has a night action has acted.
 * Disconnected players are not waited for. If nobody is required, the night
 * simply runs until its timer.
 */
export function isNightComplete(state: GameState): boolean {
  let required = 0;
  for (const player of state.players) {
    if (!player.connected) continue;
    const action = availableNightAction(state, player);
    if (!action) continue;
    required++;
    if (!hasActed(state, player, action.kind)) return false;
  }
  return required > 0;
}

/** The Mafia's pick: most votes wins, ties broken at random, no votes = no kill. */
function mafiaTarget(state: GameState, env: GameEnv): string | null {
  const counts = new Map<string, number>();
  for (const player of state.players) {
    const vote = state.night.mafiaVotes[player.id];
    if (vote !== undefined && player.role === "mafia") counts.set(vote, (counts.get(vote) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const top = Math.max(...counts.values());
  // Iterate in player order so the pool is stable for a given seed.
  const leaders = state.players.map((p) => p.id).filter((id) => counts.get(id) === top);
  return pickRandom(leaders, env.rng);
}

/**
 * Applies the night's actions: Cupid links, the Detective learns, then the
 * Mafia attack is resolved against the Doctor and Bodyguard.
 *
 * Order of defences: a Doctor save cancels the attack outright; otherwise a
 * Bodyguard guarding the target dies in their place; otherwise the target dies.
 * A linked partner of anyone who dies also dies.
 */
export function resolveNight(state: GameState, env: GameEnv): void {
  const { night } = state;

  if (night.link && !state.lovers) state.lovers = night.link;

  if (night.investigate) {
    const target = findPlayer(state, night.investigate);
    if (target) {
      state.investigations.push({
        round: state.round,
        targetId: target.id,
        isMafia: target.role === "mafia",
      });
    }
  }

  const initial: DeathRecord[] = [];
  const target = mafiaTarget(state, env);
  let outcome: NightLog["outcome"] = target === null ? "no_attack" : "killed";
  if (target !== null && night.protect === target) {
    outcome = "saved";
  } else if (target !== null) {
    let victim = target;
    if (night.guard === target) {
      const bodyguard = livingPlayers(state).find((p) => p.role === "bodyguard");
      if (bodyguard && bodyguard.id !== target) {
        victim = bodyguard.id;
        outcome = "guarded";
      }
    }
    initial.push({ playerId: victim, cause: "mafia" });
  }

  state.doctorLastProtectedId = night.protect;
  const deaths = killPlayers(state, initial);
  state.nightReport = { round: state.round, deaths, saved: outcome === "saved" };
  state.history.push({
    round: state.round,
    night: {
      mafiaTargetId: target,
      protectedId: night.protect,
      guardedId: night.guard,
      linkedIds: night.link,
      investigation: night.investigate
        ? { targetId: night.investigate, isMafia: findPlayer(state, night.investigate)?.role === "mafia" }
        : null,
      outcome,
      deaths,
    },
    vote: null,
  });
  state.pendingWinner = evaluateWinner(state);
}
