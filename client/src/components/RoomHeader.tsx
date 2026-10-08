import type { ReactNode } from "react";
import { goHome } from "../lib/router";

/** Room code (huge in the lobby), private-room lock and whatever the screen adds. */
export function RoomHeader({
  code,
  hasPassword,
  large,
  children,
}: {
  code: string;
  hasPassword: boolean;
  large?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={`room-header${large ? " is-large" : ""}`}>
      <div className="room-header-top">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => goHome()} aria-label="Home">
          <span aria-hidden="true">←</span>
        </button>
        <p className="eyebrow">Room code</p>
        {hasPassword ? (
          <span className="tag" title="Private room">
            <span aria-hidden="true">🔒 </span>Private
          </span>
        ) : (
          <span className="room-header-spacer" />
        )}
      </div>
      <h1 className="room-code" aria-label={`Room code ${code.split("").join(" ")}`}>
        {code}
      </h1>
      {children}
    </header>
  );
}
