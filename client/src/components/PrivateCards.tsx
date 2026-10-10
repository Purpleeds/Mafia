import type { GameView } from "@mafia/shared";
import { Icon } from "../art/icons";
import { RoleIcon } from "../art/roles";
import { ROLE_INFO } from "../lib/roles";
import { fill, isGangMember, roleLabel, teamLabel } from "../lib/wording";
import { AvatarBadge } from "./AvatarBadge";
import { BotTag } from "./BotTag";

/**
 * Privacy rule for these cards: every player in the game has exactly the same
 * cards, closed, in the same places, whatever their role. What a role knows
 * (an investigation, a save, a partner) is only inside, so nobody nearby can
 * tell a Detective or a Doctor from their screen.
 */

function nameIn(view: GameView, id: string): string {
  const player = view.players.find((p) => p.id === id);
  if (!player) return "Someone";
  return player.isBot ? `${player.name} (Bot)` : player.name;
}

function inGame(view: GameView): boolean {
  return !!view.you && !view.you.isSpectator && view.you.role !== null;
}

/** "Your role": your role, team, teammates, partner and investigations. Closed until you open it. */
export function MyRoleCard({ view }: { view: GameView }) {
  const you = view.you;
  if (!you || !inGame(view) || !you.role) return null;
  const role = you.role;
  const info = ROLE_INFO[role];
  const mode = view.settings.contentMode;
  const teammates = you.teammateIds.map((id) => view.players.find((p) => p.id === id)).filter((p) => !!p);
  const partner = you.loverIds?.includes(you.id) ? you.loverIds.find((id) => id !== you.id) : undefined;
  return (
    <details className="card private-card">
      <summary>
        <Icon name="eyeOff" size={18} />
        Your role <span className="field-hint">(only you can see this)</span>
      </summary>
      <div className="private-body">
        <p className="private-role">
          <RoleIcon role={role} size={28} />
          <strong>{roleLabel(role, view.settings)}</strong>
          <span className="tag">{teamLabel(info.team, view.settings)}</span>
        </p>
        <p>{fill(info.ability[mode], view.settings)}</p>
        <p className="field-hint">{fill(info.goal, view.settings)}</p>
        {teammates.length > 0 ? (
          <p className="private-team">
            Your team:{" "}
            {teammates.map((t) => (
              <span key={t.id} className="flip-teammate">
                <AvatarBadge avatar={t.avatar} size={22} /> {t.name}
                <BotTag player={t} />
              </span>
            ))}
          </p>
        ) : null}
        {partner ? <p>You and {nameIn(view, partner)} are linked: if one of you leaves the game, so does the other.</p> : null}
        {role === "cupid" && you.loverIds && !you.loverIds.includes(you.id) ? (
          <p>You linked {nameIn(view, you.loverIds[0])} and {nameIn(view, you.loverIds[1])}.</p>
        ) : null}
        {you.investigations.length > 0 ? (
          <ul className="notes">
            {you.investigations.map((i) => (
              <li key={`${i.round}-${i.targetId}`}>
                Night {i.round}: {nameIn(view, i.targetId)} is <strong>{isGangMember(i.isMafia, view.settings)}</strong>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The morning's "Your private note". Everyone in the game gets one at the same
 * moment; for most players it simply says nothing new happened.
 */
export function NightNoteCard({ view }: { view: GameView }) {
  const you = view.you;
  if (!you || !inGame(view) || view.phase !== "NIGHT_RESULTS") return null;
  const lines: string[] = [];
  const found = you.investigations.find((i) => i.round === view.round);
  if (found) lines.push(`${nameIn(view, found.targetId)} is ${isGangMember(found.isMafia, view.settings)}.`);
  if (you.role === "doctor" && you.protectedId && view.nightReport?.saved) {
    lines.push(`Your protection saved ${nameIn(view, you.protectedId)}!`);
  }
  if (view.round === 1 && you.loverIds) {
    const partner = you.loverIds.includes(you.id) ? you.loverIds.find((id) => id !== you.id) : undefined;
    if (partner) lines.push(`Cupid linked you and ${nameIn(view, partner)}. If one of you leaves the game, so does the other.`);
    else lines.push(`You linked ${nameIn(view, you.loverIds[0])} and ${nameIn(view, you.loverIds[1])}.`);
  }
  return (
    <details className="card private-card">
      <summary>
        <Icon name="eyeOff" size={18} />
        Your private note <span className="field-hint">(tap to read, only you can see it)</span>
      </summary>
      <div className="private-body">
        {lines.length > 0 ? lines.map((line) => <p key={line}>{line}</p>) : <p>Nothing new for you tonight.</p>}
      </div>
    </details>
  );
}
