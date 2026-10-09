import { useEffect, useState } from "react";
import type { ContentMode } from "@mafia/shared";
import { speakNarration, stopSpeaking } from "../narrator/speech";
import { typingSpeed } from "../screens/game/common";
import type { ReceivedState } from "../state/store";
import { Typewriter } from "./Typewriter";

/** Shown while the AI (or the server) is still writing: "The narrator is thinking…". */
function NarratorThinking() {
  return (
    <p className="narrator-thinking" role="status">
      The narrator is thinking
      <span className="thinking-dots" aria-hidden="true">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </p>
  );
}

interface NarrationTextProps {
  received: ReceivedState;
  text: string;
  source: "ai" | "template" | null;
  mode: ContentMode;
  onDone: () => void;
}

/** The narration, typed out (and read aloud if the host-device setting is on). */
function NarrationText({ received, text, source, mode, onDone }: NarrationTextProps) {
  // The typing speed is picked once, when the text appears, from the time left in the phase.
  const [speed] = useState(() => typingSpeed(received, text.length));

  useEffect(() => {
    speakNarration(text, mode);
    return () => stopSpeaking();
  }, [text, mode]);

  return (
    <>
      <Typewriter text={text} speed={speed} onDone={onDone} />
      {source === "ai" ? (
        <p className="field-hint narrator-credit">Written by the AI narrator</p>
      ) : null}
    </>
  );
}

interface NarratorCardProps {
  received: ReceivedState;
  /** The morning news after a night, or the result of a vote. */
  kind: "night" | "vote";
  onDone: () => void;
}

/**
 * The narrator's announcement, from the server (the AI's text, or a ready-made
 * line). Everyone sees the same: first a thinking narrator, then the text.
 */
export function NarratorCard({ received, kind, onDone }: NarratorCardProps) {
  const { view } = received.payload;
  const narration = view.narration && view.narration.kind === kind ? view.narration : null;
  const text = narration?.status === "ready" ? narration.text : null;
  return (
    <section className="card narrator" aria-label="The narrator">
      <p className="eyebrow">The narrator</p>
      {text ? (
        <NarrationText
          key={`${narration?.round}:${text}`}
          received={received}
          text={text}
          source={narration?.source ?? null}
          mode={view.settings.contentMode}
          onDone={onDone}
        />
      ) : (
        <NarratorThinking />
      )}
    </section>
  );
}
