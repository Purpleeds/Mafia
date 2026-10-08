import { useMemo, useState } from "react";
import type { ChatChannel, GameView } from "@mafia/shared";
import { friendlyError } from "../lib/errors";
import { call } from "../net/socket";
import { useAppState } from "../state/store";
import { ChatView } from "./ChatView";

const TAB_LABEL: Partial<Record<ChatChannel, string>> = { public: "Town chat", graveyard: "Graveyard" };

/** Day chat (and the graveyard for eliminated players and spectators). */
export function ChatPanel({ view }: { view: GameView }) {
  const all = useAppState((s) => s.chat);
  const you = view.you;
  const readable: ChatChannel[] = (you?.chat.read ?? ["public"]).filter((c) => c !== "mafia");
  const [tab, setTab] = useState<ChatChannel>("public");
  const active: ChatChannel = readable.includes(tab) ? tab : (readable[0] ?? "public");
  const canWrite = you?.chat.write.includes(active) ?? false;

  const messages = useMemo(() => all.filter((m) => m.channel === active), [all, active]);
  const avatarOf = (id: string) =>
    view.players.find((p) => p.id === id)?.avatar ?? view.spectators.find((s) => s.id === id)?.avatar ?? null;

  const send = async (text: string): Promise<string | null> => {
    const result = await call("chat:send", { channel: active, text });
    return result.ok ? null : friendlyError(result.error);
  };

  return (
    <section className="card chat-card" aria-labelledby="chat-title">
      <div className="card-header">
        <h2 id="chat-title" className="card-title">
          Chat
        </h2>
      </div>
      {readable.length > 1 ? (
        <div className="segmented" role="tablist" aria-label="Chat channel">
          {readable.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === active}
              className={`segment${c === active ? " is-selected" : ""}`}
              onClick={() => setTab(c)}
            >
              {TAB_LABEL[c] ?? c}
            </button>
          ))}
        </div>
      ) : null}
      <ChatView
        messages={messages}
        youId={you?.id ?? null}
        onSend={canWrite ? send : null}
        avatarOf={avatarOf}
        placeholder={active === "graveyard" ? "Message the graveyard" : "Message the town"}
        readOnlyNote={
          active === "public" && you && !you.alive
            ? "Eliminated players can watch, but can't talk to the living. Use the Graveyard tab."
            : "You can't write in this chat right now."
        }
        emptyText={active === "graveyard" ? "Only eliminated players and spectators see this." : "Say hello!"}
        label={TAB_LABEL[active] ?? "Chat"}
      />
    </section>
  );
}
