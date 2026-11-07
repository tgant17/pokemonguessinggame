# Who's that Pokémon?

Pokémon Guessing Game is a fast-paced party quiz built with Next.js. Each round shows a hidden sprite; players must pick the correct Pokémon before the timer runs out (8 seconds by default, selectable before each game). Play solo, or open an online room and play with friends on your own phones.

## Features

- Loads Pokémon names from a local cache (`public/pokemon-list.json`) so autocomplete works offline.
- Prefetches all sprites for the round up front, preventing mid-round loading hitches.
- Silhouette effect while guessing, then reveals the sprite after your answer.
- Every game opens with a hand-drawn 3-2-1 countdown, drawn in the first round's card right where the silhouette is about to appear. The silhouette and its answer options stay hidden until "Go!", when the clock starts.
- Adjustable game length (5/10/25 rounds), selectable timer (5/8/10/15 seconds).
- Hard mode: two silhouettes stacked on top of each other, pick both Pokémon from 6 options (10-second clock by default).
- Legendary mode: three stacked silhouettes, pick all three from 8 options (15-second clock by default).
- In Hard and Legendary there's no lock-in: once you've picked two (or three) that's your answer, and you can change it freely until the clock runs out. Points are scored from the time of your last change, and these rounds always run to the end of the clock.
- Speed scoring: the clock is split into quarters. A correct answer in the first quarter earns 4 points, then 3, 2, and 1 in the final quarter. Wrong answers and time-outs score 0 and never take points away.
- In Hard and Legendary, naming only some of the stacked Pokémon earns partial points.
- Mobile-friendly UI.
- Online multiplayer: create a room, share the link or 4-letter code, and everyone plays on their own phone at the same time with a live scoreboard. Before the game screen, each player makes their name tag on a page of its own: a name (up to 10 characters, or roll the die for two Pokémon names mashed together), an aura color, and a partner picked from three random Pokémon.
- Room chat: under the chat log on the top screen, type a message or tap the pencil to draw a doodle on a little pad (undo and clear included), and everyone in the room sees it in the log. The log grows as people chat, then scrolls. It only follows new lines while you're at the bottom; if you've scrolled up to read, a **New messages** button takes you back down.
- Your name tag: tap it to change your name (type one or roll the die) and pick its color on a color wheel. The tag previews the color as you pick it, but neither changes until you tick the check. Both are remembered on your device, and in a room everyone sees changes right away.
- **Extras → Winner takes all** (rooms only, toggle under the main settings): the first player to answer fully right takes the whole pot (speed points × number of players) and the round ends there. Everyone else scores 0 that round. You get one guess each, with no partial credit in Hard and Legendary. If nobody gets it, nobody scores.

## Getting started

```bash
cd pokemonguessinggame
npm install
npm run fetch:pokemon   # refresh the cached name list (optional but recommended)
npm run dev
```

Open http://localhost:3000 in your browser. Edit files under `src/` and the page will hot reload.

### Multiplayer in development

Multiplayer rooms run on a small Cloudflare Worker (`party/room.ts`). In a second terminal:

```bash
npm run dev:party       # wrangler dev on port 8787, no Cloudflare account needed
```

Then pick **Multiplayer** on the home page and use **Create a room**. In development the site looks for the room server on port 8787 of whatever host served the page, so phones on the same Wi-Fi can join via your computer's IP address (for example http://192.168.1.20:3000/room/ABCD, with `npm run dev -- -H 0.0.0.0`).

## How multiplayer works

- Each room code gets its own Durable Object, a single server instance that runs the game for everyone in it.
- The host's browser picks the Pokémon (as in solo play) and sends the rounds to the server. From then on the server runs the clock and scores every answer with the same engine (`src/lib/engine.ts`) solo play uses, so all players see the same Pokémon and the same countdown.
- Each round's clock starts once everyone's sprites have loaded (or after 4 seconds). Players watch the 3-2-1 countdown at the same time, and the first round's clock waits for it to finish, so that round gives up on slow players after 7 seconds instead. Answers stay hidden until everyone still connected has answered (Normal mode only) or time runs out, so a player who leaves doesn't hold up the round. Someone who disconnects still counts as playing for 3 seconds, so refreshing the page doesn't end the round without them.
- Players are remembered by an id in the browser's local storage, so refreshing the page keeps your seat, score and any answer you'd put in. People who join mid-game watch (and see each reveal) until the next game.
- The first player to join hosts and picks the settings. Everyone else sees the same options update as the host picks them, grayed out so only the host can change them. If they're away, the next connected player can start; between games the host can hand hosting to someone else with **Make host**.
- Players who have left are dropped from the list when the next game starts (or when the room is full and someone new joins). A room that everyone has left is wiped after 5 minutes.
- Opening a room link (or creating or joining one from the home page) first shows the name tag page, where each player writes a name of up to 10 characters, picks an aura color (a fresh random one each time, which they can change on the wheel) and picks a partner from three random Pokémon. Stuck for a name? **Random name** under the name box mashes two random Pokémon together (Pikachu + Charizard → Pikazard). Roll again as often as you like. After joining it goes straight to the game screen; refreshing there goes back to the game, not the name tag page. The partner shows as a little pixel sprite next to their name in the players list and in the room's chat.
- The chat log on the top screen announces everyone who joins (with their partner, in the aura they joined with) and every name tag change (one line each time someone saves a new name or aura, showing the old tag and the new one in the auras they had). Something that happens mid-game appears just before the round it happened in, and each new game starts a fresh log.
- Players can post to the log too: chat lines of up to 120 characters, and drawings. A drawing is sent as pen strokes on a small grid (not an image), so it's a few kilobytes at most and the server can check every point. Each player can post 6 times in any 8 seconds; anything faster stays in the box to send in a moment. The log holds the latest 50 lines, and the server only resends it when it changes.
- Rooms hold up to 12 players.

## Deployment (Vercel)

1. Make sure `public/pokemon-list.json` is up to date (`npm run fetch:pokemon`).
2. Push the project to GitHub/GitLab.
3. In Vercel:
   - Import the repo.
   - Set **Root Directory** to `pokemonguessinggame`.
   - Build Command: `npm run fetch:pokemon && npm run build`.
   - Output Directory: `.next`.
4. Deploy.

### Multiplayer server (Cloudflare)

The room server runs on Cloudflare Workers, which works on the free plan.

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. From this folder, run `npx wrangler login`, then `npm run deploy:party`. Wrangler prints the Worker's address, e.g. `https://pokemonguessinggame-rooms.<your-subdomain>.workers.dev`.
3. In Vercel, add the environment variable `NEXT_PUBLIC_PARTY_HOST` with that host (without `https://`), e.g. `pokemonguessinggame-rooms.<your-subdomain>.workers.dev`, then redeploy.

Until `NEXT_PUBLIC_PARTY_HOST` is set, production builds hide the multiplayer buttons and solo play works as before (unless `PREVIEW_ENVIRONMENT` is on, below).

### Multiplayer in preview deployments

To step through the multiplayer screens in a Vercel preview, add the environment variable `PREVIEW_ENVIRONMENT` with the value `true`, ticking only **Preview**, then redeploy the preview.

With it on, the site never connects to a room server. Each room runs inside the page, using the same room rules as the real server, so you can create or join a room, pick a name and partner, start a game and play it through to the results. You're the only player in it: nobody else can join, and reloading the page starts the room over. `NEXT_PUBLIC_PARTY_HOST` is ignored while the flag is on.

The same flag works locally: `PREVIEW_ENVIRONMENT=true npm run dev` (no `npm run dev:party` needed).


## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run fetch:pokemon` | Refresh cached Pokémon list |
| `npm run dev:party` | Run the multiplayer room server locally (port 8787) |
| `npm run deploy:party` | Deploy the room server to Cloudflare |
| `npm test` | Unit tests for the game rules, engine and rooms |
| `npm run typecheck` | Type-check the site and the room server |
