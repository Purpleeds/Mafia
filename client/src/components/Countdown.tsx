import { useEffect, useState } from "react";
import { Icon } from "../art/icons";
import { sounds } from "../audio/engine";

interface CountdownProps {
  /** Server epoch ms when the phase ends (view.phaseEndsAt). */
  endsAt: number | null;
  /** Server clock when the state was sent (payload.serverNow). */
  serverNow: number;
  /** performance.now() when the state arrived. */
  receivedAt: number;
  className?: string;
}

/** Time left, using only the server's clock and the local monotonic clock (never Date.now()). */
export function remainingMs(endsAt: number, serverNow: number, receivedAt: number, now: number): number {
  return endsAt - serverNow - Math.max(0, now - receivedAt);
}

export function Countdown({ endsAt, serverNow, receivedAt, className }: CountdownProps) {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (endsAt === null) return;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [endsAt, serverNow, receivedAt]);

  const seconds =
    endsAt === null ? null : Math.max(0, Math.ceil(remainingMs(endsAt, serverNow, receivedAt, now) / 1000));

  // The last ten seconds tick (the sound engine decides if it may be heard).
  useEffect(() => {
    if (seconds !== null) sounds.tick(seconds);
  }, [seconds]);

  if (seconds === null) return null;
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span
      className={`countdown${seconds <= 5 ? " is-urgent" : ""}${className ? ` ${className}` : ""}`}
      role="timer"
      aria-label={`${seconds} seconds left`}
    >
      <Icon name="timer" size={16} className="countdown-icon" />
      {text}
    </span>
  );
}
