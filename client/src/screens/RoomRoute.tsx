import { goHome } from "../lib/router";
import { abandonSavedSession, retryResume } from "../state/controller";
import { useAppState } from "../state/store";
import { JoinScreen } from "./JoinScreen";
import { RoomScreen } from "./RoomScreen";

/** "/CODE": your room if you're in it, rejoining if a seat is saved, otherwise the join form. */
export function RoomRoute({ code }: { code: string }) {
  const session = useAppState((s) => s.session);
  const sessionStatus = useAppState((s) => s.sessionStatus);
  const sessionError = useAppState((s) => s.sessionError);
  const game = useAppState((s) => s.game);
  const connection = useAppState((s) => s.connection);

  if (!session || session.roomCode !== code) return <JoinScreen code={code} />;
  if (game && game.payload.room.code === code) return <RoomScreen received={game} />;

  if (sessionStatus === "error") {
    return (
      <div className="screen center-screen">
        <section className="card center-block">
          <h1 className="card-title">Couldn't rejoin room {code}</h1>
          <p className="error-text" role="alert">
            {sessionError ?? "Something went wrong."}
          </p>
          <div className="stack">
            <button type="button" className="btn btn-primary btn-block" onClick={retryResume}>
              Try again
            </button>
            <button type="button" className="btn btn-block" onClick={() => abandonSavedSession(code)}>
              Join as a new player
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => goHome()}>
              Home
            </button>
          </div>
        </section>
      </div>
    );
  }

  const text =
    connection !== "connected"
      ? "Connecting…"
      : sessionStatus === "resuming"
        ? `Rejoining room ${code}…`
        : `Joining room ${code}…`;
  return (
    <div className="screen center-screen">
      <div className="center-block" role="status">
        <span className="spinner spinner-large" aria-hidden="true" />
        <p className="card-lead">{text}</p>
        <button type="button" className="btn btn-ghost" onClick={() => goHome()}>
          Home
        </button>
      </div>
    </div>
  );
}
