import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduce";
}

interface TypewriterProps {
  text: string;
  /** Milliseconds per character. */
  speed?: number;
  onDone?: () => void;
  className?: string;
}

/**
 * The narrator's text, typed out letter by letter. Tap to show it all at once.
 * Screen readers get the full text immediately; people who prefer reduced motion get no animation.
 */
export function Typewriter({ text, speed = 32, onDone, className }: TypewriterProps) {
  const [count, setCount] = useState(() => (prefersReducedMotion() ? text.length : 0));
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finished = count >= text.length;

  useEffect(() => {
    setCount(prefersReducedMotion() ? text.length : 0);
  }, [text]);

  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => setCount((c) => Math.min(text.length, c + 1)), speed);
    return () => window.clearInterval(id);
  }, [finished, speed, text]);

  useEffect(() => {
    if (finished) doneRef.current?.();
  }, [finished]);

  return (
    <div
      className={`typewriter${className ? ` ${className}` : ""}`}
      onClick={() => setCount(text.length)}
      title={finished ? undefined : "Tap to skip"}
    >
      <p className="sr-only" role="status">
        {text}
      </p>
      <p className="typewriter-text" aria-hidden="true">
        {text.slice(0, count)}
        {finished ? null : <span className="typewriter-caret">▌</span>}
      </p>
      {finished ? null : <p className="field-hint center-text">Tap to skip</p>}
    </div>
  );
}
