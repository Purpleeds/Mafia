import { useEffect, useState } from "react";
import { Icon } from "../../art/icons";
import { CardBackArt, ROLE_THEME, RoleCardArt } from "../../art/roles";
import { AvatarBadge } from "../../components/AvatarBadge";
import { ErrorText } from "../../components/ErrorText";
import { FlipCard } from "../../components/FlipCard";
import { PlayerGrid } from "../../components/PlayerGrid";
import { ROLE_INFO } from "../../lib/roles";
import { fill, roleLabel, teamLabel } from "../../lib/wording";
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
        <PlayerGrid players={view.players} youId={null} label="Players" wording={view.settings} />
      </section>
    );
  }

  const role = you.role;
  const info = ROLE_INFO[role];
  const theme = ROLE_THEME[role];
  const teammates = you.teammateIds.map((id) => view.players.find((p) => p.id === id)).filter((p) => !!p);
  // Ink for the words printed on the card's paper.
  const ink = mode === "normal" ? "#f3e3c3" : theme.dark;
  const tag =
    mode === "normal"
      ? { color: "#c9a45a", boxShadow: "inset 0 0 0 1.5px #c9a45a" }
      : // Dark-on-light in the role's own colours: readable (7:1 or better) for every role.
        { color: theme.dark, background: theme.light, boxShadow: `inset 0 0 0 1.5px ${theme.main}` };

  return (
    <div className="reveal stack">
      <FlipCard
        faceUp={faceUp}
        onToggle={() => setFaceUp((v) => !v)}
        front={
          <>
            <CardBackArt mode={mode} className="flip-art" />
            <span className="flip-caption">
              <span className="flip-title">Tap to see your role</span>
              <span className="flip-sub">Make sure nobody is peeking!</span>
            </span>
          </>
        }
        back={
          <>
            <RoleCardArt role={role} mode={mode} name={roleLabel(role, view.settings)} className="flip-art" />
            <span className="flip-caption" style={{ color: ink }}>
              <span className="flip-team-tag" style={tag}>
                {teamLabel(info.team, view.settings)}
              </span>
              <span className="flip-summary">{fill(info.summary[mode], view.settings)}</span>
              <span className="flip-sub">Tap to hide</span>
            </span>
          </>
        }
      />
      <p className="sr-only" role="status">
        {faceUp ? `Your role is ${roleLabel(role, view.settings)}. ${fill(info.summary[mode], view.settings)}` : "Your role is hidden."}
      </p>

      {faceUp ? (
        <section className="card role-details" aria-label="About your role">
          <dl>
            <div>
              <dt>Your power</dt>
              <dd>{fill(info.ability[mode], view.settings)}</dd>
            </div>
            <div>
              <dt>Your goal</dt>
              <dd>{fill(info.goal, view.settings)}</dd>
            </div>
            {teammates.length > 0 ? (
              <div>
                <dt>Your team</dt>
                <dd className="flip-team">
                  {teammates.map((t) => (
                    <span key={t.id} className="flip-teammate">
                      <AvatarBadge avatar={t.avatar} size={26} /> {nameOf(view, t.id)}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : (
        <p className="field-hint role-details-hidden">Your power and goal show here while the card is face up.</p>
      )}

      {me.done ? (
        <p className="card-lead center-text" role="status">
          <Icon name="check" size={20} />
          You're ready. Waiting for everyone ({ready}/{players.length})…
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
        <PlayerGrid players={view.players} youId={you.id} label="Players" wording={view.settings} badges={Object.fromEntries(
            players
              .filter((p) => p.done)
              .map((p) => [
                p.id,
                <span key={p.id} className="vote-badge ready-badge" title="Ready">
                  <Icon name="check" size={16} />
                </span>,
              ]),
          )}
        />
      </section>
    </div>
  );
}
