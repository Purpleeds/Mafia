import { NARRATION_CLIENT_TIMEOUT_MS, type NarratorRequestPayload } from "@mafia/shared";
import { call } from "../net/socket";
import { writeNarration } from "./puter";

/**
 * The server asked this browser (only the host's ever is) to write the
 * narration for some public facts. Ask Puter's AI, then send back what it wrote,
 * or null if it couldn't, so the server can use a ready-made line at once.
 */
export async function handleNarratorRequest(request: NarratorRequestPayload): Promise<void> {
  // Leave a second for the answer to travel back before the server's own deadline.
  const timeoutMs = Math.min(NARRATION_CLIENT_TIMEOUT_MS, Math.max(1000, request.timeoutMs - 1000));
  const text = await writeNarration(request.facts, { timeoutMs });
  await call("narrator:submit", { requestId: request.requestId, text });
}
