import { useEffect, useState, type ReactNode } from "react";
import { SKIP, type AvatarView } from "@mafia/shared";
import { Icon } from "../../art/icons";
import { AvatarBadge } from "../../components/AvatarBadge";
import { ErrorText } from "../../components/ErrorText";
import { PlayerGrid } from "../../components/PlayerGrid";
import { haptic } from "../../lib/haptics";
import { gameKey, useNotes } from "../../lib/notes";
import { keyForIndex, usePickShortcuts } from "../../lib/shortcuts";
import { useAction } from "../../lib/useAction";
import { call } from "../../net/socket";
import { myPlayer, nameOf, type PhaseProps } from "./common";
import { sounds } from "../../audio/engine";

/** A player's vote count. Keyed by the count, so each new vote lands with a little bounce. */
function VoteBadge({ count, voters }: { count: number; voters: { id: string; name: string; avatar: AvatarView; isBot: boolean }[] }) {
  if (count === 0) return null;
  return (
    <span className="vote-badge-group">
      <span key={count} className="vote-count" aria-label={`${count} ${count === 1 ? "vote" : "votes"}`}>
        <Icon name="ballot" size={13} />
        {count}
      </span>
      {voters.length > 0 ? (
        <span className="voter-row">
          {voters.map((v) => (
            <AvatarBadge key={v.id} avatar={v.avatar} size={20} label={`${v.name}${v.isBot ? " (Bot)" : ""} voted for this`} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Voting: tap a player (or press their number), then confirm. Your current vote
 * is always spelled out, and you can change it until the timer ends; once
 * everyone has voted, there's a short last call before the votes are counted.
 */
export function VotingScreen({ received }: PhaseProps) {
  const { view, room } = received.payload;
  const voting = view.voting;
  const me = myPlayer(view);
  const action = useAction();
  const notes = useNotes(gameKey(room.code, view.gameNumber));
  const myBallot = voting?.myBallot ?? null;
  const [picked, setPicked] = useState<string | null>(myBallot);
  const canVote = !!voting && !!me && me.alive;
  const valid = new Set(voting?.validTargetIds ?? []);

  // A new round (a revote) starts with nothing picked.
  useEffect(() => {
    setPicked(myBallot);
  }, [voting?.round]);

  const shown = view.players.filter((p) => p.alive && !p.kicked);
  const pickIds = canVote ? shown.filter((p) => valid.has(p.id)).map((p) => p.id) : [];
  const confirm = (target = picked) => {
    if (!target || target === myBallot || action.pending) return;
    void action.run(() => call("game:vote", { targetId: target })).then((result) => {
      if (result.ok) {
        sounds.vote();
        haptic("tap");
      }
    });
  };
  usePickShortcuts({
    enabled: canVote,
    ids: pickIds,
    onPick: (id) => setPicked(id),
    onConfirm: () => confirm(),
    skipId: valid.has(SKIP) ? SKIP : undefined,
  });

  if (!voting) {
    return (
      <section className="card center-block" role="status">
        <span className="spinner" aria-hidden="true" />
        <p className="card-lead">Opening the vote…</p>
      </section>
    );
  }

  const { tally, ballots } = voting.live;
  const votersOf = (target: string) =>
    ballots
      ? Object.entries(ballots)
          .filter(([, t]) => t === target)
          .map(([id]) => view.players.find((p) => p.id === id))
          .filter((p) => !!p)
      : [];

  const badges: Record<string, ReactNode> = {};
  for (const p of view.players) {
    badges[p.id] = <VoteBadge count={tally[p.id] ?? 0} voters={votersOf(p.id)} />;
  }

  const electorate = view.players.filter((p) => p.alive && !p.kicked && p.connected);
  const voted = electorate.filter((p) => p.done).length;
  const label = (id: string) => (id === SKIP ? "Skip" : nameOf(view, id));

  const skipSelected = picked === SKIP;
  const skipCard = (
    <button
      type="button"
      className={`pcard pcard-skip${skipSelected ? " is-selected" : ""}`}
      disabled={!canVote || !valid.has(SKIP) || action.pending}
      aria-pressed={skipSelected}
      onClick={() => setPicked(SKIP)}
    >
      {canVote && valid.has(SKIP) ? (
        <kbd className="pcard-key" aria-hidden="true">
          S
        </kbd>
      ) : null}
      <span className="pcard-badges">
        <VoteBadge count={tally[SKIP] ?? 0} voters={votersOf(SKIP)} />
      </span>
      <Icon name="skip" size={34} className="skip-icon" />
      <span className="pcard-name">Skip</span>
      <span className="pcard-caption">Nobody goes this round</span>
      {skipSelected ? (
        <span className="pcard-check" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
      ) : null}
    </button>
  );

  const tied = voting.previous?.tiedOptions.map(label) ?? [];
  const changed = picked !== null && picked !== myBallot;
  const myVoteAvatar = myBallot && myBallot !== SKIP ? view.players.find((p) => p.id === myBallot)?.avatar : null;

  return (
    <div className="stack">
      {voting.round === 2 ? (
        <p className="info-banner" role="status">
          <Icon name="scales" />
          It was a tie between {tied.join(" and ")}. Vote again!
        </p>
      ) : null}
      {voting.lastCall ? (
        <p className="info-banner last-call" role="status">
          <Icon name="clock" />
          Everyone has voted. Votes can still change until the timer ends.
        </p>
      ) : null}
      <section className="card">
        <h2 className="card-title">{canVote ? "Pick a player, then confirm" : "The town is voting"}</h2>
        {canVote ? (
          <div className={`my-vote${myBallot ? " has-vote" : ""}`} role="status">
            {myBallot ? (
              <>
                <Icon name="check" size={18} />
                {myVoteAvatar ? <AvatarBadge avatar={myVoteAvatar} size={24} /> : null}
                <span>
                  Your vote: <strong>{label(myBallot)}</strong>
                </span>
              </>
            ) : (
              <span>You haven&apos;t voted yet. Not voting counts as Skip.</span>
            )}
          </div>
        ) : (
          <p className="field-hint">You can watch the vote, but only players still in the game can vote.</p>
        )}
        <p className="field-hint" role="status">
          {voted} of {electorate.length} have voted.
        </p>
        <PlayerGrid
          players={view.players}
          youId={view.you?.id ?? null}
          label="Vote for a player"
          silentClicks
          wording={view.settings}
          hideOut
          canPick={canVote ? (p) => valid.has(p.id) && !action.pending : undefined}
          selectedIds={picked ? [picked] : []}
          onPick={(id) => setPicked(id)}
          badges={badges}
          extra={skipCard}
          keyFor={(id) => keyForIndex(pickIds.indexOf(id))}
          notes={notes}
        />
        {canVote ? (
          <button
            type="button"
            className="btn btn-primary btn-block btn-large"
            disabled={!changed || action.pending}
            onClick={() => confirm()}
          >
            {action.pending
              ? "Voting…"
              : changed && picked
                ? myBallot
                  ? `Change my vote to ${label(picked)}`
                  : `Confirm vote: ${label(picked)}`
                : myBallot
                  ? "Vote confirmed (pick someone else to change it)"
                  : "Pick a player"}
          </button>
        ) : null}
        <p className="field-hint center-text keyboard-hint">Keyboard: press a player&apos;s number (S for Skip), then Enter.</p>
        <ErrorText error={action.error} />
        {view.settings.showVotes ? null : (
          <p className="field-hint center-text">The host chose to hide who votes for whom. Only the counts are shown.</p>
        )}
      </section>
    </div>
  );
}
