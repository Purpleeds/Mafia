import { useEffect, useState } from "react";
import { AvatarBadge } from "../../components/AvatarBadge";
import { ErrorText } from "../../components/ErrorText";
import { FlipCard } from "../../components/FlipCard";
import { PlayerGrid } from "../../components/PlayerGrid";
import { ROLE_LABEL } from "../../lib/labels";
import { ROLE_INFO, TEAM_LABEL } from "../../lib/roles";
import { useAction } from "../../lib/useAction";
import { call } from "../../net/socket";
import { myPlayer, nameOf, type PhaseProps } from "./common";

export function RoleRevealScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const you = view.you;
  const me = myPlayer(view);
  const mode = view.settings.contentMode;
  const [faceUp, setFaceUp] = useState(false);
  const action = useAction();

  // Hide the card whenever the page loses attention, so a locked phone never leaves it showing.
  useEffect(() => {
    const hide = () => setFaceUp(false);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const players = view.players.filter((p) => !p.kicked);
  const ready = players.filter((p) => p.done).length;

  if (!you?.role || !me) {
    return (
      <section className="card center-block">
        <p className="card-lead">The roles are being dealt…</p>
        <p className="field-hint">
          {ready}/{players.length} players ready
        </p>
        <PlayerGrid players={view.players} youId={null} label="Players" />
      </section>
    );
  }

  const info = ROLE_INFO[you.role];
  const teammates = you.teammateIds.map((id) => view.players.find((p) => p.id === id)).filter((p) => !!p);

  return (
    <div className="reveal stack">
      <FlipCard
        faceUp={faceUp}
        onToggle={() => setFaceUp((v) => !v)}
        front={
          <>
            <span className="flip-emblem" aria-hidden="true">
              ?
            </span>
            <span className="flip-title">Tap to see your role</span>
            <span className="flip-sub">Make sure nobody is peeking!</span>
          </>
        }
        back={
          <>
            <span className="flip-emblem" aria-hidden="true">
              {info.emoji}
            </span>
            <span className="flip-role">{ROLE_LABEL[you.role]}</span>
            <span className="tag">{TEAM_LABEL[info.team]}</span>
            <span className="flip-text">{info.summary[mode]}</span>
            <span className="flip-text">
              <strong>Power:</strong> {info.ability[mode]}
            </span>
            <span className="flip-text">
              <strong>Your goal:</strong> {info.goal}
            </span>
            {teammates.length > 0 ? (
              <span className="flip-team">
                <strong>Your team:</strong>{" "}
                {teammates.map((t) => (
                  <span key={t.id} className="flip-teammate">
                    <AvatarBadge avatar={t.avatar} size={22} /> {nameOf(view, t.id)}
                  </span>
                ))}
              </span>
            ) : null}
            <span className="flip-sub">Tap to hide</span>
          </>
        }
      />
      <p className="sr-only" role="status">
        {faceUp ? `Your role is ${ROLE_LABEL[you.role]}. ${info.summary[mode]}` : "Your role is hidden."}
      </p>

      {me.done ? (
        <p className="card-lead center-text" role="status">
          <span aria-hidden="true">✓ </span>You're ready. Waiting for everyone ({ready}/{players.length})…
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block btn-large"
          disabled={action.pending}
          onClick={() => {
            setFaceUp(false);
            void action.run(() => call("game:ackRole", {}));
          }}
        >
          I'm ready
        </button>
      )}
      <ErrorText error={action.error} />

      <section className="card" aria-label="Who is ready">
        <h2 className="card-title">
          Ready: {ready}/{players.length}
        </h2>
        <PlayerGrid players={view.players} youId={you.id} label="Players" badges={Object.fromEntries(players.filter((p) => p.done).map((p) => [p.id, <span key={p.id} className="vote-badge">✓</span>]))} />
      </section>
    </div>
  );
}
