import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AvatarBadge } from "../../components/AvatarBadge";
import { ChatView } from "../../components/ChatView";
import { ErrorText } from "../../components/ErrorText";
import { PlayerGrid } from "../../components/PlayerGrid";
import { NIGHT_KINDS, NIGHT_PROMPT, NIGHT_VERB } from "../../lib/copy";
import { friendlyError } from "../../lib/errors";
import { useAction } from "../../lib/useAction";
import { call } from "../../net/socket";
import { useAppState } from "../../state/store";
import { hashText, nameOf, type PhaseProps } from "./common";

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Night. Everybody gets the same screen: a sleeping caption and a grid of players.
 * Players with a night power use it for real; everyone else gets a decoy that
 * looks and behaves the same but sends nothing, so watching someone's screen
 * (or their taps) tells you nothing about their role.
 */
export function NightScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const you = view.you;
  if (!you || you.isSpectator || !you.alive) return <NightWatching received={received} />;
  return <NightPlay key={view.round} received={received} />;
}

function NightSky() {
  return (
    <div className="night-sky" aria-hidden="true">
      <span className="moon">🌙</span>
      <span className="star s1">✦</span>
      <span className="star s2">✦</span>
      <span className="star s3">✦</span>
    </div>
  );
}

function NightWatching({ received }: PhaseProps) {
  const { view } = received.payload;
  return (
    <div className="night stack">
      <NightSky />
      <section className="card center-block">
        <h2 className="card-title">The town sleeps</h2>
        <p className="field-hint">
          {view.you?.isSpectator ? "You're watching this game." : "You've been eliminated. You can watch from here."}
        </p>
        <PlayerGrid players={view.players} youId={view.you?.id ?? null} label="Players" />
      </section>
    </div>
  );
}

function NightPlay({ received }: PhaseProps) {
  const { view } = received.payload;
  const you = view.you;
  const mode = view.settings.contentMode;
  const real = you?.nightAction ?? null;
  const action = useAction();
  const youId = you?.id ?? "";

  const decoyKind = NIGHT_KINDS[hashText(`${youId}:${view.round}`) % NIGHT_KINDS.length] ?? "kill";
  const kind = real?.kind ?? decoyKind;
  const need = kind === "link" ? 2 : 1;

  const living = useMemo(() => view.players.filter((p) => p.alive && !p.kicked), [view.players]);
  const validIds = useMemo(
    () =>
      real
        ? new Set(real.validTargetIds)
        : new Set(living.filter((p) => kind === "protect" || kind === "link" || p.id !== youId).map((p) => p.id)),
    [real, living, kind, youId],
  );

  const [picked, setPicked] = useState<string[]>(() => (real ? [...real.picks] : []));
  const [fakeLocked, setFakeLocked] = useState(false);
  const [fakePending, setFakePending] = useState(false);
  const fakeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(fakeTimer.current), []);

  const locked = real ? picked.length === need && sameSet(real.picks, picked) : fakeLocked;
  const pickedNames = picked.map((id) => nameOf(view, id)).join(" & ");

  const pick = (id: string) => {
    setFakeLocked(false);
    setPicked((current) => {
      if (need === 1) return [id];
      if (current.includes(id)) return current.filter((x) => x !== id);
      return current.length >= need ? [current[1] ?? id, id].slice(-need) : [...current, id];
    });
  };

  const confirm = () => {
    if (picked.length !== need) return;
    if (real) {
      void action.run(() => call("game:nightAction", { targetId: picked[0] ?? "", secondTargetId: picked[1] }));
    } else {
      // Decoy: look busy for a moment, send nothing.
      setFakePending(true);
      window.clearTimeout(fakeTimer.current);
      fakeTimer.current = window.setTimeout(() => {
        setFakePending(false);
        setFakeLocked(true);
      }, 350);
    }
  };

  // Mafia teammates' choices appear on the cards they picked.
  const badges: Record<string, ReactNode> = {};
  if (real?.teammateVotes) {
    for (const [voterId, targetId] of Object.entries(real.teammateVotes)) {
      if (voterId === youId) continue;
      const voter = view.players.find((p) => p.id === voterId);
      if (!voter) continue;
      badges[targetId] = (
        <span key={voterId} className="vote-badge" title={`${voter.name} picked this player`}>
          <AvatarBadge avatar={voter.avatar} size={20} label={`${voter.name} picked this player`} />
        </span>
      );
    }
  }

  const buttonLabel = locked
    ? "Locked in ✓ (tap a player to change)"
    : picked.length === need
      ? `${NIGHT_VERB[mode][kind]} ${pickedNames}`
      : need === 2
        ? "Pick two players"
        : "Pick a player";

  return (
    <div className="night stack">
      <NightSky />
      <p className="sleep-line" role="status">
        Sleeping{" "}
        <span className="zzz" aria-hidden="true">
          z z z
        </span>
      </p>
      <section className="card night-card">
        <h2 className="card-title">{NIGHT_PROMPT[mode][kind]}</h2>
        <PlayerGrid
          players={view.players}
          youId={youId}
          label="Players to choose from"
          hideOut
          canPick={(p) => validIds.has(p.id)}
          selectedIds={picked}
          onPick={pick}
          badges={badges}
        />
        <button
          type="button"
          className="btn btn-primary btn-block btn-large"
          disabled={picked.length !== need || action.pending || fakePending || locked}
          onClick={confirm}
        >
          {action.pending || fakePending ? "Locking in…" : buttonLabel}
        </button>
        <ErrorText error={action.error} />
        <Whisper view={view} real={you?.chat.write.includes("mafia") === true} />
      </section>
    </div>
  );
}

/** A "Whisper" box everybody has at night. It is the Mafia's private chat for them, and a dead end for everyone else. */
function Whisper({ view, real }: { view: NonNullable<PhaseProps["received"]["payload"]["view"]>; real: boolean }) {
  const [open, setOpen] = useState(false);
  const all = useAppState((s) => s.chat);
  const [local, setLocal] = useState<{ id: string; senderId: string; senderName: string; text: string }[]>([]);
  const you = view.you;
  const messages = real
    ? all.filter((m) => m.channel === "mafia")
    : local.map((m) => ({ ...m, channel: "mafia" as const, sentAt: 0 }));
  const avatarOf = (id: string) => view.players.find((p) => p.id === id)?.avatar ?? null;

  const send = async (text: string): Promise<string | null> => {
    if (real) {
      const result = await call("chat:send", { channel: "mafia", text });
      return result.ok ? null : friendlyError(result.error);
    }
    setLocal((cur) => [...cur, { id: String(cur.length), senderId: you?.id ?? "", senderName: you?.name ?? "", text }]);
    return null;
  };

  return (
    <div className="whisper">
      <button type="button" className="btn btn-block" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">🤫 </span>Whisper
      </button>
      {open ? (
        <ChatView
          messages={messages}
          youId={you?.id ?? null}
          onSend={send}
          avatarOf={avatarOf}
          placeholder="Whisper…"
          emptyText="It's quiet…"
          label="Whisper"
        />
      ) : null}
    </div>
  );
}
