/**
 * A tiny history-based router: "/" is Home, "/ABCD" (4–8 letters/numbers) is a
 * room, and two help pages. The server serves index.html for every path, so
 * deep links work.
 */
import { useSyncExternalStore } from "react";
import { roomCodeFromPath } from "@mafia/shared";

export type Route = { name: "home" } | { name: "room"; code: string } | { name: "how-to-play" } | { name: "role-guide" };

/** Help pages. They contain a hyphen, so they can never clash with a room code. */
export const HOW_TO_PLAY_PATH = "/how-to-play";
export const ROLE_GUIDE_PATH = "/role-guide";

const listeners = new Set<() => void>();
let currentPath = window.location.pathname;

function notify(): void {
  currentPath = window.location.pathname;
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  notify();
  window.scrollTo(0, 0);
}

export function goHome(options: { replace?: boolean } = {}): void {
  navigate("/", options);
}

export function goToRoom(code: string, options: { replace?: boolean } = {}): void {
  navigate(`/${code}`, options);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function parseRoute(pathname: string): Route {
  const bare = pathname.replace(/\/+$/, "").toLowerCase();
  if (bare === HOW_TO_PLAY_PATH) return { name: "how-to-play" };
  if (bare === ROLE_GUIDE_PATH) return { name: "role-guide" };
  const code = roomCodeFromPath(pathname);
  return code ? { name: "room", code } : { name: "home" };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => currentPath);
}

/** Puts the address bar into canonical form ("/abcd/" -> "/ABCD", unknown paths -> "/"). */
export function canonicalizeLocation(): void {
  const route = parseRoute(window.location.pathname);
  const canonical =
    route.name === "room"
      ? `/${route.code}`
      : route.name === "how-to-play"
        ? HOW_TO_PLAY_PATH
        : route.name === "role-guide"
          ? ROLE_GUIDE_PATH
          : "/";
  if (canonical !== window.location.pathname) navigate(canonical, { replace: true });
}
