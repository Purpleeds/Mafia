import type { ReactNode } from "react";

interface FlipCardProps {
  faceUp: boolean;
  onToggle: () => void;
  /** The hidden side (shown face-down). */
  front: ReactNode;
  /** The secret side (shown face-up). */
  back: ReactNode;
}

/** A card that flips in 3D. Only the visible side is exposed to screen readers. */
export function FlipCard({ faceUp, onToggle, front, back }: FlipCardProps) {
  return (
    <button
      type="button"
      className={`flip-card${faceUp ? " is-flipped" : ""}`}
      onClick={onToggle}
      aria-pressed={faceUp}
      aria-label={faceUp ? "Hide your role" : "Show your role"}
    >
      <span className="flip-inner">
        <span className="flip-face flip-front" aria-hidden={faceUp}>
          {front}
        </span>
        <span className="flip-face flip-back" aria-hidden={!faceUp}>
          {back}
        </span>
      </span>
    </button>
  );
}
