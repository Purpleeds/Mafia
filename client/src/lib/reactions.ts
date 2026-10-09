import { CHAT_REACTIONS, CHAT_REACTION_TEXT, type ChatReaction } from "@mafia/shared";

/** The quick reactions: short words on small buttons, no pictures. */
export const REACTIONS: { id: ChatReaction; label: string }[] = CHAT_REACTIONS.map((id) => ({ id, label: CHAT_REACTION_TEXT[id] }));

/** The words for a reaction. A reaction from an older version of the game reads as a plain "Reacted". */
export function reactionLabel(id: string): string {
  return (CHAT_REACTIONS as readonly string[]).includes(id) ? CHAT_REACTION_TEXT[id as ChatReaction] : "Reacted";
}
