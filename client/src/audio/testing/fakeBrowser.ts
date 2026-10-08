/**
 * Just enough of a browser (window, document, elements, localStorage and the
 * Web Audio constructor) to run the sound engine in a plain Node test.
 */
import { vi } from "vitest";
import { FakeAudioContext } from "./fakeAudio";

type Handler = (event: Record<string, unknown>) => void;

export class FakeEventTarget {
  private readonly handlers = new Map<string, Set<Handler>>();

  addEventListener(type: string, handler: Handler): void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(type, set);
  }

  removeEventListener(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Calls everything listening for `type`, as a browser does when the event happens. */
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler({ type, ...event });
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

const SIMPLE_SELECTOR = /^([a-z]*)(?:\.([\w-]+))?(?:\[([\w-]+)(?:='([^']*)')?\])?$/;

/** An element with a tag, attributes and a parent: enough for `closest(selector)`. */
export class FakeElement {
  disabled = false;

  constructor(
    readonly tag: string,
    readonly attrs: Record<string, string> = {},
    readonly parent: FakeElement | null = null,
  ) {}

  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const m = SIMPLE_SELECTOR.exec(part.trim());
      if (!m) return false;
      const [, tag, cls, attr, value] = m;
      if (tag && this.tag !== tag) return false;
      if (cls && !(this.attrs.class ?? "").split(/\s+/).includes(cls)) return false;
      if (attr) {
        const actual = this.attrs[attr];
        if (actual === undefined) return false;
        if (value !== undefined && actual !== value) return false;
      }
      return Boolean(tag || cls || attr);
    });
  }

  closest(selector: string): FakeElement | null {
    let el: FakeElement | null = this;
    while (el) {
      if (el.matches(selector)) return el;
      el = el.parent;
    }
    return null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

export interface FakeBrowser {
  window: FakeEventTarget & Record<string, unknown>;
  document: FakeEventTarget & { visibilityState: "visible" | "hidden" };
  /** What localStorage holds. */
  storage: Map<string, string>;
  /** A first press, as the browser delivers it: to the window, then to the document. */
  press(target: FakeElement | null, type?: string): void;
  /** Hides or shows the tab. */
  setVisibility(state: "visible" | "hidden"): void;
}

export interface FakeBrowserOptions {
  /** Saved values to start with. */
  storage?: Record<string, string>;
  /** localStorage throws on every use (a private window with storage blocked). */
  blockedStorage?: boolean;
  /** No Web Audio at all. */
  noAudio?: boolean;
  /** Making a context throws. */
  audioThrows?: boolean;
}

/** Installs the fakes as globals. Call `vi.unstubAllGlobals()` afterwards. */
export function installFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const storage = new Map(Object.entries(options.storage ?? {}));
  const localStorage = {
    getItem: (key: string): string | null => {
      if (options.blockedStorage) throw new Error("SecurityError: storage is blocked");
      return storage.get(key) ?? null;
    },
    setItem: (key: string, value: string): void => {
      if (options.blockedStorage) throw new Error("SecurityError: storage is blocked");
      storage.set(key, value);
    },
  };

  const win = Object.assign(new FakeEventTarget(), {
    localStorage,
    // Always the current timers, so fake timers installed by a test are used.
    setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number | undefined) => globalThis.clearTimeout(id),
    setInterval: (fn: () => void, ms?: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number | undefined) => globalThis.clearInterval(id),
  }) as unknown as FakeEventTarget & Record<string, unknown>;
  if (!options.noAudio) {
    win.AudioContext = options.audioThrows
      ? class {
          constructor() {
            throw new Error("NotSupportedError: no audio");
          }
        }
      : FakeAudioContext;
  }
  const doc = Object.assign(new FakeEventTarget(), { visibilityState: "visible" as "visible" | "hidden" });

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("Element", FakeElement);

  return {
    window: win,
    document: doc,
    storage,
    press(target, type = "pointerdown") {
      win.dispatch(type, { target });
      doc.dispatch(type, { target });
    },
    setVisibility(state) {
      doc.visibilityState = state;
      doc.dispatch("visibilitychange");
    },
  };
}
