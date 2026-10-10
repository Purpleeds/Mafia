import type { ContentMode } from "@mafia/shared";

/**
 * What bots say, from templates. {name} is another player, {gang} what the
 * Mafia are called in this room ("Mafia" or "Sneaky Gang"). Safe Mode's lines
 * have no violent words (a test checks them against the Safe Mode word list),
 * Normal Mode's are a bit noir. No emoji anywhere.
 */
export type LineKind =
  | "accuse"
  | "question"
  | "defend"
  | "trust"
  | "claim"
  | "agreeVote"
  | "chatter"
  | "jester"
  | "mafiaPlan"
  | "mafiaAgree";

export const BOT_LINES: Record<ContentMode, Record<LineKind, readonly string[]>> = {
  safe: {
    accuse: [
      "I don't trust {name}.",
      "{name} has been very quiet. Hmm.",
      "I have a funny feeling about {name}.",
      "My guess is {name}.",
      "Has anyone else noticed {name} acting odd?",
    ],
    question: [
      "Why did nobody vote for {name}?",
      "{name}, what were you doing last night?",
      "Who wants to explain why {name} keeps changing their mind?",
    ],
    defend: ["I'm just a villager, I promise!", "It's not me, honest!", "I'm on the town's side, really."],
    trust: ["I think {name} is fine.", "{name} seems honest to me.", "Let's leave {name} alone for now."],
    claim: ["I checked {name}: they're in the {gang}!", "I'm the Detective. {name} is in the {gang}!"],
    agreeVote: ["I'm voting for {name}.", "Same here, {name}.", "Okay, {name} it is."],
    chatter: ["Hmm, this is tricky.", "Let's think before we vote.", "Anyone have a hunch?", "Good morning, everyone!"],
    jester: ["Maybe it's me. Maybe it isn't!", "You'll never guess who I am.", "I bet you can't figure me out."],
    mafiaPlan: ["Let's pick {name} tonight.", "How about {name}?", "I say {name} this time."],
    mafiaAgree: ["Okay, {name} it is.", "Agreed: {name}."],
  },
  normal: {
    accuse: [
      "I don't trust {name}.",
      "{name}'s story doesn't add up.",
      "Something about {name} smells off.",
      "Keep your eyes on {name}.",
      "{name} has been far too quiet.",
    ],
    question: [
      "Why did nobody vote for {name}?",
      "{name}, where were you last night?",
      "Funny how {name} always votes last.",
    ],
    defend: ["I'm just a villager, I swear.", "You've got the wrong person.", "I'm clean. Look elsewhere."],
    trust: ["{name} is alright by me.", "I'd stake my reputation on {name}.", "Leave {name} out of this."],
    claim: ["I checked {name}. They're {gang}.", "I'm the Detective, and {name} is {gang}."],
    agreeVote: ["My vote is on {name}.", "{name}. Let's finish this.", "I'm with you: {name}."],
    chatter: ["Long night.", "Somebody here is lying.", "Let's not rush this.", "Anyone got a lead?"],
    jester: ["Maybe it was me. Maybe not.", "Go on, vote for me. I dare you.", "You'll never crack me."],
    mafiaPlan: ["Let's go for {name}.", "I say {name} tonight.", "{name} is getting too close. Them."],
    mafiaAgree: ["Fine. {name}.", "{name} it is."],
  },
};

export function fillLine(line: string, values: { name?: string; gang: string }): string {
  return line.replaceAll("{name}", values.name ?? "someone").replaceAll("{gang}", values.gang);
}
