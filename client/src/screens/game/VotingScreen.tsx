import type { ReactNode } from "react";
import { SKIP, type Avatar } from "@mafia/shared";
import { Icon } from "../../art/icons";
import { AvatarBadge } from "../../components/AvatarBadge";
import { ErrorText } from "../../components/ErrorText";
import { PlayerGrid } from "../../components/PlayerGrid";
import { useAction } from "../../lib/useAction";
import { call } from "../../net/socket";
import { myPlayer, nameOf, type PhaseProps } from "./common";

/** A player's vote count. Keyed by the count, so each new vote lands with a little bounce. */
function VoteBadge({ count, voters }: { count: number; voters: { id: string; name: string; avatar: Avatar }[] }) {
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
            <AvatarBadge key={v.id} avatar={v.avatar} size={20} label={`${v.name} voted for this`} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function VotingScreen({ received }: PhaseProps) {
  const { view } = received.payload;
  const voting = view.voting;
  const me = myPlayer(view);
  const action = useAction();
  if (!voting) return null;

  const canVote = !!me && me.alive;
  const valid = new Set(voting.validTargetIds);
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

  const vote = (targetId: string) => {
    if (voting.myBallot === targetId) return;
    void action.run(() => call("game:vote", { targetId }));
  };

  const electorate = view.players.filter((p) => p.alive && !p.kicked && p.connected);
  const voted = electorate.filter((p) => p.done).length;

  const skipSelected = voting.myBallot === SKIP;
  const skipCard = (
    <button
      type="button"
      className={`pcard pcard-skip${skipSelected ? " is-selected" : ""}`}
      disabled={!canVote || !valid.has(SKIP) || action.pending}
      aria-pressed={skipSelected}
      onClick={() => vote(SKIP)}
    >
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

  const tied = voting.previous?.tiedOptions.map((o) => (o === SKIP ? "Skip" : nameOf(view, o))) ?? [];

  return (
    <div className="stack">
      {voting.round === 2 ? (
        <p className="info-banner" role="status">
          <Icon name="scales" />
          It was a tie between {tied.join(" and ")}. Vote again!
        </p>
      ) : null}
      <section className="card">
        <h2 className="card-title">{canVote ? "Tap a player to vote" : "The town is voting"}</h2>
        <p className="field-hint" role="status">
          {canVote
            ? voting.myBallot
              ? `You voted for ${voting.myBallot === SKIP ? "Skip" : nameOf(view, voting.myBallot)}. Tap someone else to change your vote.`
              : "Not voting counts as Skip."
            : "You can watch the vote, but only living players can vote."}{" "}
          {voted} of {electorate.length} have voted.
        </p>
        <PlayerGrid
          players={view.players}
          youId={view.you?.id ?? null}
          label="Vote for a player"
          hideOut
          canPick={canVote ? (p) => valid.has(p.id) && !action.pending : undefined}
          selectedIds={voting.myBallot ? [voting.myBallot] : []}
          onPick={vote}
          badges={badges}
          extra={skipCard}
        />
        <ErrorText error={action.error} />
        {view.settings.showVotes ? null : (
          <p className="field-hint center-text">The host chose to hide who votes for whom. Only the counts are shown.</p>
        )}
      </section>
    </div>
  );
}
