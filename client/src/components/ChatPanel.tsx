import { useMemo, useState } from "react";
import { effectiveChatFilter, type ChatChannel, type ChatReaction, type GameView } from "@mafia/shared";
import { friendlyError } from "../lib/errors";
import { call } from "../net/socket";
import { useAppState } from "../state/store";
import { ChatView } from "./ChatView";
import { wordsFor } from "../lib/wording";

/** Day chat (and the graveyard for eliminated players and spectators). */
export function ChatPanel({ view, roomCode }: { view: GameView; roomCode: string }) {
  const all = useAppState((s) => s.chat);
  const you = view.you;
  const words = wordsFor(view.settings);
  const tabLabel: Partial<Record<ChatChannel, string>> = { public: "Town chat", graveyard: words.outChatTab };
  const readable: ChatChannel[] = (you?.chat.read ?? ["public"]).filter((c) => c !== "mafia");
  const [tab, setTab] = useState<ChatChannel>("public");
  const active: ChatChannel = readable.includes(tab) ? tab : (readable[0] ?? "public");
  const canWrite = you?.chat.write.includes(active) ?? false;

  const messages = useMemo(() => all.filter((m) => m.channel === active), [all, active]);
  const avatarOf = (id: string) =>
    view.players.find((p) => p.id === id)?.avatar ?? view.spectators.find((s) => s.id === id)?.avatar ?? null;

  const send = async (text: string): Promise<string | null> => {
    const result = await call("chat:send", { text });
    return result.ok ? null : friendlyError(result.error);
  };
  // The server picks the channel from who you are and the phase; the tab only chooses what to read.
  const react = async (reaction: ChatReaction): Promise<string | null> => {
    const result = await call("chat:react", { reaction });
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
              {tabLabel[c] ?? c}
            </button>
          ))}
        </div>
      ) : null}
      <ChatView
        messages={messages}
        youId={you?.id ?? null}
        roomCode={roomCode}
        uncensored={effectiveChatFilter(view.settings) === "uncensored"}
        onSend={canWrite ? send : null}
        onReact={canWrite ? react : null}
        avatarOf={avatarOf}
        placeholder={active === "graveyard" ? words.outChatPlaceholder : "Message the town"}
        readOnlyNote={
          active === "public" && you && !you.alive
            ? words.outChatNote
            : "You can't write in this chat right now."
        }
        emptyText={active === "graveyard" ? words.outChatEmpty : "Say hello!"}
        label={tabLabel[active] ?? "Chat"}
      />
    </section>
  );
}
