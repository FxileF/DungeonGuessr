# DungeonGuessr

Guess the Hypixel SkyBlock dungeon room from a single screenshot. Each round has three steps:

1. **Shape**: 1x1, 1x2, 1x3, 1x4, 2x2 or L (1000 pts, keys 1–6)
2. **Secrets**: total secret count (1000 pts exact, 600 off by one, 300 off by two, keys 0–9)
3. **Room name** (3000 pts)

A game has 5 rounds, max 25 000 points.

## Game modes

- **Daily challenge**: the same 5 screenshots for everyone, chosen from the UTC date. One
  attempt per day; progress is saved after every answer, so reloading doesn't give a retry.
  Finishing on consecutive days builds a 🔥 streak.
- **Classic**: 5 random screenshots, optionally only Easy, Medium or Hard ones.

Both modes end with a **Share result** button that copies a spoiler-free emoji grid
(🟩 correct, 🟨 close, 🟥 wrong; one row per round: shape, secrets, name).

Streaks, stats (games, best, average) and settings are stored in the player's own browser
(localStorage). There is no account or server.

## Running locally

Requires [Node.js](https://nodejs.org/) 20.19+.

```sh
npm install
npm run dev        # dev server with hot reload → http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the built dist/ folder
```

Add `?debug` to the URL to show the answer under the screenshot while testing.

## Project layout

```
index.html                     page shell
src/main.ts                    menu, game flow and UI
src/data.ts                    types and data loading
src/scoring.ts                 points per step
src/storage.ts                 daily progress, streaks, stats (localStorage)
src/share.ts                   share text / clipboard
src/random.ts                  seeded RNG for the daily, date helpers
src/style.css                  styles
screenshots-src/               ORIGINAL screenshots (not published)
public/screenshots/            converted .webp images (generated)
public/data/screenshots.json   screenshot → room manifest (generated)
public/data/rooms.json         all dungeon rooms (generated)
scripts/import-screenshots.mjs converts screenshots-src/ → public/
scripts/room-aliases.json      fixes for file names that don't match a room
scripts/update-rooms.mjs       re-downloads room data from Odin
.github/workflows/deploy.yml   GitHub Pages deployment
```

## Adding screenshots

1. Take the screenshot in game with the HUD hidden (F1).
2. Put it in `screenshots-src/` named `RoomName-Number-Difficulty.png`, e.g.
   `PurpleFlags-2-Medium.png`. The room name is the name from `rooms.json` without spaces
   (any capitalization). The difficulty is `Easy`, `Medium` or `Hard`.
3. Run `npm run import-screenshots`.

The script converts each image to WebP (max 1600 px wide, ~50–150 KB instead of 1–3 MB), gives it a
neutral name (a hash, so the answer isn't visible in the file name), and rebuilds
`public/data/screenshots.json`. Only new or changed images are converted again; images whose
original was deleted are removed.

If a name doesn't match a room, the script prints `SKIP …` and leaves that picture out. Fix the file
name, or add a mapping to `scripts/room-aliases.json` (the key is the name in capitals without
spaces; the value is the room `id`, or `null` to deliberately skip it):

```json
{ "PURPLEFLAG": "purple-flags", "CORDIDOR": null }
```

`Cordidor-1-Easy.png` is currently skipped this way until its real room name is known.

## Room data

`public/data/rooms.json` is generated from the [Odin](https://github.com/odtheking/Odin) mod's room
database (BSD-3-Clause, see `THIRD_PARTY_NOTICES.md`). Refresh it with `npm run update-rooms`.

```json
{ "id": "supertall", "name": "Supertall", "type": "normal", "shape": "2x2", "secrets": 6, "crypts": 3, "guessable": true }
```

`normal`, `rare` and `puzzle` rooms are `guessable` (they appear in the name list). Trap, blood,
entrance, fairy and miniboss rooms are excluded.

## Publishing on GitHub Pages (when you're ready)

The site is fully static, so GitHub Pages can host it for free. It's already configured:
the build uses relative paths (`base: "./"` in `vite.config.ts`), so it works at
`https://<username>.github.io/DungeonGuessr/`.

1. Push this repository to GitHub (it must be **public** on a free account).
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The **Deploy to GitHub Pages** workflow builds and publishes the site
   automatically (progress is in the **Actions** tab).
4. After a minute, the site is live at `https://<username>.github.io/DungeonGuessr/`.

Every later push to `main` redeploys the site.

Notes:
- Only `dist/` is published, so `screenshots-src/` (with answer-revealing file names) isn't on the
  website. It **is** visible in the GitHub repository if the repo is public. If that matters, add
  `screenshots-src/` to `.gitignore` and keep the originals backed up elsewhere.
- Everything on a static site is visible to determined players, including
  `screenshots.json` with the answers. That's fine for a casual game. Global leaderboards
  would need a small backend that holds the answers and checks scores.
- Adding screenshots changes which ones the daily picks, so avoid adding them mid-day if
  players are comparing results.
