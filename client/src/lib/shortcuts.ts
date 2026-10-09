import { useEffect, useRef } from "react";

/** The key that picks the n-th player (0-based): 1–9, then 0 for the tenth. */
export function keyForIndex(index: number): string | null {
  if (index < 0 || index > 9) return null;
  return index === 9 ? "0" : String(index + 1);
}

export function indexForKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return key === "0" ? 9 : Number(key) - 1;
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

interface ShortcutOptions {
  enabled: boolean;
  /** The players that can be picked, in the order they're shown (1 is the first). */
  ids: readonly string[];
  onPick: (id: string) => void;
  /** Enter. */
  onConfirm?: () => void;
  /** "S" picks this (the Skip card). */
  skipId?: string;
}

/**
 * Desktop keyboard shortcuts for picking players: number keys pick (1 is the
 * first player shown, 0 the tenth, S is Skip) and Enter confirms. Ignored
 * while typing in the chat or any other field, or with Ctrl, Alt or Cmd held.
 */
export function usePickShortcuts({ enabled, ids, onPick, onConfirm, skipId }: ShortcutOptions): void {
  const latest = useRef({ ids, onPick, onConfirm, skipId });
  latest.current = { ids, onPick, onConfirm, skipId };

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || typingInto(e.target)) return;
      if (document.querySelector("[aria-modal='true']")) return;
      const { ids: list, onPick: pick, onConfirm: confirm, skipId: skip } = latest.current;
      const index = indexForKey(e.key);
      if (index !== null) {
        const id = list[index];
        if (id) {
          e.preventDefault();
          pick(id);
        }
      } else if ((e.key === "s" || e.key === "S") && skip) {
        e.preventDefault();
        pick(skip);
      } else if (e.key === "Enter" && confirm) {
        // Enter on a focused button already presses it.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
