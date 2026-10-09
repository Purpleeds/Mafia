/**
 * Emoji removal for text the game itself shows (the AI narrator's lines).
 * Pictographs, skin-tone modifiers, flags, keycaps and the joiners between
 * them go, and so do the common text faces (":)", ";-)", "<3", "xD"), so a
 * narration reads as plain words whatever the AI sent back.
 */
const PICTOGRAPHS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍⃣︎️]/gu;
const TEXT_FACES = /[:;]-?[)(DPpOo](?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:<3|[xX]D|\^_?\^)(?![\p{L}\p{N}])/gu;

export function stripEmoji(text: string): string {
  return text
    .replace(PICTOGRAPHS, "")
    .replace(TEXT_FACES, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .trim();
}

/** True if the text still has an emoji or a text face in it. */
export function hasEmoji(text: string): boolean {
  PICTOGRAPHS.lastIndex = 0;
  TEXT_FACES.lastIndex = 0;
  return PICTOGRAPHS.test(text) || TEXT_FACES.test(text);
}
