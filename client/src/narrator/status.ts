import { useSyncExternalStore } from "react";
import { isPuterSignedIn, loadPuter, puterUsername, startPuterSignIn } from "./puter";

/**
 * What this browser knows about Puter, for the host's "Enable AI Narrator"
 * card: is the script loaded, is the host signed in, did something go wrong.
 */
export interface NarratorStatus {
  /** loading: fetching puter.js. ready: loaded. signing_in: the popup is open. failed: couldn't load. */
  phase: "idle" | "loading" | "ready" | "signing_in" | "failed";
  signedIn: boolean;
  username: string | null;
  error: string | null;
}

let status: NarratorStatus = { phase: "idle", signedIn: false, username: null, error: null };
const listeners = new Set<() => void>();

function update(patch: Partial<NarratorStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function getNarratorStatus(): NarratorStatus {
  return status;
}

export function useNarratorStatus(): NarratorStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getNarratorStatus,
  );
}

/** Loads Puter in the background (host only, when the settings card appears), so the sign-in click can be instant. */
export async function preparePuter(): Promise<void> {
  if (status.phase === "ready" || status.phase === "loading" || status.phase === "signing_in") return;
  update({ phase: "loading", error: null });
  try {
    const puter = await loadPuter();
    const signedIn = isPuterSignedIn(puter);
    update({ phase: "ready", signedIn, username: signedIn ? await puterUsername(puter) : null });
  } catch {
    update({ phase: "failed", error: "Couldn't reach Puter. The built-in narrator will be used." });
  }
}

/**
 * Signs the host in to Puter. Call it from the click that turns the narrator
 * on; it starts the sign-in before anything else so the popup isn't blocked.
 * Resolves true once signed in.
 */
export function signInFromClick(): Promise<boolean> {
  const signingIn = startPuterSignIn(); // the popup opens here, synchronously
  update({ phase: "signing_in", error: null });
  return signingIn.then(
    async () => {
      update({ phase: "ready", signedIn: true, username: await puterUsername(), error: null });
      return true;
    },
    () => {
      update({
        phase: status.signedIn ? "ready" : "ready",
        signedIn: isPuterSignedIn(),
        error: "Sign-in didn't finish. The built-in narrator will be used.",
      });
      return false;
    },
  );
}
