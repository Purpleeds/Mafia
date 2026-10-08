# Mafia

Online multiplayer Mafia / Werewolf with an automatic narrator. TypeScript monorepo:

- `shared/` – the Socket.IO event contract (`events.ts`), game vocabulary/view types (`game.ts`), the narrator's prompts and public
  facts (`narration.ts`) and the per-mode word lists (`wordlists.ts`), compiled to `dist/` as `@mafia/shared`
- `server/` – Node + Express + Socket.IO; also serves the built client
  - `game/` – the pure rules engine: `applyAction(state, action, { now, rng })` → new state; `getGameView(state, playerId)` → what one player may know
  - `rooms/` – `RoomService` (runs the engine per room, timers, chat, clean-up) over a `RoomStore` interface (`MemoryRoomStore` today)
  - `narration/` – what the AI narrator may be told (`facts.ts`), the checks every narration must pass (`checks.ts`) and the
    ready-made lines (`templates.ts`)
  - `socket/` – event handlers, payload validation, rate limiting, reconnect handling
- `client/` – Vite + React
  - `art/` – all the artwork, drawn in code as SVG: role cards, icons, the logo and the players' characters
  - `fx/` – the animated background (raw WebGL fragment shader) and its static fallback
  - `audio/` – all sound, generated with the Web Audio API (ambience, effects, tunes) and the volume/mute settings
  - `narrator/` – the host's side of the AI narrator (Puter.js loader and prompts) and the optional read-aloud voice
  - `lib/wording.ts` – every word that changes with the content mode or the Sneaky Gang name

The server is the single source of truth. Each player is sent only their own view of the game (`game:state`) through a private
Socket.IO room, so hidden information (other players' roles, night choices, detective results, Mafia chat) never reaches a browser
that shouldn't have it.

## Run locally

```bash
npm install
npm run dev      # server on :3000, Vite dev server on :5173 (open this one)
npm test         # engine, room service, narration and socket integration tests, then the client's art, effects, wording, narrator and sound tests
```

Production-style, on one port:

```bash
npm install
npm run build
npm start        # http://localhost:3000
```

## Screens (client)

Home (create or join; the code box jumps into the room as soon as it finds one) → Lobby (big code, link, QR code, Safe/Normal badge,
host settings) → Role reveal (tap-to-flip 3D card; it hides again when the page loses focus) → Night → Morning news (typewriter
narrator) → Day (player grid, chat, countdown) → Voting (tap to vote, live counts) → Vote results → Game over (roles, timeline,
Play Again). "How to play" and the role guide are pages (`/how-to-play`, `/role-guide`) and a help dialog inside the game.
The mode badge, room code and connection status are in the top bar on every in-game screen.

At night every player sees the same screen: players with a night power use it for real, everyone else gets a look-alike grid that
sends nothing to the server, so a glance at someone's phone tells you nothing about their role. The host can hide *who* voted for
whom (counts stay visible) with the "Show who voted for whom" setting.

## Look and feel

All art is original and made in code: no image files, no icon fonts, no emoji.

- **Background** (`client/src/fx`): one full-screen WebGL 1 fragment shader draws a cartoon village in a valley: sky, sun and
  moon crossing the sky, twinkling stars, drifting clouds, mist between the hills, the village and the meadow (noise), window
  lights that come on at night, a turning windmill, vignette and film grain. The village's three depth layers are SVG paths
  generated in `village.ts`; for WebGL they're drawn once into two textures (one colour channel per layer) so the mist can sit
  between them and the layers shift for parallax.
- **Day and night follow the game**: lobby afternoon, dusk at the role reveal, midnight at night, dawn for the morning news, a
  sunset for the vote results. Changes animate the sun or moon across the sky (`timeOfDay.ts`). Safe Mode is bright storybook;
  Normal Mode is darker and noir, with a crescent moon, heavier mist, more grain and a stronger vignette (`palette.ts`).
- **Moments**: an elimination is a soft puff of smoke with the player's card floating away (Safe) or a red pulse and shock ring
  (Normal); a Doctor's save is a soft green glow in both modes. The background joins in through `emitFx`. The host can turn
  off save announcements ("Announce the Doctor's saves"); the morning news never says who was saved, only the Doctor learns that.
- **Performance**: Auto picks a tier from a quick probe (WebGL and high-precision support, software rendering, Data Saver, GPU,
  memory, phone or computer): *high* (all effects, ≤ 2.2 MP per frame), *standard* (no clouds, ≤ 1 MP; phones), *lite*
  (simpler mist, no glow, smaller textures, ≤ 0.45 MP) or *static* (a CSS + SVG picture, no WebGL). It renders about 30 fps
  when the scene is calm and 60 during transitions, stops completely while the tab is hidden, and steps down a tier (remembered
  on the device) if frames come in slow. Reduced-motion users get the scene redrawn only when the phase changes. Players can pick
  Auto / Full / Lite / Off under Display in the help dialog or on the How to play page; `?fx=full|lite|off` forces one for a
  page load (handy for testing). `window.__mafiaFx` shows the current tier and frame rate.
- **Cards and animation**: role cards are SVG (each role has its own icon, colour and border ornaments) with a 3D flip; votes
  drop onto player cards; eliminated players fade; the game-over roles flip in. Fonts: Fraunces (titles; rounder in Safe
  Mode via its SOFT axis) and Nunito (UI), from Google Fonts.

## Content modes

The host picks **Safe Mode** (the default) or **Normal Mode** in the lobby. Everyone sees the mode as a badge (a word and an icon,
never colour alone) in the lobby and in the top bar of every in-game screen, and it can't change once the game starts: the server
only accepts settings in the lobby. The rules are identical in both modes; only the words, the look and the sounds change.

| | Safe Mode | Normal Mode |
| --- | --- | --- |
| Words | No weapons, death, blood or violence words anywhere. Players are *sent home*, *whisked away*, *caught by the Sneaky Gang*, *sent on a surprise holiday* | Film noir: shot in the night, found at the docks, poisoned at dinner. PG-13: no gore or graphic injury, no sexual content, no slurs, no real people |
| The Mafia's name | "The Mafia", or "The Sneaky Gang" if the host switches that on (it renames them on every screen, in the help and in the narration) | "The Mafia" |
| Look | Bright storybook village; an elimination is a soft puff of smoke | Dark noir village; an elimination is a red pulse |
| Sound | Birdsong, a cartoon "poof", cheerful tunes | More wind and owls, a dramatic sting, darker tunes |
| Chat filter | Always on: the server forces it, the host can't turn it off | On by default; the host may turn it off |

- `client/src/lib/wording.ts` is the one place that decides words like "eliminated", "graveyard" and "Mafia" for the mode and the
  Sneaky Gang name, so no screen hard-codes a violent word. `shared/src/wordlists.ts` holds the banned words per mode
  (`SAFE_BANNED_WORDS` has every violence, weapon, death and blood word and their forms; `NORMAL_BANNED_WORDS` has gore and sexual
  terms). They are used to check the AI's text on the server and by tests that scan every wording table, every ready-made
  narration and the rendered help pages. Inside a game the role guide only shows the room's own wording.
- The chat filter (`censorProfanity` in `shared/src/profanity.ts`) turns rude words into `****` on the server before a message is
  stored or sent, so nobody receives the original, not even the sender's own screen.

## AI narrator

The narrator runs itself: after every night (the morning news) and every vote it announces what happened. The text is a ready-made
line or, if the host switches it on, written by an AI through [Puter.js](https://developer.puter.com/):

1. In the lobby the host flips **Enable AI Narrator**. That click opens Puter's sign-in (Puter's "User Pays" model: the host's own
   Puter account pays for the AI, so the game needs no API key). Only the host's browser ever loads
   `https://js.puter.com/v2/`, and only when the host sees the switch; nobody else's browser contacts Puter.
2. When a night or a vote ends, the server sends **only public facts** to the host's private socket room (`narrator:request`):
   the names of the players who left and how (night, vote, broken heart), whether the Doctor's save is announced, the round, the
   mode and what the Mafia are called. Never roles, never who the Mafia, Doctor or Detective are, never ids, never anything hidden.
   A test generates hundreds of random games and checks the facts say nothing a player couldn't already see.
3. The host's browser calls `puter.ai.chat()` with the mode's system prompt (`shared/src/narration.ts`: 2–3 dramatic sentences,
   names exactly as given, the mode's content rules, never reveal or guess a role, output only the narration) and answers with
   `narrator:submit`. Player names are user input, so they go in quotes and the prompt tells the AI to treat them only as names.
4. The server checks the text before anyone sees it (`server/src/narration/checks.ts`): at most 400 characters, no markup, it must
   name every player who left and nobody else, no word from the mode's banned list (Safe Mode's covers all violence and weapon
   words), no profanity, no role words (the Doctor only when a save was announced) and nothing like "X is the Mafia".
5. While the AI writes, everyone sees "The narrator is thinking…". If the host never signed in, Puter errors, the answer fails a
   check, or nothing arrives within 6 seconds, a ready-made line is used instead, so the game never waits long. A late answer is
   ignored. The results screens hold while a narration is pending.

The ready-made lines (`server/src/narration/templates.ts`) are 78 for Safe Mode and 76 for Normal Mode; the most common case (one
player leaves) has 17 in each. A line is never repeated within a game. Narrations are part of the game state (`view.narration`),
so everyone gets the same text, and it is kept in the day's recap.

Optionally, a device can read the narration aloud with the browser's own speech synthesis (Sound settings; off by default; a
friendlier voice in Safe Mode, a gravelly one in Normal Mode).

## Sound

All sound is generated in code with the Web Audio API (`client/src/audio`): no audio files and no libraries, so there is nothing
to download or license and no sources to credit.

- **Background**: wind and birdsong by day; low wind, crickets and the odd owl at night. It crossfades (equal power) as the sky
  changes with the phase, and never loops audibly because the birds, crickets and owls are scheduled at random. Safe Mode has more
  birds; Normal Mode more wind and owls.
- **Effects**: button clicks, a vote landing, a tick for each of the last 10 seconds of a phase (firmer for the last 3), the
  elimination (a cartoon poof in Safe Mode, a dramatic sting in Normal Mode), a warm chime for the Doctor's save, and a victory or
  defeat tune at the end of the game, in the mode's style.
- **Controls**: the speaker button (home, lobby and top bar) opens volume, mute, background on/off, effects on/off and read-aloud.
  They're remembered on the device in `localStorage` (`mafia.audio`).
- Browsers only allow sound after a tap, so nothing starts until the first tap. Sound pauses when the tab is hidden. On an iPhone
  the silent switch also silences web audio, as with most web games.
- `window.__mafiaAudio` shows the audio state and how many of each sound have played (handy for testing).

## Chat

The server decides where every message goes (`chatChannelFor` in `server/src/game/chat.ts`) from the sender's role, status and the
phase. A client only sends `{ text }`; it can't pick, and can't try, a channel.

| Who | Phase | Channel |
| --- | --- | --- |
| Everyone | lobby, game over | Public |
| Living players | morning news, day, voting, vote results | Day chat (public) |
| Eliminated players and spectators | the same day phases | Spectator chat (`graveyard`), invisible to living players: they aren't sent it, don't get it in their history and don't see its tab |
| Living Mafia | night | Mafia chat (Mafia members only; it stays in their history afterwards) |
| Everyone else | night, and the role reveal | locked |

- Messages are 1–300 characters (control and invisible characters are stripped), limited to a burst of 5 then one a second per player.
- The profanity filter masks rude words on the server before a message is stored or sent: always in Safe Mode, the host's choice
  in Normal Mode (on by default).
- Four quick reactions (thinking, suspicious, laughing, shocked) sit above the text box wherever you may write. They are sent as
  `chat:react`, follow the same routing, lock and rate limit, and carry no text. At night the Mafia can react in their whisper box.

## Testing alone (development tools)

Everything here exists only while the server is **not** in production: `NODE_ENV` isn't `production` and `RENDER` isn't `true`
(`npm run dev` and a local `npm start` qualify; Render doesn't). In production the dev events are unknown events, `/dev-config`
answers `{ "dev": false }` and the client shows none of it.

- **Fill with bots**: a "Development tools" card in the host's lobby. *Fill with bots* brings the room up to 8 players, *Add a
  bot* adds one. Bots join through the same service call as a browser, so they are normal players (named "Bot Ada", "Bot Bo"…).
  Every 1.5 s each bot looks at its own view and maybe acts: it acknowledges its role, takes a random valid night action (the
  Mafia pick a victim, the Doctor protects, Cupid links two players…), votes at random (sometimes skip) and now and then chats or
  reacts, only where the server's chat rules let it (day chat, Mafia whisper at night, spectator chat once eliminated). They never
  use hidden state they shouldn't know and they go through the engine's normal validation. See `server/src/dev/bots.ts`.
- **Debug panel**: a small *Debug* button at the bottom left of any room screen opens the server's whole game state: a table of
  players with their secret roles (bots marked), the phase, round and timer, and the raw state as a collapsible tree. It refreshes
  by itself when the game changes, and has *Copy JSON*. (`dev:debugState`, any member of the room.)
- **Several real players**: open the site in more tabs, or in incognito windows. In development each browser *tab* remembers its
  own seat (sessionStorage instead of localStorage, and its own nickname), so tabs of one browser really are different players, and
  a refresh keeps each tab's seat. Incognito windows are separate browsers anyway. In production seats stay in localStorage so a
  closed and reopened tab resumes. The room-creation limits are relaxed in development.
- **The AI narrator in bot games**: it is off by default, so ready-made lines are used straight away. If the host switched it on
  but Puter isn't signed in or can't be reached, the host's browser answers with a failure and the ready-made line is used at
  once; if the host's page doesn't answer at all, after 6 seconds. A test plays whole bot games to the end both ways.

## Rooms and joining

- Room codes are 4 uppercase letters without look-alikes (no O, I, L, 0 or 1), checked for collisions and rude words.
  Hosts may pick a custom code of 4–8 letters/numbers instead (rude and reserved words are refused).
- Every room has a join link, `https://<site>/ABCD`, which opens straight on the nickname screen; the lobby shows it as a QR code.
- Nicknames: unique in the room, up to 16 characters, letters/numbers/spaces/basic punctuation, no rude words. Plus an avatar:
  a colour and a seed (8 letters/digits) that always draws the same little character (face, hair, hat, extras).
- Optional room password (stored as a salted scrypt hash). The host can set or remove it in the lobby.
- People joining after the game has started become spectators: they watch, can chat with eliminated players, and become players
  at the next game.
- Reconnecting: the session token from create/join is kept in localStorage; after a refresh or a locked phone the client sends
  `room:resume` and is back in the same seat with the same role. A dropped player shows as "reconnecting" for 60 s before being
  marked away. Lobby players (and spectators) who stay away 2 more minutes are removed.
- Host controls: start, settings (including Safe/Normal mode), kick, hand over hosting, password. If the host goes away, hosting
  passes to the next player in join order.
- Rooms with nobody connected are deleted after 10 minutes; lobbies nobody touches for 30 minutes, games after 3 hours.

## Socket events

All client → server events are `(payload, ack)`; the ack receives `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
Your identity always comes from the session the socket joined with, never from the payload.

| Client → server | Payload | Notes |
| --- | --- | --- |
| `room:create` | `{ name, avatar, customCode?, password? }` | returns `SessionInfo`; you are the host |
| `room:peek` | `{ roomCode }` | what the join screen needs: password?, lobby or in game, player count |
| `room:join` | `{ roomCode, name, avatar, password? }` | a player in the lobby, a spectator once the game has started |
| `room:resume` | `{ roomCode, sessionToken }` | rejoin after a refresh or reconnect |
| `room:leave` | `{}` | removes you from the lobby; mid-game it counts as a disconnect |
| `player:updateProfile` | `{ name?, avatar? }` | lobby only |
| `host:updateSettings` | `SettingsPatch` | host only, lobby only |
| `host:start` / `host:restart` | `{}` | host only |
| `host:kick` / `host:transfer` | `{ playerId }` | host only |
| `host:setPassword` | `{ password }` | `null` removes it |
| `game:ackRole` | `{}` | "I've seen my role" |
| `game:nightAction` | `{ targetId, secondTargetId? }` | Mafia/Doctor/Detective/Bodyguard/Cupid |
| `game:vote` | `{ targetId }` | a player id or `"skip"` |
| `chat:send` | `{ text }` | the server picks the channel (see Chat); a `channel` sent by a client is ignored |
| `chat:react` | `{ reaction }` | `thinking`, `suspicious`, `laughing` or `shocked`; routed exactly like `chat:send` |
| `narrator:submit` | `{ requestId, text }` | host only: the AI's narration for a `narrator:request`, or `null` if it failed |
| `time:sync` | `{ clientSentAt }` | returns `{ clientSentAt, serverNow }` |
| `dev:fillBots` / `dev:debugState` | `{ count? }` / `{}` | development only (see above): add bots / the full server state |

| Server → client | Payload |
| --- | --- |
| `server:hello` | `{ serverNow }` on connect |
| `game:state` | `{ version, serverNow, room: { code, hasPassword }, view }`; sent only when something you can see changed |
| `chat:message` / `chat:history` | one message / the history you're allowed to see |
| `narrator:request` | host only: `{ requestId, facts, timeoutMs }`, the public facts to turn into a narration (see AI narrator) |
| `room:removed` | `{ reason: left | kicked | dropped | room_closed, message }` |
| `session:replaced` | the same session was opened in another tab; this socket is closed |
| `server:error` | the error for an event sent without an ack |

`version` counts only the updates sent to your seat; reset what you hold when you get a new `SessionInfo`.
Countdowns: `view.phaseEndsAt - serverNow` is the time left when the update was sent; count down from there with
`performance.now()`. The client clock is never used.

If the server refuses a connection (`connect_error` with message `RATE_LIMITED`), Socket.IO stops retrying; the client waits a
few seconds and calls `socket.connect()` again.

## Render

Single Web Service, runtime `node`:

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`

The server reads `PORT`. Behind Render's proxy it reads the client IP from `X-Forwarded-For` (`TRUST_PROXY_HOPS`, default 1 when
`RENDER=true`). Rooms live in memory, so a deploy or restart ends running games. Logs are one line per event
(`INFO room.created room=ABCD ...`).
