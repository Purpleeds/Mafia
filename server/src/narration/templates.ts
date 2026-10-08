import type { ContentMode, NarrationFacts } from "@mafia/shared";
import { pickRandom, type Rng } from "../game/rng.js";

/**
 * Ready-made narration, used whenever the AI narrator is off, unavailable,
 * too slow, or writes something the checks refuse. Placeholders:
 *
 *   {name}   the player who left        {other}  their partner (broken hearts)
 *   {names}  everyone who left, "A and B"
 *   {gang}   "the Mafia" / "the Sneaky Gang"    {Gang}  the same, capitalised
 *
 * Safe Mode lines are cartoony and say nothing about death, weapons or blood.
 * Normal Mode lines are crime-drama noir: shots, docks and poisoned dinners,
 * but never gore (PG-13). Every line is checked against its mode's word list in
 * the tests, so a new line can't slip a banned word in.
 */
export type Situation =
  | "night_one"
  | "night_heartbreak"
  | "night_many"
  | "night_saved"
  | "night_quiet"
  | "vote_one"
  | "vote_heartbreak"
  | "vote_many"
  | "vote_skip"
  | "vote_tie"
  | "vote_nobody";

export const SITUATIONS: readonly Situation[] = [
  "night_one",
  "night_heartbreak",
  "night_many",
  "night_saved",
  "night_quiet",
  "vote_one",
  "vote_heartbreak",
  "vote_many",
  "vote_skip",
  "vote_tie",
  "vote_nobody",
];

export const TEMPLATES: Record<ContentMode, Record<Situation, readonly string[]>> = {
  safe: {
    night_one: [
      "{name} was whisked away in the night by {gang}. Who will be next?",
      "While the town slept, {gang} tiptoed by, and {name} was sent home. Sweet dreams!",
      "Poof! {name} vanished in a puff of smoke and went home for a little rest.",
      "A sneaky shadow slipped through the village. By morning, {name} had been sent on a surprise holiday!",
      "{name} was caught by {gang} and whisked off to a faraway beach. Wave goodbye!",
      "Good morning, town! {name} was swept away by a friendly cloud overnight.",
      "The rooster crowed, but {name} wasn't there. {Gang} sent them home before sunrise!",
      "Uh-oh! {name} slept right through a sneaky visit from {gang} and has been sent home.",
      "Boing! {name} bounced right out of the village last night. {Gang} is at it again!",
      "Morning has come, and {name}'s bed is empty! {Gang} whisked them away on a surprise adventure.",
      "{name} was tucked into a hot air balloon by {gang} and floated home. See you next game!",
      "Zip, zoom, whoosh! {name} was spirited away in the night. Keep your eyes open, town!",
      "The moon winked, the owls hooted, and {name} was sent home by {gang}.",
      "{Gang} sneaked into the village and gave {name} a one-way ticket home. Who is next on the list?",
      "Oh no, {name}'s lantern went dark! {Gang} has sent them home for a rest.",
      "Pop! {name} disappeared in a shower of glitter, thanks to {gang}. The town must be careful!",
      "A giggle in the dark, a whoosh in the wind, and {name} was whisked away by {gang}!",
    ],
    night_heartbreak: [
      "{name} was whisked away in the night, and {other}, missing their best friend, went home too.",
      "Two friends, one surprise holiday! {name} was sent home, and {other} followed along.",
      "{name} floated home on a cloud, and {other} couldn't bear to be apart. Off they went together!",
      "Poof! {name} was sent home by {gang}, and {other} waved goodbye and tagged along.",
    ],
    night_many: [
      "Double trouble! {names} were all whisked away in the night. The town is getting quieter.",
      "{names} were sent home overnight. What a sneaky night it was!",
      "Pop and poof! {names} are off on a surprise holiday together.",
      "{Gang} sent {names} home before sunrise. The village feels very empty this morning.",
    ],
    night_saved: [
      "{Gang} sneaked through the village last night, but a helper got there first! Everyone is safe and sound.",
      "What a close call! Someone was in trouble in the night, but the Doctor saved the day.",
      "Hooray! A quick Doctor spoiled {gang}'s plans, and nobody went home.",
      "{Gang} tried a sneaky trick, but the Doctor was one step ahead. Everyone wakes up safe!",
      "A whisper in the night, a flash of green, and the Doctor saved someone just in time!",
      "The sun is up and nobody is missing, thanks to a quick-thinking Doctor!",
      "{Gang} sneaked in, but a caring Doctor was already waiting. Nobody goes home today!",
      "Whew! Someone had a very close call in the night, and the Doctor saved them just in time.",
    ],
    night_quiet: [
      "The sun peeks over the rooftops. Everyone made it through the night safe and sound!",
      "A quiet night in the village! Everybody is here, rubbing sleepy eyes.",
      "Good morning, town! The owls hooted, the crickets sang, and nobody went anywhere.",
      "Nothing but sweet dreams last night. Everyone is still here!",
      "The rooster crows and every single bed is full. What a peaceful night!",
      "Not a single footstep in the dark. The whole town is safe this morning.",
      "Every hat is on its hook and every bed is full. The village slept well!",
      "A calm, cozy night. The stars twinkled, and nobody was missing at breakfast.",
    ],
    vote_one: [
      "The votes are in! The town sends {name} home with a wave and a smile.",
      "The town has spoken, and {name} is off on a surprise holiday!",
      "Ding-dong! The town voted, and {name} has been whisked away to the sunny seaside.",
      "{name} got the most votes and floats home on a fluffy cloud. Bye-bye!",
      "By a show of hands, {name} is sent home. The village waves goodbye!",
      "Poof! The town's choice is clear: {name} is sent home for a nap.",
      "The ballots are counted, and {name} waves farewell. Who will the town pick next?",
      "It's decided! {name} takes the next balloon home. Safe travels!",
      "{name} tips their hat and heads home. The town has made its choice!",
      "Boing! The town's votes bounced {name} right out of the village. See you next game!",
    ],
    vote_heartbreak: [
      "The town sent {name} home, and {other} followed along. Two friends, one adventure!",
      "{name} got the most votes, and {other} couldn't bear to stay behind. Off they go together!",
      "Poof! {name} is sent home by the town, and {other} hops on the balloon too.",
    ],
    vote_many: [
      "The town sends {names} home. What a day in the village!",
      "{names} wave goodbye as the votes are counted. See you next game!",
      "Pop, poof and away! {names} are off on a surprise holiday.",
    ],
    vote_skip: [
      "The town chose to skip today. Nobody goes home, and everyone cheers!",
      "No one is sent home today. The town decided to give everyone a hug instead!",
      "The vote is in: skip! Everyone stays and the village breathes a sigh of relief.",
      "The town said 'not today!' and nobody goes home.",
      "Skip it is! The town gives everyone one more day, and the village cheers.",
      "Nobody is sent home today. The town shares a big bowl of soup instead!",
      "The votes say 'let's wait and see.' Everyone stays in the village.",
      "The town hit the pause button, and everyone stays for now.",
    ],
    vote_tie: [
      "It's a tie! The votes balance like a seesaw, so nobody goes home today.",
      "A perfect tie! Nobody is sent home, and the town scratches its head.",
      "Round and round the votes go, and they landed in a tie. Everyone stays!",
      "The votes are even, so everyone stays. Better luck tomorrow, town!",
      "The votes are perfectly even, like two ducks in a row. Nobody goes home!",
      "A tie! The town shrugs, and everybody stays in the village.",
      "Neither side won, so everyone stays. Tomorrow is a brand new day!",
      "It's a draw! The ballot box gives a little hiccup, and nobody goes home.",
    ],
    vote_nobody: [
      "Nobody cast a vote today. The village was too busy snoozing!",
      "The ballot box stayed empty, so nobody goes home. Maybe tomorrow?",
      "Not a single vote today. Everyone stays put!",
      "The village forgot to vote today. Everyone stays!",
      "No ballots, no problem. Everyone stays in the village tonight.",
    ],
  },

  normal: {
    night_one: [
      "A single shot rang out across the town. By morning, {name} was gone.",
      "The fog rolled in off the harbor, and so did trouble. {name} was found at the docks at first light.",
      "{name} sat down to dinner and never got up. Somebody had slipped something into the wine.",
      "The streetlamp flickered, a door slammed, and {name} was never seen again.",
      "Rain hammered the pavement. Somewhere in the dark, {gang} settled a score, and {name} paid the price.",
      "They found {name}'s hat on the pier this morning. {name} was nowhere to be found.",
      "A black car idled outside, and {name} climbed in. Nobody saw {name} again.",
      "The night was long and cold. By dawn, {name} had been silenced for good.",
      "A telegram arrived at midnight: stay quiet. {name} didn't. Now the bed is empty and the town is shaken.",
      "Two shots echoed through the alley behind the diner. {name} won't be ordering breakfast.",
      "The cigarette burned down to ash in an empty chair. {name} had made some enemies, and the night collected.",
      "Smoke curled from a crooked lamp, and {name} was found in a back alley as the sun rose.",
      "Whatever {name} knew, {gang} didn't want it spoken. The morning paper has one more headline.",
      "The jazz stopped at the stroke of twelve. {name} left the club alone and never made it home.",
      "A cry was cut short in the dark. By morning, {name} was the talk of a very nervous town.",
      "The sun rose red over the rooftops, and {name} was not among the living.",
      "Something stirred in the shadows of the old warehouse. {name} went in at dusk and never came out.",
    ],
    night_heartbreak: [
      "{name} fell in the night, and {other}, unable to bear the loss, followed before dawn.",
      "Two lovers, one cruel night. {name} was taken, and {other} could not live without them.",
      "They say love is a dangerous game. {name} is gone, and {other} died of a broken heart.",
    ],
    night_many: [
      "The town woke to terrible news. {names} did not survive the night.",
      "A long night and a short list of survivors. {names} are gone.",
      "{names} are gone, and the whole town is holding its breath.",
    ],
    night_saved: [
      "A shadow crept through the streets last night, but the Doctor got there first. Nobody died.",
      "{Gang} struck in the dark, yet someone walked away alive. The Doctor was on the job.",
      "Somebody was marked for the night, and the Doctor pulled them back from the brink. Everyone is still breathing.",
      "A close call in the dead of night. The Doctor's steady hands saved a life, and the town knows it.",
      "The trigger was pulled, but fate had a doctor on call. Nobody was lost last night.",
      "Dawn breaks over a nervous town. {Gang} tried, the Doctor answered, and no one was lost.",
      "{Gang} came calling in the dark, but the Doctor answered the door first. Nobody died.",
      "A life hung by a thread in the small hours, and the Doctor tied the knot. The town breathes again.",
    ],
    night_quiet: [
      "Dawn breaks over the city. Everyone survived the night. For now.",
      "The night passed in uneasy silence. Every face is still here, and the town is watching every one of them.",
      "Not a shot fired, not a body found. The town wakes up wondering what the quiet is hiding.",
      "A quiet night in a loud town. Nobody went missing, and nobody feels any safer.",
      "The rain stopped and the lamps went out one by one. Everybody is still here this morning.",
      "The killer rested tonight, or perhaps got cold feet. Everyone sees the sunrise.",
      "The clock struck six and no one was missing. The town doesn't trust the silence.",
      "A night without a scream. The streets are empty, but everyone is accounted for.",
    ],
    vote_one: [
      "The votes are in. The town has condemned {name}.",
      "The town has made its choice, and {name} walks out into the rain with nowhere left to go.",
      "Hands went up around the square. {name} was shown the door, and the door led nowhere good.",
      "The jury of the streets has spoken. {name} is out, and the town only hopes it chose right.",
      "{name} tipped a hat to the crowd and walked into the fog. The town has spoken.",
      "Justice, as the town sees it, was swift. {name} is out of the game.",
      "The ballots were counted under a flickering bulb. {name} drew the short straw.",
      "A hush fell over the square as the votes were read. {name} had run out of time and friends.",
      "The gavel fell. The town chose {name}, and now it must live with the choice.",
      "{name} met the town's verdict with a cold stare. The streets are quieter tonight.",
    ],
    vote_heartbreak: [
      "The town condemned {name}, and {other} could not bear it. Both are gone from the story.",
      "{name} took the town's verdict, and {other}, heartbroken, followed them out into the night.",
      "One vote cast them out, and a broken heart finished the job. {name} and {other} are gone.",
    ],
    vote_many: [
      "The town's verdict takes {names} in one stroke. The square falls silent.",
      "{names} are gone, and the town only hopes it chose right.",
      "A hard day in a hard town. {names} walk out into the fog together.",
    ],
    vote_skip: [
      "The town chose to spare everyone today. Whether that is mercy or a mistake, we'll find out.",
      "No verdict was reached. The town looks away, and the guilty smile.",
      "The town decided to skip. Nobody pays today, and trust remains in short supply.",
      "A vote to wait. The streets hold their breath, and nobody leaves the square.",
      "The town chose not to choose. Somewhere, someone is very relieved.",
      "No name was called. The square empties slowly, and the suspicion stays behind.",
      "A vote to wait it out. The town can afford few mistakes, and it knows it.",
      "Nobody is condemned today. The night will come either way.",
    ],
    vote_tie: [
      "The vote is tied, and the town is split down the middle. Nobody is eliminated.",
      "The votes split evenly. No verdict, no justice, and the night is coming.",
      "A deadlock. The town couldn't agree on anything, not even who to blame.",
      "Half the town said one thing, half said another. Nobody pays today.",
      "The count came out even. The town stands in the rain with nothing decided.",
      "A split decision. The gavel stays where it is, and nobody walks.",
      "Two ways to go, and the town couldn't pick one. Nobody is out today.",
      "The tally is level. The town looks at one another, and nobody blinks.",
    ],
    vote_nobody: [
      "Nobody cast a vote today. The town sat in silence while the clock ticked.",
      "The ballot box stayed empty. Even the shadows seem restless.",
      "Not a single vote. In a town like this, silence says plenty.",
      "The ballot box sat untouched. In this town, even silence is a kind of vote.",
      "Nobody spoke, nobody voted. The sun set on an empty square.",
    ],
  },
};

/** Which pool of lines fits these facts. */
export function situationOf(facts: NarrationFacts): Situation {
  const n = facts.eliminated.length;
  const prefix = facts.kind === "night" ? "night" : "vote";
  if (n === 0) {
    if (facts.kind === "night") return facts.saved ? "night_saved" : "night_quiet";
    switch (facts.voteOutcome) {
      case "skipped":
        return "vote_skip";
      case "tie":
        return "vote_tie";
      default:
        return "vote_nobody";
    }
  }
  if (n === 1) return `${prefix}_one`;
  const [first, second] = facts.eliminated;
  if (n === 2 && first?.how !== "heartbreak" && second?.how === "heartbreak") return `${prefix}_heartbreak`;
  return `${prefix}_many`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function templateVars(facts: NarrationFacts): Record<string, string> {
  const names = facts.eliminated.map((e) => e.name);
  const gang = `the ${facts.gang}`;
  return {
    name: names[0] ?? "",
    other: names[1] ?? "",
    names: joinNames(names),
    gang,
    Gang: `The ${facts.gang}`,
  };
}

export function renderTemplate(line: string, vars: Record<string, string>): string {
  return line.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

export interface TemplatePick {
  /** Identifies the line, e.g. "safe.night_one.3". */
  id: string;
  text: string;
  /** Every line of this pool had been used, so the pool started over. */
  restarted: boolean;
  /** The ids that make up this pool (so the caller can forget them after a restart). */
  poolIds: string[];
}

/**
 * Picks a line for these facts that hasn't been used in this game. When a pool
 * runs out it starts over (never repeating the line used last).
 */
export function pickTemplate(facts: NarrationFacts, used: readonly string[], rng: Rng): TemplatePick {
  const situation = situationOf(facts);
  const lines = TEMPLATES[facts.mode][situation];
  const poolIds = lines.map((_, i) => `${facts.mode}.${situation}.${i}`);
  const usedSet = new Set(used);
  let candidates = poolIds.filter((id) => !usedSet.has(id));
  let restarted = false;
  if (candidates.length === 0) {
    restarted = true;
    const last = [...used].reverse().find((id) => poolIds.includes(id));
    candidates = poolIds.filter((id) => id !== last);
    if (candidates.length === 0) candidates = poolIds;
  }
  const id = pickRandom(candidates, rng);
  const line = lines[poolIds.indexOf(id)] ?? lines[0] ?? "";
  return { id, text: renderTemplate(line, templateVars(facts)), restarted, poolIds };
}
