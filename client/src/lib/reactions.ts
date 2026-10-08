import type { ChatReaction } from "@mafia/shared";
import type { IconName } from "../art/icons";

/** The quick reactions: how they look and how a screen reader says them. */
export const REACTIONS: { id: ChatReaction; label: string; icon: IconName }[] = [
  { id: "thinking", label: "Thinking", icon: "thinking" },
  { id: "suspicious", label: "Suspicious", icon: "suspicious" },
  { id: "laughing", label: "Laughing", icon: "laughing" },
  { id: "shocked", label: "Shocked", icon: "shocked" },
];

export const reactionInfo = (id: ChatReaction) => REACTIONS.find((r) => r.id === id) ?? REACTIONS[0]!;
