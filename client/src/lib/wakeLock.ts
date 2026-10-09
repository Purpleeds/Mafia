import { useEffect, useState } from "react";

/** The Screen Wake Lock API, where the browser has it. */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export type WakeLockStatus = "off" | "on" | "unsupported" | "denied";

/**
 * Keeps the screen on while `active` (during a game), so phones don't lock in
 * the middle of a night. The browser drops the lock whenever the page is
 * hidden, so it is asked for again when the page comes back. Where the API
 * doesn't exist (or the browser says no) nothing happens: the game works the
 * same, the phone just follows its own auto-lock.
 */
export function useWakeLock(active: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>(wakeLockSupported() ? "off" : "unsupported");

  useEffect(() => {
    if (!active || !wakeLockSupported()) {
      setStatus(wakeLockSupported() ? "off" : "unsupported");
      return;
    }
    const api = (navigator as unknown as { wakeLock: WakeLockLike }).wakeLock;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await api.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        setStatus("on");
        sentinel.addEventListener("release", () => {
          if (!cancelled) setStatus("off");
        });
      } catch {
        if (!cancelled) setStatus("denied");
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    // Some browsers only grant it after a tap.
    window.addEventListener("pointerdown", onVisible, { passive: true });
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onVisible);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    };
  }, [active]);

  return status;
}
