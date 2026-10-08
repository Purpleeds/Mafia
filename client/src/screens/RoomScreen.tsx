import type { ReceivedState } from "../state/store";
import { GameScreen } from "./GameScreen";
import { LobbyScreen } from "./LobbyScreen";

export function RoomScreen({ received }: { received: ReceivedState }) {
  return received.payload.view.phase === "LOBBY" ? (
    <LobbyScreen received={received} />
  ) : (
    <GameScreen received={received} />
  );
}
