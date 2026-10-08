import { friendlyError } from "../lib/errors";
import { leaveRoom } from "../state/controller";
import { showToast } from "../state/store";
import { ConfirmButton } from "./ConfirmButton";

export function LeaveRoomButton({ inGame }: { inGame: boolean }) {
  const leave = async () => {
    const result = await leaveRoom();
    if (!result.ok) showToast(friendlyError(result.error));
  };
  return (
    <div className="leave">
      <ConfirmButton
        className="btn btn-ghost btn-block"
        prompt={inGame ? "Leave this game? You'll lose your seat." : "Leave this room?"}
        confirmLabel="Yes, leave"
        onConfirm={() => void leave()}
      >
        Leave room
      </ConfirmButton>
    </div>
  );
}
