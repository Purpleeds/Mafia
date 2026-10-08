import { useEffect, useState, type CSSProperties } from "react";
import type { ContentMode, DeathView, GameView } from "@mafia/shared";
import { Icon, type IconName } from "../../art/icons";
import { RoleIcon } from "../../art/roles";
import { AvatarBadge } from "../../components/AvatarBadge";
import { claimMoment, emitFxOnce } from "../../fx/scene";
import { ROLE_LABEL } from "../../lib/labels";
import { nameOf } from "./common";

/** Smoke puffs around the avatar: direction, size and start time. */
const PUFFS = [
  { dx: -52, dy: -34, size: 58, delay: 0.25 },
  { dx: 6, dy: -58, size: 66, delay: 0.3 },
  { dx: 58, dy: -26, size: 54, delay: 0.36 },
  { dx: -40, dy: 26, size: 46, delay: 0.42 },
  { dx: 46, dy: 30, size: 50, delay: 0.38 },
  { dx: -8, dy: 8, size: 72, delay: 0.28 },
  { dx: 96, dy: -8, size: 40, delay: 0.5 },
] as const;

function causeOf(death: DeathView, mode: ContentMode): { icon: IconName; text: string } {
  const safe = mode === "safe";
  if (death.cause === "heartbreak") return { icon: "brokenHeart", text: safe ? "Went home with a broken heart" : "Died of a broken heart" };
  if (death.cause === "vote") return { icon: "ballot", text: safe ? "Sent home by the town" : "Voted out" };
  return { icon: "moon", text: safe ? "Sent home by the Mafia" : "Killed in the night" };
}

interface DeathCardsProps {
  deaths: DeathView[];
  view: GameView;
  /** Identifies this announcement, so its effect plays only once. */
  moment: string;
}

/**
 * Who just left the game. The first time they're shown, Safe Mode plays a soft
 * poof of smoke while each player's card floats away; Normal Mode hits with a
 * red pulse. The background joins in through emitFx.
 */
export function DeathCards({ deaths, view, moment }: DeathCardsProps) {
  const mode = view.settings.contentMode;
  const [fresh] = useState(() => deaths.length > 0 && claimMoment(moment));

  useEffect(() => {
    if (fresh) emitFxOnce(moment, { kind: "eliminate", mode });
  }, [fresh, moment, mode]);

  if (deaths.length === 0) return null;
  return (
    <ul className="death-list" aria-label="Who was eliminated">
      {deaths.map((death, index) => {
        const player = view.players.find((p) => p.id === death.playerId);
        const name = nameOf(view, death.playerId);
        const cause = causeOf(death, mode);
        const poof = fresh && mode === "safe";
        const struck = fresh && mode === "normal";
        const delay = { animationDelay: `${index * 0.3}s` } satisfies CSSProperties;
        return (
          <li key={death.playerId} className={`death-card${struck ? " is-struck" : ""}`} style={struck ? delay : undefined}>
            <div className={`death-body${poof ? " is-settling" : ""}`} style={poof ? delay : undefined}>
              {player ? <AvatarBadge avatar={player.avatar} size={56} /> : null}
              <div className="death-text">
                <p className="death-name">{name}</p>
                <p className="field-hint">
                  <Icon name={cause.icon} size={14} /> {cause.text}
                  {death.role ? (
                    <>
                      {" · "}
                      <RoleIcon role={death.role} size={16} /> {ROLE_LABEL[death.role]}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            {poof ? (
              <>
                <div className="ghost-card" aria-hidden="true" style={delay}>
                  {player ? <AvatarBadge avatar={player.avatar} size={56} /> : null}
                  <span className="death-name">{name}</span>
                </div>
                <span className="poof" aria-hidden="true">
                  {PUFFS.map((p, i) => (
                    <span
                      key={i}
                      className="puff"
                      style={
                        {
                          "--dx": `${p.dx}px`,
                          "--dy": `${p.dy}px`,
                          "--size": `${p.size}px`,
                          "--delay": `${p.delay + index * 0.3}s`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </span>
              </>
            ) : null}
            {struck ? <span className="shock-ring" aria-hidden="true" style={delay} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The morning news when the Doctor saved someone: an anonymous notice with a
 * soft green glow (both modes). The Doctor alone also learns it was their save.
 */
export function SaveNotice({ view, moment }: { view: GameView; moment: string }) {
  const mode = view.settings.contentMode;
  const [fresh] = useState(() => claimMoment(moment));
  useEffect(() => {
    if (fresh) emitFxOnce(moment, { kind: "save" });
  }, [fresh, moment]);

  const you = view.you;
  const yourSave = you?.role === "doctor" && you.protectedId ? you.protectedId : null;
  return (
    <section className={`card save-card${fresh ? " is-fresh" : ""}`} aria-labelledby="save-title">
      <div className="save-head">
        <Icon name="shield" size={42} className="save-icon" />
        <div>
          <h2 id="save-title" className="card-title">
            {mode === "safe" ? "The Doctor saved the day!" : "A life was saved"}
          </h2>
          <p className="field-hint">
            {mode === "safe"
              ? "Someone was in trouble last night, but the Doctor got there first."
              : "The Mafia struck, but the Doctor's patient lived to see the morning."}
          </p>
        </div>
      </div>
      {yourSave ? (
        <p className="card-lead">
          Your protection saved {nameOf(view, yourSave)}! <span className="field-hint">Only you can see this.</span>
        </p>
      ) : null}
    </section>
  );
}
