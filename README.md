# Mafia

Online multiplayer Mafia / Werewolf with an automatic narrator. TypeScript monorepo:

- `shared/` – the Socket.IO event contract (`events.ts`), game vocabulary/view types (`game.ts`), the narrator's prompts and public
  facts (`narration.ts`) and the per-mode word lists (`wordlists.ts`), compiled to `dist/` as `@mafia/shared`
- `server/` – Node + Express + Socket.IO; also serves the built client
  - `game/` – the pure rules engine: `applyAction(state, action, { now, rng })` → new state; `getGameView(state, playerId)` → what one player may know
  - `rooms/` – `RoomService` (runs the engine per room, timers, chat, clean-up) over a `RoomStore` interface
    (`MemoryRoomStore`, or `PersistentRoomStore` which also writes every room to Key Value/Redis when `REDIS_URL` is set)
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

Home (create or join; "Rejoin your last game" when your last room still runs; the code box jumps into the room as soon as it
finds one) → Lobby (big code, link, QR code, Ready button, host settings and picture approvals) → Role reveal (tap-to-flip 3D
card; it hides again when the page loses focus) → Night → Morning news (typewriter narrator) → Day (player grid, chat, "Done
talking", countdown) → Voting (pick, then confirm; live counts) → Vote results → Game over (roles, highlights, timeline, Play
Again). "How to play" and the role guide are pages (`/how-to-play`, `/role-guide`) and a help dialog inside the game. A small
mode label, the room code and the connection status are in the top bar on every in-game screen.

At night every player sees the same screen: players with a night power use it for real, everyone else gets a look-alike grid that
sends nothing to the server, so a glance at someone's phone tells you nothing about their role. The host can hide *who* voted for
whom (counts stay visible) with the "Show who voted for whom" setting.

## Look and feel

All art is original and made in code: no image files, no icon fonts, no emoji anywhere in the interface. Icons come from one set,
[Lucide](https://lucide.dev) (`lucide-react`, ISC licence, a permissive MIT-style licence), drawn in the text colour through the
`Icon` component (`client/src/art/icons.tsx`), so every screen uses the same line style. There is one small logo, on the home
screen only; in a room the mode is a quiet text label, and typography and spacing do the rest.

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
| Chat filter | Always **Strict**: the server forces it, and the option isn't shown | **Standard** by default; the host may pick Strict, Standard or Uncensored |
| Players' own pictures | **Host approval** by default (also Off or On) | **On** by default (also Off or Host approval) |

- `client/src/lib/wording.ts` is the one place that decides words like "eliminated", "graveyard" and "Mafia" for the mode and the
  Sneaky Gang name, so no screen hard-codes a violent word. `shared/src/wordlists.ts` holds the banned words per mode
  (`SAFE_BANNED_WORDS` has every violence, weapon, death and blood word and their forms; `NORMAL_BANNED_WORDS` has gore and sexual
  terms). They are used to check the AI's text on the server and by tests that scan every wording table, every ready-made
  narration and the rendered help pages. Inside a game the role guide only shows the room's own wording.
- The chat filter (`filterChatText` in `shared/src/profanity.ts`) turns words into `****` on the server before a message is
  stored or sent, so nobody receives the original, not even the sender's own screen (see Chat for the levels).

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
- **Filter levels** (host setting, applied on the server before a message is stored or sent; whole words become `****`):
  - *Strict*: swearing, slurs, sexual words and telling someone to hurt themselves, plus milder words ("damn", "hell", "idiot",
    "stupid", "shut up"…).
  - *Standard*: the same without the milder words.
  - *Uncensored*: nothing is hidden. **Normal Mode only.** In Safe Mode chat is always Strict, the option is hidden, and the
    server refuses any request for another level, however it is sent (a crafted `host:updateSettings`, remembered settings on
    `room:create`, or a stored room from an older version). When Uncensored is on, everyone sees a notice in the lobby and above
    the chat.
- **Always on, at every level, Uncensored included**: the length limit, the rate limit, the host's kick, and **no links**. A message
  with a web address, a bare domain (`free-robux.gg`), "example dot com" or an IP address is refused with "Links can't be shared
  in chat" (`containsLink`; words like "ok.so" or "e.g." are fine). Chat is shown as plain text, so nothing in it is ever clickable.
- **Hide strong language for me**: every player's own switch (under the chat and in Display settings) runs the Strict filter on
  their screen only, whatever the host chose. Saved on the device (`mafia.prefs`).
- **Mute**: tap a name in the chat, or the "…" next to a player, to hide their messages on your screen only (they aren't told).
  Muted players are remembered per room on the device (`mafia.muted`).
- Four quick reactions, as small word buttons, sit above the text box wherever you may write: **Sus**, **Agree**, **No way**,
  **Hmm**. They are sent as `chat:react`, follow the same routing, lock and rate limit, and carry no text. At night the Mafia can
  react in their whisper box.

## Players' own pictures

In the lobby (or on the create/join form) a player can use their drawn avatar or their own picture.

- **On the device**: pick a PNG, JPG or WebP up to 2 MB. GIFs and SVGs are refused; the type is read from the file's first bytes,
  not its name. Drag and zoom to choose the square (only the circle shows), and it is shrunk to 128x128 before it is sent. The
  cropped picture is remembered on the device (`mafia.photo`) and sent again automatically in the next room, unless that room's
  host turned it down or removed it.
- **Upload**: `POST /api/avatar` with the raw bytes, the room code in `X-Room-Code` and the session token as a Bearer token. The
  server checks, in order: a per-IP limit; that the token belongs to someone in that room, in the lobby, with pictures allowed;
  **3 uploads per player per minute** (failed tries count); at most 2 MB (a bigger body is refused without being read).
- **Never trusted**: the server reads the real type from the bytes (PNG, JPEG or WebP only; GIF, SVG and anything else refused),
  makes the decoder agree, refuses animated images and decompression bombs (over 16 megapixels), then **re-encodes the pixels
  with [sharp](https://sharp.pixelplumbing.com/) into a fresh 128x128 WebP**. Metadata (EXIF, location), extra chunks and anything
  appended to the file are gone. Anything that fails is rejected.
- **Stored in memory only**, with the room (`server/src/rooms/avatars.ts`), never on disk or in Key Value. A picture is deleted
  when its player leaves or is removed, and every picture when the room closes. After a server restart players simply have their
  drawn avatars until they upload again (which their device does by itself in the lobby).
- **Only for the room**: pictures are sent as `avatar:images` (data URLs the server encoded) through each member's private socket
  room, once per picture; nobody outside the room can get them, and there is no public URL.
- **Host controls** (lobby setting *Players' own pictures*): **Off**, **On** (shows to everyone straight away) or **Host approval**
  (the host sees each new picture in "Pictures to approve" and approves or rejects it; until then only the uploader and the host
  see it). Safe Mode defaults to Host approval, Normal Mode to On. The host can remove anyone's picture at any time (the "…" menu),
  which puts their drawn avatar back; the player is told.

## During a game

- **Host controls** (top bar, host only): **Pause** (the timer freezes for everyone; choices still count, but the phase can't end
  until the host resumes), **+30 s** (up to 15 minutes left) and, during the discussion, **Skip to voting**. Everyone sees a short
  message and the action in the log.
- **Done talking**: every player still in can tap it during the discussion; when they all have, voting starts early.
- **Voting**: tap a player (or press their number), then confirm. "Your vote: …" always shows your current choice, and you can
  change it until the timer ends. When everyone has voted the timer drops to a 10-second last call instead of closing at once.
- **What's happened so far**: a collapsible log of public events only (who left the game and how, vote results, ties, removals,
  pauses and skips). Roles appear only when the host reveals roles; saves only when the host announces them.
- **My notes**: tag other players Suspect, Trust or Unsure and add a few words. On your device only, cleared when the game ends.
  Tags show on the player cards on your screen.
- **Private cards, the same for everyone**: what your role knows is inside a closed "Your role" card and, each morning, a closed
  "Your private note", which every player has, in the same place, at the same time ("Nothing new for you tonight" for most). No
  role gets an extra card or banner that someone sitting nearby could spot.
- **Vibration** (phones that support it): a buzz when a new phase starts, on every phone at once, and a short tap when you confirm
  something on your own screen. At night the decoy confirm buzzes exactly like a real one. Nothing ever buzzes, sounds or flashes
  only for players with a night role.
- **Keep the screen on**: the Screen Wake Lock API keeps phones awake during a game, asked for again whenever the page comes back.
  Where a browser doesn't support it nothing changes and the phone's own auto-lock applies.
- **First-game tips**: a short tip the first time you see each phase, the same for every role. "Got it" hides one; "Turn off tips"
  hides them all (Display settings can show them again).
- **Keyboard** (computers): number keys pick players (1 is the first card shown, 0 the tenth, S is Skip) and Enter confirms, at
  night and when voting. The numbers show on the cards.
- **Messages about people**: everyone else gets a short message when someone joins, leaves, is removed by the host, loses their
  connection (after the 60-second grace) or comes back, and when the host changes.
- **Remembered**: your name, drawn avatar, picture and display settings, and (for hosts) the last room settings, which a new room
  starts with (the server checks them like any change and ignores them if anything is off).
- **Loading and errors**: every wait has a spinner and words, a screen that hits a bug shows a "Reload" card instead of going
  blank, and errors are friendly sentences (technical server messages are never shown).

## Bots

When there aren't enough players, the host can fill seats with bots from the **Bots** card in the lobby:

- **Add bot**, **Remove bot** (the newest one) and **Fill to 5** (just enough bots to reach the 5-player minimum). At most 10
  bots per room, and the room's 20-player limit still applies.
- **Bot difficulty**: *Easy* (mostly random choices) or *Normal* (the reasoning below).
- **Solo practice** (off by default): a game needs at least 2 real players, unless the host turns this on to play alone with bots.
- **Replace a bot when someone joins** (on by default): when a person joins a lobby that is full, or at the size the host filled
  it to, the newest bot leaves to make space. A bot that has the name a person wants takes another one.
- **Bot takes over for disconnected players** (on by default): if a player stays disconnected past the 60-second grace period
  (or leaves) during a game, a bot plays their seat with exactly what they knew. Everyone sees "A bot is now playing for Sam.",
  and their name shows *Bot playing*. When they reconnect they get the seat back ("Sam is back and playing again."). Hosting
  always passes to a person.

Bots get a fun name from a built-in list (never one a person in the room has), a generated avatar, and a small **Bot** label
wherever their name appears: the player list and cards, votes, chat, notes, teammates and the game-over screen.

**Fair play.** The bot code (`server/src/bots/`) can't see the game. The room service hands each bot seat exactly the payloads
it sends that seat's socket (its personal `game:state` view, the chat it may read, its chat history) through a `BotSink`, and
the bots act only through a `BotPort`: the same validated actions a human sends (`SET_READY`, `ACK_ROLE`, `NIGHT_ACTION`,
`CAST_VOTE`, `SKIP_DISCUSSION`, chat and reactions), checked by the engine like any player's. The bot module imports only the
shared types, its own files and the logger, and a test checks that. Bots wait a random 4–15 s before a night action or a vote
(a few seconds to get ready or acknowledge a role), so how fast a phase ends doesn't give away who has a night role.

**How Normal bots play.** Each bot keeps its own suspicion score for every other player, from public information only: who
voted for whom (when votes are shown), who was eliminated and their role (when revealed), accusations and Detective claims in
chat, players who were taken at night (whoever they accused looks worse), and votes that match an eliminated Mafia member's.

- Mafia bots go along with a human teammate's pick (and tell human teammates in the Mafia chat who they want), never pick
  each other, prefer whoever is onto them or claims to be the Detective, and rarely vote for a teammate.
- Doctor bots protect a claimed Detective, sometimes themselves, otherwise someone they trust (never the same person twice in a row).
- Detective bots investigate the most suspicious players they haven't checked, and when they find the Mafia they sometimes say
  so in the day chat ("I checked Sam. They're Mafia.").
- Everyone else votes for the most suspicious player, follows strong accusations, and sometimes skips when unsure.
- A few chat lines per day at most (6 for all bots in a room per phase), from separate Safe Mode and Normal Mode line sets, with
  random delays. No emoji. Bots standing in for a person never chat.

## Testing alone (development tools)

Everything here exists only while the server is **not** in production: `NODE_ENV` isn't `production` and `RENDER` isn't `true`
(`npm run dev` and a local `npm start` qualify; Render doesn't). In production the dev events are unknown events, `/dev-config`
answers `{ "dev": false }` and the client shows none of it. (Bots themselves are a normal feature, see above.)

- **Debug panel**: a small *Debug* button at the bottom left of any room screen opens the server's whole game state: a table of
  players with their secret roles (bot seats marked), the phase, round and timer, and the raw state as a collapsible tree. It refreshes
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
- Host controls: start (it lights up once everyone has tapped Ready), settings (including Safe/Normal mode, chat filter and pictures), kick, hand over hosting, password, approve or remove pictures, and pause, +30 s and skip to voting during a game. If the host goes away, hosting
  passes to the next player in join order.
- Rooms with nobody connected are deleted after 10 minutes; lobbies nobody touches for 30 minutes, games after 3 hours.

## Socket events

All client → server events are `(payload, ack)`; the ack receives `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
Your identity always comes from the session the socket joined with, never from the payload.

| Client → server | Payload | Notes |
| --- | --- | --- |
| `room:create` | `{ name, avatar, customCode?, password?, settings? }` | returns `SessionInfo`; you are the host; `settings` are the host's last ones |
| `room:peek` | `{ roomCode }` | what the join screen needs: password?, lobby or in game, player count |
| `room:join` | `{ roomCode, name, avatar, password? }` | a player in the lobby, a spectator once the game has started |
| `room:resume` | `{ roomCode, sessionToken }` | rejoin after a refresh or reconnect |
| `room:checkSeat` | `{ roomCode, sessionToken }` | home screen: `{ stage, seatValid }`, changes nothing |
| `room:leave` | `{}` | removes you from the lobby; mid-game it counts as a disconnect |
| `player:updateProfile` | `{ name?, avatar? }` | lobby only |
| `player:setReady` | `{ ready }` | lobby only |
| `player:removeAvatar` | `{}` | back to your drawn avatar |
| `host:updateSettings` | `SettingsPatch` | host only, lobby only |
| `host:start` / `host:restart` | `{}` | host only |
| `host:kick` / `host:transfer` | `{ playerId }` | host only |
| `host:setPassword` | `{ password }` | `null` removes it |
| `host:reviewAvatar` | `{ playerId, approve }` | host only: approve or reject a waiting picture |
| `host:removeAvatar` | `{ playerId }` | host only, any time |
| `host:pause` / `host:resume` / `host:addTime` | `{}` | host only, any timed phase (+30 s, up to 15 min left) |
| `host:skipToVoting` | `{}` | host only, day discussion |
| `host:addBot` / `host:removeBot` / `host:fillBots` | `{}` | host only, lobby; returns `{ bots, players }` |
| `game:ackRole` | `{}` | "I've seen my role" |
| `game:nightAction` | `{ targetId, secondTargetId? }` | Mafia/Doctor/Detective/Bodyguard/Cupid |
| `game:vote` | `{ targetId }` | a player id or `"skip"`; can change until the timer ends |
| `game:skipDiscussion` | `{ skip }` | "Done talking" during the discussion |
| `chat:send` | `{ text }` | the server picks the channel (see Chat); a `channel` sent by a client is ignored |
| `chat:react` | `{ reaction }` | `sus`, `agree`, `no_way` or `hmm`; routed exactly like `chat:send` |
| `narrator:submit` | `{ requestId, text }` | host only: the AI's narration for a `narrator:request`, or `null` if it failed |
| `time:sync` | `{ clientSentAt }` | returns `{ clientSentAt, serverNow }` |
| `dev:debugState` | `{}` | development only (see above): the full server state |

| Server → client | Payload |
| --- | --- |
| `server:hello` | `{ serverNow }` on connect |
| `game:state` | `{ version, serverNow, room: { code, hasPassword }, view }`; sent only when something you can see changed |
| `chat:message` / `chat:history` | one message / the history you're allowed to see |
| `avatar:images` | `{ images: [{ id, dataUrl }] }`, the pictures you may see (members of the room only) |
| `room:notice` | `{ kind, playerId, name }`: joined, left, kicked, dropped, disconnected, reconnected, host_changed, avatar_* |
| `narrator:request` | host only: `{ requestId, facts, timeoutMs }`, the public facts to turn into a narration (see AI narrator) |
| `room:removed` | `{ reason: left | kicked | dropped | room_closed, message }` |
| `session:replaced` | the same session was opened in another tab; this socket is closed |
| `server:error` | the error for an event sent without an ack |

`version` counts only the updates sent to your seat; reset what you hold when you get a new `SessionInfo`.
Countdowns: `view.phaseEndsAt - serverNow` is the time left when the update was sent; count down from there with
`performance.now()`. The client clock is never used.

If the server refuses a connection (`connect_error` with message `RATE_LIMITED`), Socket.IO stops retrying; the client waits a
few seconds and calls `socket.connect()` again.

## Deploying to Render

The game runs as one Render **Web Service** (the server also serves the built client).

| | |
| --- | --- |
| Service name | `Mafiascl` |
| Workspace | William's workspace |
| URL | https://mafiascl.onrender.com |
| Region | Singapore (the closest region to Australia) |
| Plan | Free |
| Runtime | Node |
| Repo and branch | `Purpleeds/Mafia`, branch `main` |
| Build command | `npm ci --include=dev && npm run build` (installs everything, then builds `shared`, `server` and `client`, in that order) |
| Start command | `npm start` (runs the compiled server, `node server/dist/index.js`) |
| Health check | `/health` (also `/healthz`) answers `200 {"ok":true}`. Set it under *Settings > Health Check Path* |
| Environment | `NODE_ENV=production`, `REDIS_URL` (the Key Value's internal URL, set on Render only, never in the code). `PORT` and `RENDER=true` are set by Render |
| Room storage | Render **Key Value** `mafia-rooms` (free plan, Singapore, same workspace), reached over the private network |

**How deploys work.** Auto-deploy is on: every push to `main` builds and deploys by itself (about a minute), and the old version
keeps serving until the new one is healthy. Don't trigger deploys by hand after a push. Changing an environment variable also
redeploys. Build logs, runtime logs and service events (crashes, restarts, out-of-memory kills, failed health checks) are in the
Render dashboard for the service.

The server reads its port from `process.env.PORT` and listens on `0.0.0.0`. Behind Render's proxy it takes the client IP from
`X-Forwarded-For` (`TRUST_PROXY_HOPS`, default 1 when `RENDER=true`). The client connects with Socket.IO to the same origin it was
loaded from (no hard-coded host), starts with HTTP long-polling and upgrades to WebSocket, and reconnects by itself with
back-off. Development tools (the debug panel) are off in production; bots are a normal feature.

### Free plan: read this before a game night

- **The service sleeps after about 15 minutes without visitors.** The first visit afterwards can take up to a minute to wake
  it. The game shows a "Waking up the village…" screen while it connects. Open the site yourself a minute before everyone joins.
- **Rooms survive redeploys, crashes and sleep, but not a Key Value restart.** Every change to a room is written to the Key Value
  (`mafia:room:<code>`, kept 6 hours after the last change). When the web service starts it loads every room back, resumes the
  timers, and gives everyone 60 seconds to reconnect before they count as disconnected (nights and votes don't end early because
  nobody is connected yet). The page reconnects by itself, so players land back in the same seat with the same role.
- **The free Key Value keeps data in memory only.** If Render restarts the Key Value itself (maintenance, which can happen at any
  time), every saved room is lost and running games end, as before. You get one free Key Value per workspace, and upgrading it
  to a paid plan starts it empty.
- **If the Key Value can't be reached** at start-up (no answer within 5 s), the server logs `store.kv_unavailable fallback=memory`
  and runs with rooms in memory only. If it goes away while running, games carry on in memory and failed writes are logged as
  `store.kv_write_failed` (at most once a minute). The log line `store.ready kind=keyvalue rooms=N` shows it is working.
- Locally, rooms live in memory unless you set `REDIS_URL` (e.g. `REDIS_URL=redis://localhost:6379 npm start`).
- The free plan has limited CPU and 512 MB of memory, plenty for a handful of rooms.

## Playing as the host: the AI narrator (Puter.js)

Everyone gets a narrator by default: after every night and every vote the game announces what happened with a ready-made line,
with no setup. As the host you can let an AI write the announcements instead:

1. In the lobby, switch on **Enable AI Narrator**. Your browser opens Puter's sign-in window (Puter.js, loaded only in the
   host's browser). Sign in with a free Puter account, or create one.
2. That's all. Puter's "User Pays" model means *your* Puter account covers the AI use; the game has no API key and the server
   never sees your Puter login.
3. After each night and vote, the server sends your browser only public facts (who left the game and how, whether a save was
   announced, the round, the mode, what the Mafia are called). Your browser asks Puter's AI to write 2–3 sentences and sends the
   text back; the server checks it and shows it to everyone with "Written by the AI narrator".
4. If you didn't sign in, the sign-in was cancelled, Puter is unreachable, the answer is unsafe or nothing arrives within 6
   seconds, a ready-made line is used instead, so the game never waits for long. Keep the host's tab open and in front: if the
   host's browser is asleep, the narration falls back to the ready-made lines.

The AI is never told anyone's role, so it can't give anything away, and the server rejects anything violent (in Safe Mode),
role-revealing or longer than 400 characters. Details are in *AI narrator* above.
