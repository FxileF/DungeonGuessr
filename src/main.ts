import "./style.css";
import {
  DIFFICULTIES, SHAPES, asset, loadData,
  type Difficulty, type GameData, type Room, type Screenshot, type Shape,
} from "./data";
import { hashString, mulberry32, shuffle, todayUTC } from "./random";
import { MAX_POINTS, MAX_ROUND, scoreName, scoreSecrets, scoreShape } from "./scoring";
import { copyText, shareText } from "./share";
import {
  getDaily, getPrefs, getStats, getStreaks, recordGame, saveDaily, setPrefs,
  type Points, type SavedRound,
} from "./storage";

const ROUNDS_PER_GAME = 5;
// true: the room-name step only offers rooms matching the player's shape guess.
// false: all rooms are offered, with an optional "Only rooms shaped …" checkbox.
const NAMES_MATCH_SHAPE_GUESS = true;
// Add ?debug to the URL to show the answer under the image while testing.
const DEBUG = new URLSearchParams(location.search).has("debug");

type Step = "shape" | "secrets" | "name" | "reveal";
type DifficultyFilter = Difficulty | "all";

interface RoundResult {
  shot: Screenshot;
  room: Room;
  shape?: Shape;
  secrets?: number;
  nameGuess?: Room;
  points: Points;
}

interface Game {
  mode: "daily" | "classic";
  date: string; // UTC day the game was started (the daily's id)
  difficulty: DifficultyFilter;
  results: RoundResult[];
  round: number;
  step: Step;
}

const app = document.querySelector<HTMLElement>("#app")!;
const hud = document.querySelector<HTMLElement>("#hud")!;

let data: GameData;
let maxSecrets = 0;
let game: Game | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const fmt = (n: number) => n.toLocaleString("en-US");

// Small top-down icon of a room shape (cells of a 2x4 grid).
function shapeIcon(shape: Shape) {
  const cells: Record<Shape, [number, number][]> = {
    "1x1": [[0, 0]],
    "1x2": [[0, 0], [1, 0]],
    "1x3": [[0, 0], [1, 0], [2, 0]],
    "1x4": [[0, 0], [1, 0], [2, 0], [3, 0]],
    "2x2": [[0, 0], [1, 0], [0, 1], [1, 1]],
    L: [[0, 0], [0, 1], [1, 1]],
  };
  const rects = cells[shape]
    .map(([x, y]) => `<rect x="${x * 10 + 1}" y="${y * 10 + 1}" width="8" height="8" rx="1"/>`)
    .join("");
  return `<svg class="shape-icon" viewBox="0 0 40 20" aria-hidden="true">${rects}</svg>`;
}

const roundTotal = (p: Points) => p.shape + p.secrets + p.name;
const gameScore = (g: Game) => g.results.reduce((s, r) => s + roundTotal(r.points), 0);
const gameMax = (g: Game) => g.results.length * MAX_ROUND;

const pool = (difficulty: DifficultyFilter) =>
  difficulty === "all"
    ? data.screenshots
    : data.screenshots.filter((s) => s.difficulty === difficulty);

const toResult = (shot: Screenshot): RoundResult => ({
  shot,
  room: data.roomsById.get(shot.roomId)!,
  points: { shape: 0, secrets: 0, name: 0 },
});

/* ---------- Game setup & persistence ---------- */

function startClassic(difficulty: DifficultyFilter) {
  const shots = shuffle(pool(difficulty)).slice(0, ROUNDS_PER_GAME);
  game = { mode: "classic", date: todayUTC(), difficulty, results: shots.map(toResult), round: 0, step: "shape" };
  render();
}

// The daily picks the same screenshots for everyone, seeded by the UTC date.
// Progress is saved after every answer, so reloading can't be used to retry.
function startDaily() {
  const date = todayUTC();
  const saved = getDaily(date);
  let results: RoundResult[];

  if (saved) {
    results = saved.rounds
      .filter((r) => data.screenshotsById.has(r.shotId))
      .map((r) => {
        const res = toResult(data.screenshotsById.get(r.shotId)!);
        res.shape = r.shape as Shape | undefined;
        res.secrets = r.secrets;
        res.nameGuess = r.nameId ? data.roomsById.get(r.nameId) : undefined;
        res.points = r.points;
        return res;
      });
  } else {
    const rng = mulberry32(hashString(`dungeonguessr-${date}`));
    results = shuffle(data.screenshots, rng).slice(0, ROUNDS_PER_GAME).map(toResult);
  }

  // Resume at the first unfinished step.
  let round = results.findIndex((r) => !r.nameGuess);
  if (round === -1) round = results.length;
  const r = results[round];
  const step: Step = !r ? "reveal" : r.shape === undefined ? "shape" : r.secrets === undefined ? "secrets" : "name";

  game = { mode: "daily", date, difficulty: "all", results, round, step };
  // Every round was answered but the page closed before "See results".
  if (saved && !saved.done && round >= results.length) recordGame(gameScore(game), gameMax(game));
  saveProgress();
  render();
}

function saveProgress() {
  if (!game || game.mode !== "daily") return;
  const rounds: SavedRound[] = game.results.map((r) => ({
    shotId: r.shot.id,
    shape: r.shape,
    secrets: r.secrets,
    nameId: r.nameGuess?.id,
    points: r.points,
  }));
  saveDaily(game.date, {
    rounds,
    done: game.round >= game.results.length,
    score: gameScore(game),
    max: gameMax(game),
  });
}

function nextRound() {
  if (!game) return;
  game.round++;
  game.step = "shape";
  if (game.round >= game.results.length) recordGame(gameScore(game), gameMax(game));
  saveProgress();
  render();
}

/* ---------- Rendering ---------- */

function renderHud() {
  if (!game || game.round >= game.results.length) {
    hud.innerHTML = "";
    return;
  }
  const label = game.mode === "daily" ? "Daily" : game.difficulty === "all" ? "Classic" : cap(game.difficulty);
  hud.innerHTML = `
    <span class="tag">${label}</span>
    <span>Round <b>${game.round + 1}</b>/${game.results.length}</span>
    <span>Score <b>${fmt(gameScore(game))}</b></span>`;
}

function render() {
  renderHud();
  if (!game) return renderMenu();
  if (game.round >= game.results.length) return renderSummary(game);

  const r = game.results[game.round];
  app.innerHTML = `
    <section class="game">
      <figure class="shot">
        <button class="shot-btn" id="zoom" title="View full size">
          <img src="${asset(r.shot.image)}" alt="Dungeon screenshot" />
        </button>
        ${r.shot.difficulty ? `<span class="badge ${r.shot.difficulty}">${cap(r.shot.difficulty)}</span>` : ""}
        ${DEBUG ? `<figcaption class="debug">${esc(r.room.name)} · ${r.room.shape} · ${r.room.secrets} secrets</figcaption>` : ""}
      </figure>
      <aside class="panel">
        ${renderDone(r)}
        <div id="step"></div>
      </aside>
    </section>`;
  app.querySelector("#zoom")!.addEventListener("click", () => openLightbox(asset(r.shot.image)));

  // Preload the next image so the next round appears instantly.
  const next = game.results[game.round + 1];
  if (next) new Image().src = asset(next.shot.image);

  const el = app.querySelector<HTMLElement>("#step")!;
  ({ shape: stepShape, secrets: stepSecrets, name: stepName, reveal: stepReveal })[game.step](el, r);
}

// Lines for the steps already answered in this round.
function renderDone(r: RoundResult) {
  const line = (label: string, guess: string, answer: string, pts: number, max: number) => `
    <div class="done ${pts === max ? "ok" : pts > 0 ? "close" : "bad"}">
      <span class="label">${label}</span>
      <span>${esc(guess)}${pts === max ? "" : ` <small>→ ${esc(answer)}</small>`}</span>
      <span class="pts">+${fmt(pts)}</span>
    </div>`;
  let html = "";
  if (r.shape) html += line("Shape", r.shape, r.room.shape, r.points.shape, MAX_POINTS.shape);
  if (r.secrets !== undefined) html += line("Secrets", String(r.secrets), String(r.room.secrets), r.points.secrets, MAX_POINTS.secrets);
  if (r.nameGuess) html += line("Room", r.nameGuess.name, r.room.name, r.points.name, MAX_POINTS.name);
  return html;
}

function answer(update: () => void, next: Step) {
  update();
  game!.step = next;
  saveProgress();
  render();
}

function stepShape(el: HTMLElement, r: RoundResult) {
  el.innerHTML = `
    <h2>1. What shape is this room?</h2>
    <div class="grid shapes">
      ${SHAPES.map((s, i) => `<button data-shape="${s}" title="Key ${i + 1}">${shapeIcon(s)}<span>${s}</span></button>`).join("")}
    </div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-shape]").forEach((b) =>
    b.addEventListener("click", () =>
      answer(() => {
        r.shape = b.dataset.shape as Shape;
        r.points.shape = scoreShape(r.shape, r.room.shape);
      }, "secrets"),
    ),
  );
}

function stepSecrets(el: HTMLElement, r: RoundResult) {
  const nums = Array.from({ length: maxSecrets + 1 }, (_, i) => i);
  el.innerHTML = `
    <h2>2. How many secrets does it have?</h2>
    <div class="grid secrets">
      ${nums.map((n) => `<button data-n="${n}">${n}</button>`).join("")}
    </div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-n]").forEach((b) =>
    b.addEventListener("click", () =>
      answer(() => {
        r.secrets = Number(b.dataset.n);
        r.points.secrets = scoreSecrets(r.secrets, r.room.secrets);
      }, "name"),
    ),
  );
}

function stepName(el: HTMLElement, r: RoundResult) {
  el.innerHTML = `
    <h2>3. Which room is it?</h2>
    <input id="name" type="text" placeholder="Type a room name…" autocomplete="off" spellcheck="false" />
    ${NAMES_MATCH_SHAPE_GUESS
      ? `<p class="toggle">Showing ${r.shape} rooms only</p>`
      : `<label class="toggle"><input id="filter" type="checkbox" /> Only rooms shaped ${r.shape}</label>`}
    <ul id="suggest" class="suggest"></ul>`;
  const input = el.querySelector<HTMLInputElement>("#name")!;
  const filter = el.querySelector<HTMLInputElement>("#filter");
  const list = el.querySelector<HTMLUListElement>("#suggest")!;
  if (filter) filter.checked = getPrefs().filterByShape;
  const onlyShape = () => NAMES_MATCH_SHAPE_GUESS || filter!.checked;

  let matches: Room[] = [];
  const update = () => {
    const q = input.value.trim().toLowerCase();
    matches = data.guessableRooms.filter(
      (room) =>
        (!onlyShape() || room.shape === r.shape) &&
        room.name.toLowerCase().includes(q),
    );
    list.innerHTML = matches
      .slice(0, 50)
      .map((room, i) => `<li><button data-i="${i}">${esc(room.name)} <small>${room.shape}</small></button></li>`)
      .join("") || `<li class="empty">No matching rooms</li>`;
  };
  const choose = (room: Room) =>
    answer(() => {
      r.nameGuess = room;
      r.points.name = scoreName(room.id, r.room.id);
    }, "reveal");

  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !matches.length) return;
    // Stop this Enter press from also activating the "Next round" button,
    // which receives focus once the reveal renders.
    e.preventDefault();
    choose(matches[0]);
  });
  filter?.addEventListener("change", () => {
    setPrefs({ filterByShape: filter.checked });
    update();
  });
  list.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-i]");
    if (b) choose(matches[Number(b.dataset.i)]);
  });
  update();
  input.focus();
}

function stepReveal(el: HTMLElement, r: RoundResult) {
  const last = game!.round === game!.results.length - 1;
  el.innerHTML = `
    <div class="reveal">
      <p class="answer">${esc(r.room.name)}</p>
      <p class="meta">${shapeIcon(r.room.shape)} ${r.room.shape} · ${r.room.secrets} secret${r.room.secrets === 1 ? "" : "s"}</p>
      <p class="round-pts">${fmt(roundTotal(r.points))} / ${fmt(MAX_ROUND)}</p>
      <button id="next" class="primary">${last ? "See results" : "Next round"}</button>
    </div>`;
  const next = el.querySelector<HTMLButtonElement>("#next")!;
  next.addEventListener("click", nextRound);
  next.focus();
}

function renderSummary(g: Game) {
  const score = gameScore(g);
  const max = gameMax(g);
  const title = g.mode === "daily" ? `DungeonGuessr Daily ${g.date}` : "DungeonGuessr";
  const streak = g.mode === "daily" ? getStreaks(todayUTC()).current : 0;
  app.innerHTML = `
    <section class="summary">
      <h2>${g.mode === "daily" ? `Daily challenge · ${g.date}` : "Final score"}</h2>
      <p class="big">${fmt(score)} <small>/ ${fmt(max)}</small></p>
      ${streak ? `<p class="streak">🔥 ${streak}-day streak</p>` : ""}
      <table>
        <thead><tr><th>#</th><th>Room</th><th>Shape</th><th>Secrets</th><th>Name</th><th>Total</th></tr></thead>
        <tbody>
          ${g.results.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${esc(r.room.name)}</td>
              <td>${fmt(r.points.shape)}</td>
              <td>${fmt(r.points.secrets)}</td>
              <td>${fmt(r.points.name)}</td>
              <td><b>${fmt(roundTotal(r.points))}</b></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="actions">
        <button id="share">Share result</button>
        ${g.mode === "classic" ? `<button id="again" class="primary">Play again</button>` : ""}
        <button id="menu" class="${g.mode === "daily" ? "primary" : ""}">Menu</button>
      </div>
    </section>`;

  const share = app.querySelector<HTMLButtonElement>("#share")!;
  share.addEventListener("click", async () => {
    const ok = await copyText(shareText(title, score, max, g.results.map((r) => r.points)));
    share.textContent = ok ? "Copied!" : "Copy failed";
    setTimeout(() => (share.textContent = "Share result"), 1500);
  });
  app.querySelector("#again")?.addEventListener("click", () => startClassic(g.difficulty));
  app.querySelector("#menu")!.addEventListener("click", showMenu);
}

function renderMenu() {
  const today = todayUTC();
  const daily = getDaily(today);
  const { current, best } = getStreaks(today);
  const stats = getStats();
  const prefs = getPrefs();
  let difficulty = (["all", ...DIFFICULTIES] as string[]).includes(prefs.difficulty)
    ? (prefs.difficulty as DifficultyFilter)
    : "all";
  const count = (d: DifficultyFilter) => pool(d).length;

  const dailyBody = daily?.done
    ? `<p class="result">Today: <b>${fmt(daily.score)}</b> / ${fmt(daily.max)}</p>
       <button id="daily" class="primary">View result</button>`
    : `<button id="daily" class="primary">${daily ? "Continue" : "Play daily"}</button>`;

  app.innerHTML = `
    <section class="menu">
      <div class="card">
        <h2>Daily challenge</h2>
        <p class="muted">Everyone gets the same ${Math.min(ROUNDS_PER_GAME, data.screenshots.length)} screenshots today. One attempt, resets at 00:00 UTC.</p>
        ${dailyBody}
        <p class="streak">🔥 Streak <b>${current}</b> · Best <b>${best}</b></p>
      </div>
      <div class="card">
        <h2>Classic</h2>
        <p class="muted">${ROUNDS_PER_GAME} random screenshots. Play as often as you like.</p>
        <div class="segmented" role="radiogroup" aria-label="Difficulty">
          ${(["all", ...DIFFICULTIES] as DifficultyFilter[]).map((d) => `
            <button role="radio" data-d="${d}" ${count(d) ? "" : "disabled"}>
              ${d === "all" ? "Any" : cap(d)} <small>${count(d)}</small>
            </button>`).join("")}
        </div>
        <button id="classic" class="primary">Play</button>
      </div>
      <div class="card stats">
        <h2>Your stats</h2>
        <dl>
          <div><dt>Games</dt><dd>${stats.played}</dd></div>
          <div><dt>Best</dt><dd>${fmt(stats.best)}</dd></div>
          <div><dt>Average</dt><dd>${stats.played ? Math.round((stats.totalScore / stats.totalMax) * 100) : 0}%</dd></div>
        </dl>
      </div>
      <details class="card how">
        <summary>How to play</summary>
        <p>Each round shows a screenshot taken inside a Hypixel SkyBlock dungeon room. Guess in three steps:</p>
        <ol>
          <li><b>Shape</b> of the room (1x1, 1x2, 1x3, 1x4, 2x2 or L): ${fmt(MAX_POINTS.shape)} pts. Keys 1–6 work too.</li>
          <li><b>Secrets</b> in the room: ${fmt(MAX_POINTS.secrets)} pts if exact, 600 if off by one, 300 if off by two.</li>
          <li><b>Room name</b>: ${fmt(MAX_POINTS.name)} pts.</li>
        </ol>
        <p>Click the screenshot to view it full size.</p>
      </details>
    </section>`;

  const segs = app.querySelectorAll<HTMLButtonElement>("[data-d]");
  const sync = () => segs.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.d === difficulty)));
  if (!count(difficulty)) difficulty = "all";
  sync();
  segs.forEach((b) =>
    b.addEventListener("click", () => {
      difficulty = b.dataset.d as DifficultyFilter;
      setPrefs({ difficulty });
      sync();
    }),
  );
  app.querySelector("#daily")!.addEventListener("click", startDaily);
  app.querySelector("#classic")!.addEventListener("click", () => startClassic(difficulty));
}

function showMenu() {
  game = null;
  render();
}

/* ---------- Lightbox & keyboard ---------- */

const lightbox = document.createElement("dialog");
lightbox.className = "lightbox";
lightbox.innerHTML = `<img alt="Dungeon screenshot, full size" />`;
lightbox.addEventListener("click", () => lightbox.close());
document.body.append(lightbox);

function openLightbox(src: string) {
  lightbox.querySelector("img")!.src = src;
  lightbox.showModal();
}

// Number keys pick a shape (1–6) or a secret count (0–9) when not typing.
document.addEventListener("keydown", (e) => {
  if (!game || lightbox.open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest("input, textarea")) return;
  if (!/^\d$/.test(e.key)) return;
  const sel =
    game.step === "shape" ? `[data-shape="${SHAPES[Number(e.key) - 1]}"]`
    : game.step === "secrets" ? `[data-n="${e.key}"]`
    : null;
  if (sel) app.querySelector<HTMLButtonElement>(sel)?.click();
});

document.querySelector("#home")!.addEventListener("click", (e) => {
  e.preventDefault();
  showMenu();
});

async function init() {
  try {
    data = await loadData();
  } catch (err) {
    app.innerHTML = `<p class="error">Could not load game data: ${esc(String(err))}</p>`;
    return;
  }
  if (!data.screenshots.length) {
    app.innerHTML = `<p class="error">No screenshots available yet.</p>`;
    return;
  }
  maxSecrets = Math.max(...data.guessableRooms.map((r) => r.secrets));
  render();
}

init();
