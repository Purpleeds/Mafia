/**
 * What a bot says, decided here on the server: answers, defences, accusations,
 * alliances, call-outs of lies, and (as the Mafia) bluffs. The result is a
 * BotIntent: only what will be said in public, with nothing that marks a lie
 * as a lie. The intent's ready-made line ("says") comes from lines.ts in the
 * bot's style; the host's AI may rewrite it, keeping the meaning.
 *
 * The bot's role shapes WHAT it says (a Mafia bot claims to be a villager, a
 * Doctor hides until it's about to be voted out), never how it sounds: the
 * tone comes from its personality and the public pressure on it, so a lie and
 * the truth read the same.
 *
 *  - Mafia: claim Villager, or (good liars) pose as the Detective with made-up
 *    results on innocent players, kept consistent day after day; deflect onto
 *    whoever is already under pressure; join a growing vote; defend a teammate
 *    gently; never name a teammate. Pressured bad liars can slip up.
 *  - Detective: reveals sooner when it found the Mafia or is about to be voted
 *    out, then reports a result each day.
 *  - Doctor (and Bodyguard, Cupid): hides, and claims only to avoid the vote.
 *  - Villagers: pressure accusations to see how people react, alliances with
 *    players they trust, agreeing with accusations they believe.
 */
import { SKIP, gangName, type BotDifficulty, type GameView, type Role, type SpeechAct, type SpeechReason, type SpeechTone } from "@mafia/shared";
import { compose, nightWords, type LineKey } from "./lines.js";
import {
  claimers,
  heat,
  isAlive,
  living,
  me,
  playerName,
  score,
  topSuspect,
  votedFor,
  type Contradiction,
  type Mind,
  type Random,
} from "./mind.js";
import type { BotPersonality } from "./personality.js";
import type { BotIntent } from "./port.js";

export interface SpeechContext {
  mind: Mind;
  view: GameView;
  personality: BotPersonality;
  difficulty: BotDifficulty;
  random: Random;
  now: number;
}

export interface PlannedSpeech {
  intent: BotIntent;
  /** An answer to being spoken to, accused or caught out: said even when the bot has used its turns. */
  urgent: boolean;
}

const POWER_LABEL: Record<Exclude<Role, "villager" | "mafia">, string> = {
  doctor: "Doctor",
  detective: "Detective",
  bodyguard: "Bodyguard",
  cupid: "Cupid",
  jester: "Jester",
};

function roleWord(role: Role, view: GameView): string {
  if (role === "mafia") return gangName(view.settings);
  if (role === "villager") return "villager";
  return POWER_LABEL[role];
}

/** The tone: from the bot's personality, the kind of message and the public pressure on it. Never from its role. */
export function toneFor(p: BotPersonality, act: SpeechAct, pressure: number): SpeechTone {
  if (p.style === "nervous") return "nervous";
  if (p.style === "jokey" && act !== "accuse" && act !== "call_out" && act !== "counter_claim") return "joking";
  if (act === "defend_self") return pressure >= 2 ? (p.aggression > 0.6 ? "angry" : "nervous") : "calm";
  if (act === "accuse" || act === "call_out" || act === "counter_claim" || act === "claim_result" || act === "vote_call" || act === "deflect") {
    return p.aggression > 0.65 ? "angry" : "confident";
  }
  if (act === "claim_role") return p.style === "laidback" || p.style === "quiet" ? "calm" : "confident";
  if (act === "question") return p.style === "suspicious" ? "unsure" : "calm";
  if (p.style === "chatty" || p.style === "earnest") return "friendly";
  if (p.style === "suspicious") return "unsure";
  return "calm";
}

interface Fields {
  targetId?: string;
  aboutId?: string;
  role?: Role;
  result?: "mafia" | "innocent";
  night?: number;
  reason?: SpeechReason;
  contradiction?: Contradiction["kind"];
  topic?: BotIntent["topic"];
  replyTo?: string;
}

/** Distinct players who accused this bot today (public). */
function pressureOn(mind: Mind): number {
  return new Set(mind.accusedMe.map((a) => a.speakerId)).size;
}

function build(ctx: SpeechContext, key: LineKey, act: SpeechAct, f: Fields = {}): BotIntent {
  const { view, personality, random, mind } = ctx;
  const fill = {
    name: playerName(view, f.targetId),
    about: playerName(view, f.aboutId),
    role: f.role ? roleWord(f.role, view) : undefined,
    gang: gangName(view.settings),
    night: nightWords(f.night, view.round),
  };
  // A bot doesn't repeat itself word for word.
  let says = compose(key, fill, personality.style, view.settings.contentMode, random);
  for (let tries = 0; tries < 4 && mind.said.includes(says); tries++) {
    says = compose(key, fill, personality.style, view.settings.contentMode, random);
  }
  mind.said = [...mind.said.slice(-30), says];
  const intent: BotIntent = { act, tone: toneFor(personality, act, pressureOn(ctx.mind)), says };
  if (f.targetId !== undefined) intent.targetId = f.targetId;
  if (f.aboutId !== undefined) intent.aboutId = f.aboutId;
  if (f.role !== undefined) intent.role = f.role;
  if (f.result !== undefined) intent.result = f.result;
  if (f.night !== undefined) intent.night = f.night;
  if (f.reason !== undefined) intent.reason = f.reason;
  if (f.contradiction !== undefined) intent.contradiction = f.contradiction;
  if (f.topic !== undefined) intent.topic = f.topic;
  if (f.replyTo !== undefined) intent.replyToMessageId = f.replyTo;
  return intent;
}

function chance(ctx: SpeechContext, p: number): boolean {
  return ctx.random() < p;
}

const others = (ctx: SpeechContext) => living(ctx.view).filter((p) => p.id !== ctx.view.you?.id);
const team = (ctx: SpeechContext) => new Set(ctx.view.you?.teammateIds ?? []);

/** In danger of being voted out: several accusers, or (voting) a big share of the votes. */
function inDanger(ctx: SpeechContext): boolean {
  const { mind, view } = ctx;
  const you = view.you;
  if (!you) return false;
  if (pressureOn(mind) >= (ctx.difficulty === "easy" ? 3 : 2)) return true;
  if (view.phase !== "VOTING" || !view.voting) return false;
  const electorate = living(view).filter((p) => p.connected).length;
  const mine = view.voting.live.tally[you.id] ?? 0;
  return mine >= Math.max(2, Math.ceil(electorate * 0.35));
}

// ---------------------------------------------------------------- the Detective (real or pretend)

/** A real Detective: decide (once a day) whether to come out. Sooner when it found the Mafia or is in danger. */
function detectiveReveals(ctx: SpeechContext): boolean {
  const { mind, view, personality: p } = ctx;
  if (mind.story.role === "detective") return true;
  const you = view.you;
  if (!you) return false;
  const danger = inDanger(ctx);
  if (danger) return true;
  if (mind.talk.reveal !== null) return mind.talk.reveal;
  const foundMafia = you.investigations.some((i) => i.isMafia && isAlive(view, i.targetId));
  let decision: boolean;
  if (ctx.difficulty === "easy") decision = foundMafia && chance(ctx, 0.35);
  else {
    let s = foundMafia ? 0.65 : 0;
    if (you.investigations.length >= 2) s += 0.25;
    if (view.round >= 3) s += 0.2;
    s += (p.aggression - 0.5) * 0.3;
    if (ctx.difficulty === "hard" && foundMafia) s += 0.2;
    decision = s + (ctx.random() - 0.5) * 0.3 >= 0.6;
  }
  mind.talk.reveal = decision;
  return decision;
}

/** The real Detective's next result to share (Mafia found first), or a plain claim if there is none yet. */
function detectiveReport(ctx: SpeechContext, replyTo?: string): BotIntent | null {
  const { mind, view } = ctx;
  const you = view.you;
  if (!you) return null;
  const pending = you.investigations
    .filter((i) => !mind.announced.includes(i.targetId))
    .sort((a, b) => Number(b.isMafia && isAlive(view, b.targetId)) - Number(a.isMafia && isAlive(view, a.targetId)) || b.round - a.round);
  const next = pending[0];
  const already = mind.story.role === "detective";
  if (!next) return already ? null : build(ctx, "claim_power", "claim_role", { role: "detective", replyTo });
  mind.announced.push(next.targetId);
  const key: LineKey = already ? (next.isMafia ? "report_mafia" : "report_innocent") : next.isMafia ? "claim_result_mafia" : "claim_result_innocent";
  return build(ctx, key, "claim_result", {
    targetId: next.targetId,
    role: "detective",
    result: next.isMafia ? "mafia" : "innocent",
    night: next.round,
    replyTo,
  });
}

/** Mafia: whether to pose as the Detective this game (decided once, after the first night). */
function posesAsDetective(ctx: SpeechContext): boolean {
  const { mind, view, personality: p } = ctx;
  if (mind.fakeDetective !== null) return mind.fakeDetective;
  if (view.round < 1 || view.you?.role !== "mafia") return false;
  let odds = 0;
  if (ctx.difficulty === "normal" && p.deception >= 0.65) odds = 0.6;
  if (ctx.difficulty === "hard" && p.deception >= 0.4) odds = 0.75;
  // Someone else already claims it: only a counter-claim against a "Detective" who is onto the team.
  const rivals = claimers(mind, "detective").filter((id) => id !== view.you?.id);
  if (rivals.length > 0) odds = rivals.some((id) => (mind.threat[id] ?? 0) >= 30) && ctx.difficulty !== "easy" ? odds * 0.8 : 0;
  mind.fakeDetective = ctx.random() < odds;
  return mind.fakeDetective;
}

/**
 * A made-up Detective result, kept consistent with what this bot already
 * claimed: never a teammate, never someone it already "checked". Hard bots
 * frame only when a revealed role can't expose them (or the game is nearly
 * decided); otherwise they "clear" a real innocent, which can't be disproved.
 */
function fakeReport(ctx: SpeechContext, replyTo?: string): BotIntent | null {
  const { mind, view } = ctx;
  const you = view.you;
  if (!you) return null;
  const mates = team(ctx);
  const pool = others(ctx).filter((p) => !mates.has(p.id) && !mind.announced.includes(p.id) && !mind.story.results.some((r) => r.targetId === p.id));
  if (pool.length === 0) return null;
  const livingMafia = 1 + you.teammateIds.filter((id) => isAlive(view, id)).length;
  const town = living(view).length - livingMafia;
  const endgame = town <= livingMafia + 2;
  // Someone claiming Detective who is onto the team: call them Mafia (a counter-claim).
  const rival = claimers(mind, "detective").find((id) => id !== you.id && isAlive(view, id) && (mind.threat[id] ?? 0) >= 30);
  let target: string | undefined;
  let result: "mafia" | "innocent";
  if (rival && pool.some((p) => p.id === rival)) {
    target = rival;
    result = "mafia";
  } else if (ctx.difficulty === "hard" && view.settings.revealRoleOnDeath && !endgame) {
    target = pool.slice().sort((a, b) => heat(mind, view, a.id) - heat(mind, view, b.id))[0]?.id;
    result = "innocent";
  } else {
    target = pool.slice().sort((a, b) => heat(mind, view, b.id) + score(mind, view, b.id) - (heat(mind, view, a.id) + score(mind, view, a.id)))[0]?.id;
    result = "mafia";
  }
  if (!target) return null;
  mind.announced.push(target);
  const already = mind.story.role === "detective";
  const key: LineKey = already ? (result === "mafia" ? "report_mafia" : "report_innocent") : result === "mafia" ? "claim_result_mafia" : "claim_result_innocent";
  return build(ctx, key, "claim_result", { targetId: target, role: "detective", result, night: view.round, replyTo });
}

/** Repeats what the bot already claimed (consistency), or reports the next result if it claims Detective. */
function repeatStory(ctx: SpeechContext, replyTo?: string): BotIntent | null {
  const { mind, view } = ctx;
  const role = mind.story.role;
  if (!role) return null;
  if (role === "detective") {
    const next = view.you?.role === "detective" ? detectiveReport(ctx, replyTo) : fakeReport(ctx, replyTo);
    return next ?? build(ctx, "claim_power", "claim_role", { role: "detective", replyTo });
  }
  if (role === "villager") return build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo });
  return build(ctx, "claim_power", "claim_role", { role, replyTo });
}

// ---------------------------------------------------------------- answers

function reasonFor(ctx: SpeechContext, targetId: string): { reason: SpeechReason; aboutId?: string } {
  const { mind, view } = ctx;
  // A vote against someone shown to be innocent.
  for (const [id, role] of Object.entries(mind.revealed)) {
    if (role !== "mafia" && votedFor(mind, targetId, id) === true) return { reason: "votes", aboutId: id };
  }
  if (mind.contradictions.some((c) => c.liarId === targetId)) return { reason: "claim" };
  const defendedMafia = mind.statements.find((s) => s.speakerId === targetId && s.kind === "defend" && mind.revealed[s.targetId] === "mafia");
  if (defendedMafia) return { reason: "defended", aboutId: defendedMafia.targetId };
  const spoke = mind.statements.some((s) => s.speakerId === targetId && s.day === mind.day);
  if (view.round >= 2 && !spoke && ctx.random() < 0.5) return { reason: "quiet" };
  return { reason: "gut" };
}

const ACCUSE_KEY: Record<SpeechReason, LineKey> = {
  votes: "accuse_votes",
  claim: "accuse_claim",
  quiet: "accuse_quiet",
  defended: "accuse_defended",
  gut: "accuse_gut",
  pressure: "accuse_pressure",
};

function accuse(ctx: SpeechContext, targetId: string, replyTo?: string): BotIntent {
  const { reason, aboutId } = reasonFor(ctx, targetId);
  return build(ctx, ACCUSE_KEY[reason], "accuse", { targetId, aboutId, reason, replyTo });
}

/** Asked its role: the strategy decides the answer (the AI never knows the truth). */
function roleAnswer(ctx: SpeechContext, replyTo: string): BotIntent {
  const { mind, view, personality: p } = ctx;
  const role = view.you?.role;
  const story = repeatStory(ctx, replyTo);
  if (story) return story;
  const hide = () =>
    p.deception >= 0.45 && ctx.difficulty !== "easy"
      ? build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo })
      : build(ctx, "dodge", "dodge", { replyTo });
  switch (role) {
    case "villager":
      return build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo });
    case "doctor":
    case "bodyguard":
    case "cupid":
      return inDanger(ctx) ? build(ctx, "claim_power", "claim_role", { role, replyTo }) : hide();
    case "detective":
      if (detectiveReveals(ctx)) return detectiveReport(ctx, replyTo) ?? build(ctx, "claim_power", "claim_role", { role: "detective", replyTo });
      return hide();
    case "mafia":
      if (posesAsDetective(ctx)) return fakeReport(ctx, replyTo) ?? build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo });
      return chance(ctx, 0.9) || mind.story.claims.length > 0
        ? build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo })
        : build(ctx, "dodge", "dodge", { replyTo });
    case "jester":
      return chance(ctx, 0.5) ? build(ctx, "jester", "jester", { replyTo }) : build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo });
    default:
      return build(ctx, "dodge", "dodge", { replyTo });
  }
}

function answer(ctx: SpeechContext, q: Mind["questions"][number]): BotIntent {
  const { mind, view } = ctx;
  const replyTo = q.messageId;
  switch (q.about) {
    case "role":
      return roleAnswer(ctx, replyTo);
    case "suspect": {
      // "Who's the Mafia?": its honest top suspect (a Mafia bot: a scapegoat). Never a secret.
      const suspect = topSuspect(mind, view, ctx.random, 2);
      if (suspect && (score(mind, view, suspect) >= 3 || view.you?.role === "mafia")) return accuse(ctx, suspect, replyTo);
      return build(ctx, "answer_unsure", "chatter", { replyTo });
    }
    case "vote": {
      const ballot = view.voting?.myBallot;
      if (ballot && ballot !== SKIP) return build(ctx, "vote_call_vote", "vote_call", { targetId: ballot, replyTo });
      const suspect = topSuspect(mind, view, ctx.random, 2);
      if (suspect && score(mind, view, suspect) >= 5) return build(ctx, "vote_call_day", "vote_call", { targetId: suspect, replyTo });
      return build(ctx, "answer_unsure", "chatter", { replyTo });
    }
    default: {
      if (mind.accusedMe.some((a) => a.speakerId === q.speakerId)) return build(ctx, "defend_self_to", "defend_self", { targetId: q.speakerId, replyTo });
      const suspect = topSuspect(mind, view, ctx.random, 2);
      if (suspect && score(mind, view, suspect) >= 10) return accuse(ctx, suspect, replyTo);
      return build(ctx, "answer_unsure", "chatter", { replyTo });
    }
  }
}

// ---------------------------------------------------------------- under pressure

/** A Mafia bot that lies badly, pushed hard, may slip up in a way others can catch. Never on Hard. */
function slips(ctx: SpeechContext): boolean {
  const { mind, view, personality: p } = ctx;
  if (view.you?.role !== "mafia" || ctx.difficulty === "hard" || p.deception >= 0.4 || mind.talk.slipped) return false;
  return pressureOn(mind) >= 2 && chance(ctx, 0.65 - p.deception);
}

function slip(ctx: SpeechContext, replyTo: string): BotIntent {
  const { mind, view } = ctx;
  mind.talk.slipped = true;
  // Claim a role that was already revealed, or that someone else claims: easy to catch.
  const revealed = (Object.values(mind.revealed) as Role[]).find((r) => r === "doctor" || r === "detective" || r === "bodyguard");
  if (revealed) return build(ctx, "claim_power", "claim_role", { role: revealed, replyTo });
  if (claimers(mind, "doctor").length > 0 || mind.story.role === "villager") return build(ctx, "claim_power", "claim_role", { role: "doctor", replyTo });
  // Or stand up for a teammate far too hard.
  const mate = view.you?.teammateIds.find((id) => isAlive(view, id));
  if (mate) return build(ctx, "defend_other_strong", "defend_other", { targetId: mate, replyTo });
  return build(ctx, "claim_power", "claim_role", { role: "doctor", replyTo });
}

function respondToAccusation(ctx: SpeechContext): BotIntent | null {
  const { mind, view, personality: p } = ctx;
  const you = view.you;
  if (!you) return null;
  const fresh = mind.accusedMe.filter((a) => a.at > mind.talk.lastDefenceAt);
  const latest = fresh.at(-1);
  if (!latest) return null;
  mind.talk.lastDefenceAt = ctx.now;
  const accuser = latest.speakerId;
  const replyTo = latest.messageId;
  const role = you.role;
  const danger = inDanger(ctx);
  const mates = team(ctx);

  if (role === "jester") return build(ctx, "jester", "jester", { replyTo });
  if ((role === "doctor" || role === "bodyguard" || role === "cupid") && danger && mind.story.role !== role) {
    return build(ctx, "claim_power", "claim_role", { role, replyTo });
  }
  if (role === "detective" && (danger || detectiveReveals(ctx))) {
    const report = detectiveReport(ctx, replyTo);
    if (report) return report;
  }
  if (role === "mafia") {
    if (slips(ctx)) return slip(ctx, replyTo);
    if (mind.story.role === "detective") return repeatStory(ctx, replyTo) ?? build(ctx, "defend_self_to", "defend_self", { targetId: accuser, replyTo });
    // Deflect onto someone the town already doubts (never a teammate).
    const scapegoat = others(ctx)
      .filter((x) => !mates.has(x.id) && x.id !== accuser)
      .sort((a, b) => heat(mind, view, b.id) + score(mind, view, b.id) - (heat(mind, view, a.id) + score(mind, view, a.id)))[0];
    const roll = ctx.random();
    if (scapegoat && roll < 0.45) return build(ctx, "deflect", "deflect", { targetId: scapegoat.id, replyTo });
    if (!mates.has(accuser) && roll < 0.7) return build(ctx, "accuse_back", "accuse", { targetId: accuser, reason: "pressure", replyTo });
    if (!mind.story.role && chance(ctx, 0.5)) return build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo });
    return build(ctx, "defend_self_to", "defend_self", { targetId: accuser, replyTo });
  }
  // Town: it knows it is innocent.
  if (p.aggression > 0.6 && chance(ctx, 0.6)) return build(ctx, "accuse_back", "accuse", { targetId: accuser, reason: "pressure", replyTo });
  if (role === "villager" && pressureOn(mind) >= 2 && !mind.story.role) return build(ctx, "claim_villager", "claim_role", { role: "villager", replyTo });
  return chance(ctx, 0.5)
    ? build(ctx, "defend_self_to", "defend_self", { targetId: accuser, replyTo })
    : build(ctx, "defend_self", "defend_self", { replyTo });
}

/** About to be voted out with a role worth saving: claim it, even unasked. */
function claimToSurvive(ctx: SpeechContext): BotIntent | null {
  const { mind, view } = ctx;
  const role = view.you?.role;
  if (!inDanger(ctx)) return null;
  if ((role === "doctor" || role === "bodyguard" || role === "cupid") && mind.story.role !== role) {
    return build(ctx, "claim_power", "claim_role", { role });
  }
  if (role === "detective" && mind.story.role !== "detective") return detectiveReport(ctx);
  return null;
}

// ---------------------------------------------------------------- calling out lies

function callOut(ctx: SpeechContext, urgentOnly: boolean): BotIntent | null {
  const { mind, view, personality: p } = ctx;
  const you = view.you;
  if (!you) return null;
  const mates = team(ctx);
  for (const c of mind.contradictions) {
    if (mind.calledOut.includes(c.key) || !isAlive(view, c.liarId)) continue;
    const aboutMe = c.aboutId === you.id;
    if (urgentOnly && !aboutMe) continue;
    let intent: BotIntent | null = null;
    if (c.kind === "double_claim" && c.private && c.role) {
      // This bot holds the role. Saying so gives it away: the Detective does; others only when it's worth it.
      const worth = c.role === "detective" || c.role === "cupid" || inDanger(ctx) || p.aggression > 0.55;
      if (!worth) continue;
      intent = build(ctx, "counter_claim", "counter_claim", { targetId: c.liarId, role: c.role });
    } else if (c.kind === "wrong_result" && c.private) {
      if (you.role !== "detective") continue;
      intent = build(ctx, "counter_claim", "counter_claim", { targetId: c.liarId, role: "detective" });
    } else if (mates.has(c.liarId)) {
      // A Mafia bot never exposes a teammate; in a double claim it can point at the other claimer instead.
      if (c.kind !== "double_claim" || !c.aboutId || !c.role || ctx.difficulty === "easy" || p.deception < 0.5 || mates.has(c.aboutId)) continue;
      intent = build(ctx, "call_out_double_claim", "call_out", { targetId: c.aboutId, aboutId: c.liarId, role: c.role, contradiction: "double_claim" });
    } else {
      switch (c.kind) {
        case "double_claim":
          // The other claim is this bot's own: "I'm the real one."
          intent = aboutMe && c.role
            ? build(ctx, "counter_claim", "counter_claim", { targetId: c.liarId, role: c.role })
            : build(ctx, "call_out_double_claim", "call_out", { targetId: c.liarId, aboutId: c.aboutId ?? undefined, role: c.role ?? undefined, contradiction: c.kind });
          break;
        case "revealed_role":
          intent = build(ctx, "call_out_revealed_role", "call_out", { targetId: c.liarId, aboutId: c.aboutId ?? undefined, role: c.role ?? undefined, contradiction: c.kind });
          break;
        case "wrong_result":
          if (aboutMe) intent = build(ctx, "call_out_lie_about_me", "call_out", { targetId: c.liarId, contradiction: c.kind });
          else if (c.aboutId && c.role) {
            intent = build(ctx, c.role === "mafia" ? "call_out_cleared" : "call_out_framed", "call_out", {
              targetId: c.liarId,
              aboutId: c.aboutId,
              role: c.role,
              contradiction: c.kind,
            });
          }
          break;
        case "vote_mismatch":
          if (c.aboutId) {
            const defended = c.key.endsWith(":defended");
            // About this bot itself: said in the first person ("you said you trusted me").
            intent = aboutMe
              ? build(ctx, defended ? "call_out_vote_defended_me" : "call_out_vote_mismatch_me", "call_out", { targetId: c.liarId, contradiction: c.kind })
              : build(ctx, defended ? "call_out_vote_defended" : "call_out_vote_mismatch", "call_out", {
                  targetId: c.liarId,
                  aboutId: c.aboutId,
                  contradiction: c.kind,
                  reason: defended ? "defended" : "votes",
                });
          }
          break;
        case "changed_claim":
          intent = build(ctx, "call_out_changed_claim", "call_out", { targetId: c.liarId, role: c.role ?? undefined, contradiction: c.kind });
          break;
      }
    }
    if (!intent) continue;
    mind.calledOut.push(c.key);
    return intent;
  }
  return null;
}

// ---------------------------------------------------------------- everything else

/** Agree with (or push back on) a recent accusation by someone else. */
function react(ctx: SpeechContext): BotIntent | null {
  const { mind, view, personality: p } = ctx;
  const you = view.you;
  if (!you) return null;
  const mates = team(ctx);
  const top = topSuspect(mind, view, ctx.random, 0);
  const recent = mind.statements
    .filter((s) => s.day === mind.day && s.speakerId !== you.id && s.kind !== "defend" && s.targetId !== you.id && s.targetId !== SKIP)
    .filter((s) => ctx.now - s.at <= 30_000 && isAlive(view, s.targetId) && !mind.reactedTo.includes(`${s.speakerId}:${s.at}`))
    .reverse();
  for (const s of recent) {
    mind.reactedTo.push(`${s.speakerId}:${s.at}`);
    const replyTo = s.messageId;
    if (you.role === "mafia") {
      if (mates.has(s.targetId)) continue;
      if (heat(mind, view, s.targetId) >= 4 && chance(ctx, 0.5)) return build(ctx, "agree", "agree", { targetId: s.targetId, replyTo });
      continue;
    }
    if (s.targetId === top && score(mind, view, s.targetId) >= 6 && chance(ctx, 0.35 + 0.4 * p.gullibility)) {
      return build(ctx, "agree", "agree", { targetId: s.targetId, replyTo });
    }
    if ((mind.trust[s.targetId] ?? 0) >= 8 && chance(ctx, 0.6)) return build(ctx, "defend_other", "defend_other", { targetId: s.targetId, replyTo });
  }
  return null;
}

/** A Mafia bot covers for a teammate under pressure, gently (once a day). */
function coverTeammate(ctx: SpeechContext): BotIntent | null {
  const { mind, view, personality: p } = ctx;
  const you = view.you;
  if (you?.role !== "mafia" || mind.talk.defendedTeam) return null;
  const electorate = living(view).filter((x) => x.connected).length;
  const tally = view.voting?.live.tally ?? {};
  const mate = you.teammateIds.find((id) => isAlive(view, id) && heat(mind, view, id) >= 4 && (tally[id] ?? 0) * 2 < electorate);
  if (!mate || !chance(ctx, 0.35 + 0.3 * p.deception)) return null;
  mind.talk.defendedTeam = true;
  const accusation = [...mind.statements].reverse().find((s) => s.day === mind.day && s.targetId === mate && s.kind !== "defend");
  if (chance(ctx, 0.5)) return build(ctx, "defend_other", "defend_other", { targetId: mate, replyTo: accusation?.messageId });
  const mates = team(ctx);
  const scapegoat = others(ctx)
    .filter((x) => !mates.has(x.id))
    .sort((a, b) => heat(mind, view, b.id) + score(mind, view, b.id) - (heat(mind, view, a.id) + score(mind, view, a.id)))[0];
  return scapegoat ? build(ctx, "deflect", "deflect", { targetId: scapegoat.id, replyTo: accusation?.messageId }) : null;
}

function opening(ctx: SpeechContext): BotIntent | null {
  const { mind, view, personality: p } = ctx;
  const you = view.you;
  if (!you || mind.talk.opened) return null;
  mind.talk.opened = true;
  const mates = team(ctx);
  const victims = view.nightReport && view.nightReport.round === view.round ? view.nightReport.deaths.map((d) => d.playerId) : [];
  if (victims[0] && chance(ctx, 0.2)) return build(ctx, "react_death", "react_death", { targetId: victims[0] });
  if (you.role === "jester" && chance(ctx, 0.5)) return build(ctx, "jester", "jester");
  const top = topSuspect(mind, view, ctx.random, 2);
  if (top && score(mind, view, top) >= 8 && chance(ctx, 0.4 + 0.5 * p.aggression)) return accuse(ctx, top);
  // A pressure accusation, to see how they react.
  const pool = others(ctx).filter((x) => !mates.has(x.id));
  if (chance(ctx, p.aggression * 0.8)) {
    const target = pool[Math.floor(ctx.random() * pool.length)];
    if (target) return build(ctx, "accuse_pressure", "accuse", { targetId: target.id, reason: "pressure" });
  }
  if (chance(ctx, 0.4)) {
    const target = pool[Math.floor(ctx.random() * pool.length)];
    if (target) return build(ctx, "question_suspect", "question", { targetId: target.id, topic: "suspect" });
  }
  return build(ctx, "chatter", "chatter");
}

function alliance(ctx: SpeechContext): BotIntent | null {
  const { mind, view, personality: p } = ctx;
  const you = view.you;
  if (!you || mind.talk.allied || !chance(ctx, 0.12 + 0.25 * p.talkativeness)) return null;
  mind.talk.allied = true;
  const mates = team(ctx);
  const pool = others(ctx).filter((x) => !mates.has(x.id));
  const friend = pool
    .map((x) => ({ id: x.id, v: (mind.trust[x.id] ?? 0) - score(mind, view, x.id) - (you.role === "mafia" ? heat(mind, view, x.id) : 0) }))
    .sort((a, b) => b.v - a.v)[0];
  if (!friend || (you.role !== "mafia" && friend.v < 0)) return null;
  return build(ctx, "trust", "trust", { targetId: friend.id });
}

function filler(ctx: SpeechContext): BotIntent | null {
  const { mind, view, personality: p } = ctx;
  const you = view.you;
  if (!you) return null;
  if (you.role === "jester" && chance(ctx, 0.4)) return build(ctx, "jester", "jester");
  const top = topSuspect(mind, view, ctx.random, 2);
  if (view.phase === "VOTING") {
    const ballot = view.voting?.myBallot;
    if (ballot && ballot !== SKIP && mind.talk.voteSaid !== ballot && chance(ctx, 0.35 + 0.5 * p.talkativeness)) {
      mind.talk.voteSaid = ballot;
      return build(ctx, "vote_call_vote", "vote_call", { targetId: ballot });
    }
    return chance(ctx, 0.3) ? build(ctx, "chatter_vote", "chatter") : null;
  }
  if (top && score(mind, view, top) >= 12 && chance(ctx, 0.3 + 0.4 * p.aggression)) {
    return chance(ctx, 0.5) ? build(ctx, "vote_call_day", "vote_call", { targetId: top }) : accuse(ctx, top);
  }
  if (top && score(mind, view, top) >= 6 && chance(ctx, p.aggression)) return accuse(ctx, top);
  if (chance(ctx, 0.3)) {
    const mates = team(ctx);
    const quiet = others(ctx).filter((x) => !mates.has(x.id) && !mind.statements.some((s) => s.speakerId === x.id && s.day === mind.day));
    const target = quiet[Math.floor(ctx.random() * quiet.length)];
    if (target) return build(ctx, "question_quiet", "question", { targetId: target.id, topic: "general" });
  }
  return p.talkativeness >= 0.5 && chance(ctx, 0.5) ? build(ctx, "chatter", "chatter") : null;
}

/**
 * The next thing this bot wants to say, if anything: answers and defences
 * first (urgent), then call-outs, claims, reactions, an opening line, an
 * alliance, its vote, or some ordinary talk.
 */
export function planSpeech(ctx: SpeechContext, canSpeakFreely: boolean): PlannedSpeech | null {
  const { mind, view } = ctx;
  const you = view.you;
  const self = me(view);
  if (!you || !self || !self.alive || !you.role) return null;
  if (view.phase !== "DAY_DISCUSSION" && view.phase !== "VOTING") return null;

  // Spoken to, accused, or about to go: answer first.
  const question = mind.questions.shift();
  if (question) return { intent: answer(ctx, question), urgent: true };
  const defence = respondToAccusation(ctx);
  if (defence) return { intent: defence, urgent: true };
  const survive = claimToSurvive(ctx);
  if (survive) return { intent: survive, urgent: true };
  const lieAboutMe = callOut(ctx, true);
  if (lieAboutMe) return { intent: lieAboutMe, urgent: true };
  if (!canSpeakFreely) return null;

  const planned =
    callOut(ctx, false) ??
    (you.role === "detective" && detectiveReveals(ctx) && !mind.talk.reported ? markReported(ctx, detectiveReport(ctx)) : null) ??
    (you.role === "mafia" && mind.story.role !== "villager" && posesAsDetective(ctx) && !mind.talk.reported ? markReported(ctx, fakeReport(ctx)) : null) ??
    coverTeammate(ctx) ??
    react(ctx) ??
    opening(ctx) ??
    alliance(ctx) ??
    filler(ctx);
  return planned ? { intent: planned, urgent: false } : null;
}

function markReported(ctx: SpeechContext, intent: BotIntent | null): BotIntent | null {
  if (intent) ctx.mind.talk.reported = true;
  return intent;
}

/** The night-time Mafia chat line (a ready-made line: the Mafia chat never goes to the AI). */
export function mafiaPlanLine(view: GameView, personality: BotPersonality, targetId: string, agree: boolean, random: Random): BotIntent {
  const says = compose(agree ? "mafia_agree" : "mafia_plan", { name: playerName(view, targetId), gang: gangName(view.settings) }, personality.style, view.settings.contentMode, random);
  return { act: "vote_call", targetId, tone: "calm", says };
}

/** "You've convinced me": the line after changing a vote. */
export function voteChangeLine(ctx: SpeechContext, targetId: string): BotIntent {
  ctx.mind.talk.voteSaid = targetId;
  return build(ctx, "vote_change", "vote_call", { targetId });
}
