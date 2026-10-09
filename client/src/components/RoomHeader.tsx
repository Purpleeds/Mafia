import type { ReactNode } from "react";
import type { ContentMode } from "@mafia/shared";
import { Icon } from "../art/icons";
import { goHome } from "../lib/router";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { ModeBadge } from "./ModeBadge";
import { SoundButton } from "./SoundControls";

/** Room code (huge in the lobby), private-room lock and whatever the screen adds. */
export function RoomHeader({
  code,
  hasPassword,
  large,
  mode,
  children,
}: {
  code: string;
  hasPassword: boolean;
  large?: boolean;
  mode?: ContentMode;
  children?: ReactNode;
}) {
  return (
    <header className={`room-header${large ? " is-large" : ""}`}>
      <div className="room-header-top">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => goHome()} aria-label="Home">
          <Icon name="back" size={20} />
        </button>
        <p className="eyebrow">Room code</p>
        <span className="room-header-end">
          {hasPassword ? (
            <span className="tag" title="Private room">
              <Icon name="lock" size={14} />Private
            </span>
          ) : null}
          <SoundButton />
        </span>
      </div>
      <h1 className="room-code" aria-label={`Room code ${code.split("").join(" ")}`}>
        {code}
      </h1>
      <div className="room-meta">
        {mode ? <ModeBadge mode={mode} /> : null}
        <ConnectionIndicator />
      </div>
      {children}
    </header>
  );
}
