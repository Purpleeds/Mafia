import type { ContentMode } from "@mafia/shared";
import type { SpeakingStyle } from "./personality.js";

/**
 * What bots say without the AI (and whenever the AI's version doesn't pass the
 * server's checks): ready-made lines for every kind of message, a separate set
 * for each mode, flavoured by each bot's speaking style. {name} is the player
 * the message is about, {about} a second player, {role} a role, {gang} what the
 * Mafia are called in this room, {night} "last night" or "on night 2".
 *
 * Safe Mode's lines have no violent words (a test checks every combination
 * against the Safe Mode word list); Normal Mode's are a bit noir. No emoji.
 */
export type LineKey =
  | "claim_villager"
  | "claim_power"
  | "claim_result_mafia"
  | "claim_result_innocent"
  | "report_mafia"
  | "report_innocent"
  | "counter_claim"
  | "accuse_gut"
  | "accuse_votes"
  | "accuse_quiet"
  | "accuse_claim"
  | "accuse_defended"
  | "accuse_pressure"
  | "accuse_back"
  | "defend_self"
  | "defend_self_to"
  | "defend_other"
  | "defend_other_strong"
  | "question_suspect"
  | "question_role"
  | "question_vote"
  | "question_quiet"
  | "dodge"
  | "vote_call_day"
  | "vote_call_vote"
  | "vote_change"
  | "agree"
  | "call_out_double_claim"
  | "call_out_revealed_role"
  | "call_out_framed"
  | "call_out_cleared"
  | "call_out_lie_about_me"
  | "call_out_vote_mismatch"
  | "call_out_vote_defended"
  | "call_out_vote_mismatch_me"
  | "call_out_vote_defended_me"
  | "call_out_changed_claim"
  | "trust"
  | "deflect"
  | "react_death"
  | "chatter"
  | "chatter_vote"
  | "answer_unsure"
  | "jester"
  | "mafia_plan"
  | "mafia_agree";

type Table = Record<LineKey, readonly string[]>;

const SAFE: Table = {
  claim_villager: ["I'm just a villager, honest!", "I'm a plain villager.", "Villager here. Nothing special about me.", "I'm on the town's side: just a villager."],
  claim_power: ["I'm the {role}.", "Okay, I'll say it: I'm the {role}.", "Time to come clean. I'm the {role}.", "You should all know I'm the {role}."],
  claim_result_mafia: [
    "I'm the Detective. I checked {name} {night}: they're in the {gang}!",
    "I'm the Detective, and {name} came back {gang}!",
    "Listen, I'm the Detective. {name} is {gang}. I checked them {night}.",
  ],
  claim_result_innocent: [
    "I'm the Detective. I checked {name} {night}, and they're innocent.",
    "I'm the Detective. {name} is clean, I checked them {night}.",
  ],
  report_mafia: ["Detective update: I checked {name} {night}. They're {gang}!", "New result: {name} is {gang}. I checked them {night}.", "I checked {name} {night}: {gang}!"],
  report_innocent: ["Detective update: {name} is innocent. I checked them {night}.", "New result: {name} came back clean.", "I checked {name} {night}: innocent."],
  counter_claim: ["{name} is not telling the truth. I'm the real {role}!", "No way. I'm the {role}, so {name} is fibbing!", "{name} can't be the {role}, because I am!"],
  accuse_gut: ["I don't trust {name}.", "Something about {name} feels off.", "My guess is {name}.", "I have a funny feeling about {name}.", "Has anyone else noticed {name} acting odd?"],
  accuse_votes: [
    "{name} voted for {about}, and {about} was innocent. That worries me.",
    "Look at the votes: {name} went after {about}. I don't like it.",
    "{name} voted {about} out. Why was that?",
  ],
  accuse_quiet: ["{name} has been very quiet. Hmm.", "{name}, you're awfully quiet today.", "Why is {name} so quiet?"],
  accuse_claim: ["{name}'s story doesn't add up.", "I don't believe {name}'s claim.", "Something is wrong with what {name} said."],
  accuse_defended: ["{name} keeps sticking up for {about}. Why?", "Why is {name} so keen to protect {about}?"],
  accuse_pressure: ["{name}, you're acting a bit odd. Want to explain?", "I'm keeping an eye on {name} today.", "{name}, tell us why we should trust you."],
  accuse_back: ["Why are you after me, {name}? That's suspicious.", "{name} is pointing at me to hide something.", "Funny how {name} jumps on me so fast."],
  defend_self: ["It's not me! I'm on the town's side.", "Why me? I haven't done anything!", "I'm innocent, look somewhere else.", "Please, it isn't me."],
  defend_self_to: ["{name}, you've got the wrong person.", "{name}, it really isn't me.", "Sorry {name}, but you're looking at the wrong player."],
  defend_other: ["I don't think it's {name}.", "{name} seems honest to me.", "Let's leave {name} alone for now.", "I'm not sure about {name}. Let's look elsewhere."],
  defend_other_strong: ["{name} is definitely innocent, I'd bet on it!", "Trust me, it's not {name}. I just know it."],
  question_suspect: ["{name}, who do you think it is?", "{name}, who's your top suspect?", "What do you think, {name}?"],
  question_role: ["{name}, what's your role?", "{name}, are you going to tell us what you are?"],
  question_vote: ["{name}, who are you voting for?", "{name}, why did you vote that way?"],
  question_quiet: ["{name}, why so quiet?", "{name}, you haven't said much. Thoughts?"],
  dodge: ["I'd rather not say yet.", "Nice try. I'm keeping that to myself for now.", "Does it matter? Look at the votes.", "I'll share when the time is right."],
  vote_call_day: ["Let's vote for {name}.", "I say we vote {name}.", "My vote is going to {name}.", "Everyone, let's go with {name}."],
  vote_call_vote: ["I'm voting for {name}.", "My vote is on {name}.", "Voting {name}.", "{name} gets my vote."],
  vote_change: ["Okay, I changed my mind. Voting {name}.", "You've convinced me. My vote is now on {name}.", "Switching my vote to {name}."],
  agree: ["Agreed, {name} looks suspicious.", "Same here, {name}.", "I was thinking {name} too.", "Yes, {name} worries me as well."],
  call_out_double_claim: ["Wait, {name} and {about} both say they're the {role}. One of them isn't telling the truth!", "Hold on: {name} claims {role}, but so does {about}. Someone is fibbing."],
  call_out_revealed_role: ["Wait, {name} said they were the {role}, but {about} was the {role}!", "{name} claimed {role}, and then {about} turned out to be the {role}. {name} fibbed!"],
  call_out_framed: ["{name} said {about} was {gang}, but {about} was the {role}. {name} fibbed!", "Remember, {name} pointed at {about}, and {about} was innocent. Hmm."],
  call_out_cleared: ["{name} said {about} was innocent, and {about} was {gang} all along!", "{name} vouched for {about}, who was {gang}. Suspicious!"],
  call_out_lie_about_me: ["{name} says I'm {gang}. That's not true!", "I'm not {gang}, so {name} is making things up."],
  call_out_vote_mismatch: ["{name}, you said it was {about}, then voted for someone else?", "{name} pointed at {about} but didn't vote for them. Why?"],
  call_out_vote_defended: ["{name}, you stood up for {about} and then voted for them?", "{name} said {about} was fine, then voted {about}. Odd."],
  call_out_vote_mismatch_me: ["{name}, you pointed at me and then voted for someone else?", "{name} named me, then didn't even vote for me. Why?"],
  call_out_vote_defended_me: ["{name}, you said you trusted me, then voted for me?", "{name} stood up for me and then voted me. Which is it?"],
  call_out_changed_claim: ["{name} changed their story. Now they're the {role}?", "First one thing, now {name} says {role}. Which is it?"],
  trust: ["I trust {name}.", "{name} and I are on the same side, I think.", "{name}, let's stick together.", "I'm with {name} on this one."],
  deflect: ["Instead of me, why not look at {name}?", "Don't look at me, look at {name}.", "Funny you say that. {name} is the one acting strange."],
  react_death: ["Poor {name}. We'll miss them.", "Oh no, not {name}!", "{name} was sent home. Who would do that?"],
  chatter: ["Hmm, this is tricky.", "Let's think before we vote.", "Anyone have a hunch?", "Good morning, everyone!", "Okay, who's hiding something?"],
  chatter_vote: ["Tough choice this time.", "Let's get this right, everyone.", "Choose carefully, town."],
  answer_unsure: ["Not sure yet, honestly.", "I'm still thinking about it.", "No idea yet. Still watching."],
  jester: ["Maybe it's me. Maybe it isn't!", "You'll never guess who I am.", "I bet you can't figure me out.", "Go on, vote for me. I dare you!"],
  mafia_plan: ["Let's pick {name} tonight.", "How about {name}?", "I say {name} this time."],
  mafia_agree: ["Okay, {name} it is.", "Agreed: {name}."],
};

const NORMAL: Table = {
  claim_villager: ["I'm just a villager, I swear.", "Plain villager. Nothing to see here.", "Villager. That's all I am.", "I'm town. Just a villager."],
  claim_power: ["I'm the {role}.", "Fine, cards on the table: I'm the {role}.", "I'm the {role}. Make of that what you will.", "You want the truth? I'm the {role}."],
  claim_result_mafia: [
    "I'm the Detective. I looked into {name} {night}. They're {gang}.",
    "I'm the Detective, and {name} came back {gang}.",
    "Detective here. {name} is {gang}. I checked them {night}.",
  ],
  claim_result_innocent: ["I'm the Detective. {name} is clean, I checked them {night}.", "Detective here. I looked into {name} {night}. Innocent."],
  report_mafia: ["Another result: {name} is {gang}. I checked them {night}.", "Checked {name} {night}. They're {gang}.", "{name}. {gang}. I checked them {night}."],
  report_innocent: ["Checked {name} {night}. They're clean.", "Another result: {name} is innocent.", "{name} came back clean {night}."],
  counter_claim: ["{name} is lying. I'm the real {role}.", "{name} isn't the {role}. I am.", "Two {role}s? No. {name} is a liar."],
  accuse_gut: ["I don't trust {name}.", "Something about {name} smells off.", "Keep your eyes on {name}.", "My money's on {name}.", "{name}'s hiding something."],
  accuse_votes: [
    "{name} voted for {about}, and {about} was innocent. Funny, that.",
    "Check the votes. {name} went after {about}. Why?",
    "{name} put {about} away. I'd like to hear why.",
  ],
  accuse_quiet: ["{name} has been far too quiet.", "Quiet ones worry me. {name}, say something.", "{name} hasn't said a word. Convenient."],
  accuse_claim: ["{name}'s story doesn't add up.", "I don't buy {name}'s claim.", "Something's wrong with {name}'s story."],
  accuse_defended: ["{name} keeps covering for {about}. Why?", "Why is {name} so protective of {about}?"],
  accuse_pressure: ["{name}, you're acting jumpy. Explain yourself.", "I've got my eye on {name}.", "{name}, convince me you're clean."],
  accuse_back: ["Why the rush to blame me, {name}? Suspicious.", "{name} points at me to hide their own tracks.", "Nice try, {name}. Deflecting already?"],
  defend_self: ["You've got the wrong person.", "I'm clean. Look elsewhere.", "It wasn't me. I swear.", "Not me. Keep looking."],
  defend_self_to: ["{name}, you've got the wrong person.", "Back off, {name}. It isn't me.", "{name}, you're barking up the wrong tree."],
  defend_other: ["I don't think it's {name}.", "{name} is alright by me.", "Leave {name} out of this.", "I'd look past {name} for now."],
  defend_other_strong: ["{name} is clean. I'd stake my life on it.", "Trust me, it's not {name}. I just know."],
  question_suspect: ["{name}, who do you like for it?", "{name}, who's your top suspect?", "Your read, {name}?"],
  question_role: ["{name}, what's your role?", "{name}, care to tell us what you are?"],
  question_vote: ["{name}, who's getting your vote?", "{name}, why'd you vote that way?"],
  question_quiet: ["{name}, why so quiet?", "{name}, you've barely said a word. Talk."],
  dodge: ["I'd rather not say yet.", "Not telling. Not yet.", "Doesn't matter what I am. Look at the votes.", "I'll talk when it counts."],
  vote_call_day: ["Let's vote {name}.", "I say we vote {name}.", "{name}. Let's finish this.", "My vote goes to {name}."],
  vote_call_vote: ["My vote is on {name}.", "I'm voting {name}.", "{name}. Final answer.", "Voting {name}."],
  vote_change: ["Changed my mind. Voting {name}.", "You've convinced me. {name} it is.", "Switching to {name}."],
  agree: ["Agreed. {name} is off.", "I'm with you: {name}.", "Same thought here. {name}.", "{name} has been bugging me too."],
  call_out_double_claim: ["Hold on. {name} and {about} both claim {role}. One of them is lying.", "Two {role}s? {name} and {about} can't both be telling the truth."],
  call_out_revealed_role: ["Wait. {name} said they were the {role}, but {about} was the {role}.", "{name} claimed {role}. Then {about} turned up as the real one. Liar."],
  call_out_framed: ["{name} swore {about} was {gang}. {about} was the {role}. {name} lied.", "{name} fingered {about}, and {about} was innocent. Remember that."],
  call_out_cleared: ["{name} called {about} clean, and {about} was {gang}.", "{name} vouched for {about}. {about} was {gang}. Think about that."],
  call_out_lie_about_me: ["{name} says I'm {gang}. That's a lie.", "I'm not {gang}. {name} is lying through their teeth."],
  call_out_vote_mismatch: ["{name}, you named {about}, then voted someone else. Explain.", "{name} talked about {about} and voted elsewhere. Why?"],
  call_out_vote_defended: ["{name}, you defended {about} and then voted them out?", "{name} said {about} was clean, then voted {about}. Which is it?"],
  call_out_vote_mismatch_me: ["{name}, you named me and then voted elsewhere?", "{name} pointed at me, then voted someone else. Make up your mind."],
  call_out_vote_defended_me: ["{name}, you vouched for me and then voted me?", "{name} called me clean, then voted me. Which is it?"],
  call_out_changed_claim: ["{name} changed their story. Now it's {role}?", "First it was one thing, now {name} is the {role}? Pick one."],
  trust: ["I trust {name}.", "{name} and I are on the same side.", "{name}, you and me. Let's stick together.", "I'd vouch for {name}."],
  deflect: ["Instead of me, look at {name}.", "Don't look at me. Look at {name}.", "Funny you say that. {name}'s the one acting strange."],
  react_death: ["Rest easy, {name}.", "{name} didn't deserve that.", "So they got {name}. Who's next?"],
  chatter: ["Long night.", "Somebody here is lying.", "Let's not rush this.", "Anyone got a lead?", "This town keeps its secrets."],
  chatter_vote: ["Choose carefully.", "Let's get this one right.", "No pressure, town."],
  answer_unsure: ["Not sure yet.", "Still thinking.", "Can't say yet. Watching everyone."],
  jester: ["Maybe it was me. Maybe not.", "Go on, vote for me. I dare you.", "You'll never crack me."],
  mafia_plan: ["Let's go for {name}.", "I say {name} tonight.", "{name} is getting too close. Them."],
  mafia_agree: ["Fine. {name}.", "{name} it is."],
};

/** Quiet bots use these short versions where there is one. */
const SHORT: Record<ContentMode, Partial<Table>> = {
  safe: {
    claim_villager: ["Villager.", "Just a villager."],
    claim_power: ["I'm the {role}."],
    accuse_gut: ["Hmm. {name}.", "Not sure about {name}."],
    defend_self: ["Not me.", "It isn't me."],
    defend_other: ["Not {name}."],
    agree: ["Yes, {name}.", "{name}, agreed."],
    vote_call_vote: ["{name}.", "Voting {name}."],
    vote_call_day: ["Vote {name}."],
    trust: ["I trust {name}."],
    chatter: ["Hmm.", "Thinking."],
    dodge: ["Not saying.", "Later."],
    answer_unsure: ["Not sure."],
  },
  normal: {
    claim_villager: ["Villager.", "Just a villager."],
    claim_power: ["I'm the {role}."],
    accuse_gut: ["{name}. Watch them.", "Not sold on {name}."],
    defend_self: ["Not me.", "Wrong person."],
    defend_other: ["Not {name}."],
    agree: ["{name}. Agreed.", "Yes. {name}."],
    vote_call_vote: ["{name}.", "Voting {name}."],
    vote_call_day: ["Vote {name}."],
    trust: ["I trust {name}."],
    chatter: ["Hmm.", "Watching."],
    dodge: ["Not saying.", "Later."],
    answer_unsure: ["Not sure."],
  },
};

const LINES: Record<ContentMode, Table> = { safe: SAFE, normal: NORMAL };

interface Flavour {
  /** Said before the line. "lead" openers start a sentence of their own; "join" openers run into it. */
  open: Array<{ text: string; join: boolean }>;
  close: string[];
}

const j = (text: string) => ({ text, join: true });
const lead = (text: string) => ({ text, join: false });

const FLAVOUR: Record<SpeakingStyle, Flavour> = {
  nervous: { open: [j("Um, "), j("Sorry, but "), j("Er, "), j("I don't want to cause trouble, but ")], close: [" Sorry.", " I think.", " Maybe?"] },
  blunt: { open: [lead("Look. "), j("Simple: ")], close: [" That's it.", " End of story."] },
  jokey: { open: [j("Okay okay, "), j("Plot twist: "), j("Not gonna lie, ")], close: [" Just saying!", " Ha.", " No offence!"] },
  quiet: { open: [], close: [] },
  dramatic: { open: [lead("Oh my! "), lead("Listen, everyone! "), lead("I knew it! ")], close: [" Mark my words!", " Unbelievable!"] },
  logical: { open: [lead("Let's be logical. "), j("Think about it: "), j("Here's what I see: ")], close: [" The facts speak for themselves.", " That's the logic."] },
  chatty: { open: [lead("Hey everyone! "), j("Okay so, "), j("Right, ")], close: [" What do you all think?", " Just my two cents!"] },
  suspicious: { open: [lead("Hmm. "), lead("I'm watching everyone. ")], close: [" Nobody's off the hook.", " I'm watching you all."] },
  laidback: { open: [j("Eh, "), j("No stress, but ")], close: [" No big deal.", " Whatever happens."] },
  earnest: { open: [j("Honestly, "), j("I really mean this: ")], close: [" I just want the town to win.", " Let's do this right."] },
  grumpy: { open: [lead("Ugh. "), lead("Fine. ")], close: [" Can we hurry up?", " Obviously."] },
  noir: { open: [lead("Listen here. "), j("Word on the street: "), lead("The night was long. ")], close: [" Mark my words.", " That's how I see it."] },
};

export interface LineFill {
  name?: string;
  about?: string;
  role?: string;
  gang: string;
  night?: string;
}

export function fillLine(line: string, values: LineFill): string {
  return line
    .replaceAll("{name}", values.name ?? "someone")
    .replaceAll("{about}", values.about ?? "someone")
    .replaceAll("{role}", values.role ?? "villager")
    .replaceAll("{gang}", values.gang)
    .replaceAll("{night}", values.night ?? "last night");
}

/** "last night" for tonight's check, "on night 2" for an older one. */
export function nightWords(night: number | null | undefined, today: number): string {
  if (!night || night === today) return "last night";
  return `on night ${night}`;
}

/** Every line a key can produce in a mode (for tests). */
export function allLines(mode: ContentMode, key: LineKey): readonly string[] {
  return [...LINES[mode][key], ...(SHORT[mode][key] ?? [])];
}

export const LINE_KEYS = Object.keys(SAFE) as LineKey[];

export function flavourOf(style: SpeakingStyle): Flavour {
  return FLAVOUR[style];
}

/**
 * A ready-made line in this bot's style: a line for the key (a short one for
 * quiet bots), and now and then the style's opener or closer.
 */
export function compose(key: LineKey, fill: LineFill, style: SpeakingStyle, mode: ContentMode, random: () => number): string {
  const short = SHORT[mode][key];
  const pool = style === "quiet" && short && short.length > 0 ? short : LINES[mode][key];
  const base = pool[Math.floor(random() * pool.length)] ?? pool[0] ?? "";
  let text = fillLine(base, fill);
  const flavour = FLAVOUR[style];
  // Night-time Mafia chat stays plain.
  if (key === "mafia_plan" || key === "mafia_agree") return text;
  // Small talk and condolences don't get a style opener ("Let's be logical. Poor Sam." reads oddly).
  const plain = key === "react_death" || key === "chatter" || key === "chatter_vote" || key === "answer_unsure" || key === "jester";
  const opener = !plain && flavour.open.length > 0 && random() < 0.45 ? flavour.open[Math.floor(random() * flavour.open.length)] : undefined;
  if (opener) {
    // "Um, I don't…" and "Um, Sam is…" keep their capital; "Um, something…" doesn't.
    const keepCapital = !opener.join || base.startsWith("{") || /^(?:I\b|Detective\b|Villager\b|Two\b)/.test(base);
    text = opener.text + (keepCapital ? text : text.charAt(0).toLowerCase() + text.slice(1));
  }
  // Claims stand on their own: "I'm the Doctor. Maybe?" would undercut them.
  const claim = /^(?:claim_|report_|counter_claim)/.test(key);
  const closer = !claim && flavour.close.length > 0 && random() < 0.3 ? flavour.close[Math.floor(random() * flavour.close.length)] : undefined;
  if (closer && text.length + closer.length <= 190) text += closer;
  return text;
}
