import "./style.css";
import {
  DIFFICULTIES, SHAPES, asset, loadData,
  type Difficulty, type GameData, type Room, type Screenshot, type Shape,
} from "./data";
import { hashString, mulberry32, shuffle, todayUTC } from "./random";
import {
  MAX_POINTS, MAX_ROUND, RANKS, rankThreshold, scoreName, scoreRank, scoreSecrets, scoreShape,
  type Rank,
} from "./scoring";
import { copyText, shareText } from "./share";
import {
  getDaily, getPrefs, getStats, getStreaks, recordGame, saveDaily, setPrefs,
  type Points, type SavedRound,
} from "./storage";

const ROUNDS_PER_GAME = 5;
// true: the room-name step only lists rooms with the room's real shape, which
// is revealed once the shape is answered. false: all rooms are listed, with an
// optional "Only … rooms" checkbox.
const NAMES_MATCH_SHAPE = true;
// Add ?debug to the URL to show the answer on the image while testing.
const DEBUG = new URLSearchParams(location.search).has("debug");

type Step = "shape" | "secrets" | "name" | "reveal";
type StepState = "locked" | "active" | "done";
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
  includePuzzles: boolean;
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
const grade = (pts: number, max: number) => (pts === max ? "ok" : pts > 0 ? "close" : "bad");

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

// Mort's head: public/mort.png if it exists, otherwise the drawn public/mort.svg.
const mortImg = (cls = "") =>
  `<img src="${asset("mort.png")}" alt="" class="${cls}"
    onerror="this.onerror=null;this.src='${asset("mort.svg")}'" />`;

const roundTotal = (p: Points) => p.shape + p.secrets + p.name;
const gameScore = (g: Game) => g.results.reduce((s, r) => s + roundTotal(r.points), 0);
const gameMax = (g: Game) => g.results.length * MAX_ROUND;
const isPuzzle = (s: Screenshot) => data.roomsById.get(s.roomId)!.type === "puzzle";

const pool = (difficulty: DifficultyFilter, includePuzzles: boolean) =>
  data.screenshots.filter(
    (s) => (difficulty === "all" || s.difficulty === difficulty) && (includePuzzles || !isPuzzle(s)),
  );

const toResult = (shot: Screenshot): RoundResult => ({
  shot,
  room: data.roomsById.get(shot.roomId)!,
  points: { shape: 0, secrets: 0, name: 0 },
});

/* ---------- Game setup & persistence ---------- */

function startClassic(difficulty: DifficultyFilter, includePuzzles: boolean) {
  const shots = shuffle(pool(difficulty, includePuzzles)).slice(0, ROUNDS_PER_GAME);
  game = {
    mode: "classic", date: todayUTC(), difficulty, includePuzzles,
    results: shots.map(toResult), round: 0, step: "shape",
  };
  render();
}

// The daily picks the same screenshots for everyone, seeded by the UTC date,
// and always includes puzzle rooms. Progress is saved after every answer, so
// reloading can't be used to retry.
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

  game = { mode: "daily", date, difficulty: "all", includePuzzles: true, results, round, step };
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
      <div class="stage">
        <button class="shot-btn" id="zoom" title="View full size">
          <img src="${asset(r.shot.image)}" alt="Dungeon screenshot" />
        </button>
        ${r.shot.difficulty ? `<span class="badge ${r.shot.difficulty}">${cap(r.shot.difficulty)}</span>` : ""}
        ${DEBUG ? `<span class="debug">${esc(r.room.name)} · ${r.room.shape} · ${r.room.secrets}</span>` : ""}
        <div class="mort" id="mort" aria-hidden="true">
          <span class="bubble"></span>
          ${mortImg()}
        </div>
        <div class="banner" id="banner" hidden></div>
      </div>
      <div class="steps" id="steps"></div>
    </section>`;
  app.querySelector("#zoom")!.addEventListener("click", () => openLightbox(asset(r.shot.image)));

  // Preload the next image so the next round appears instantly.
  const next = game.results[game.round + 1];
  if (next) new Image().src = asset(next.shot.image);

  renderSteps();
}

// The three step columns are always visible: answered ones show the result,
// the current one is highlighted, later ones are greyed out.
function renderSteps() {
  const g = game!;
  const r = g.results[g.round];
  const order: Step[] = ["shape", "secrets", "name"];
  const current = g.step === "reveal" ? order.length : order.indexOf(g.step);
  const state = (s: Step): StepState => {
    const i = order.indexOf(s);
    return i < current ? "done" : i === current ? "active" : "locked";
  };

  const steps = app.querySelector<HTMLElement>("#steps")!;
  steps.innerHTML = colShape(r, state("shape")) + colSecrets(r, state("secrets")) + colName(r, state("name"));

  if (g.step === "shape") bindShape(r);
  if (g.step === "secrets") bindSecrets(r);
  if (g.step === "name") bindName(r);
  renderBanner(r);
}

function colHeader(n: number, title: string, state: StepState, pts: number, max: number) {
  return `
    <header>
      <span class="num">${state === "done" ? "✓" : n}</span>
      <h3>${title}</h3>
      ${state === "done" ? `<span class="col-pts ${grade(pts, max)}">+${fmt(pts)}</span>` : ""}
    </header>`;
}

// Class for an option once its step is answered: the right answer is green,
// the player's wrong pick red (or yellow if it still earned points).
function optClass(state: StepState, value: unknown, answer: unknown, picked: unknown, pts: number) {
  if (state !== "done") return "";
  const classes = [];
  if (value === answer) classes.push("correct");
  else if (value === picked) classes.push(pts > 0 ? "close" : "wrong");
  if (value === picked) classes.push("picked");
  return classes.join(" ");
}

function colShape(r: RoundResult, state: StepState) {
  const btns = SHAPES.map((s, i) => `
    <button class="opt ${optClass(state, s, r.room.shape, r.shape, r.points.shape)}" data-shape="${s}"
      ${state === "active" ? "" : "disabled"}>
      ${shapeIcon(s)}<span>${s}</span>${state === "active" ? `<kbd>${i + 1}</kbd>` : ""}
    </button>`).join("");
  return `
    <div class="col ${state}">
      ${colHeader(1, "Shape", state, r.points.shape, MAX_POINTS.shape)}
      <div class="opts shapes">${btns}</div>
    </div>`;
}

function colSecrets(r: RoundResult, state: StepState) {
  const btns = Array.from({ length: maxSecrets + 1 }, (_, n) => `
    <button class="opt ${optClass(state, n, r.room.secrets, r.secrets, r.points.secrets)}" data-n="${n}"
      ${state === "active" ? "" : "disabled"}>${n}</button>`).join("");
  return `
    <div class="col ${state}">
      ${colHeader(2, "Secrets", state, r.points.secrets, MAX_POINTS.secrets)}
      <div class="opts secrets">${btns}</div>
    </div>`;
}

function colName(r: RoundResult, state: StepState) {
  let body: string;
  if (state === "locked") {
    body = `
      <input type="text" placeholder="Answer shape &amp; secrets first" disabled />
      <ul class="names"><li class="hint">The room list unlocks after the first two steps.</li></ul>`;
  } else if (state === "active") {
    body = `
      <input id="name" type="text" placeholder="Type a room name…" autocomplete="off" spellcheck="false" />
      ${NAMES_MATCH_SHAPE
        ? `<p class="note">Showing ${r.room.shape} rooms</p>`
        : `<label class="note"><input id="filter" type="checkbox" /> Only ${r.room.shape} rooms</label>`}
      <ul class="names" id="names"></ul>`;
  } else {
    const picked = r.nameGuess!;
    const ok = picked.id === r.room.id;
    body = `
      <ul class="names">
        <li><span class="opt name picked ${ok ? "correct" : "wrong"}">${esc(picked.name)} <small>your guess</small></span></li>
        ${ok ? "" : `<li><span class="opt name correct">${esc(r.room.name)} <small>answer</small></span></li>`}
      </ul>`;
  }
  return `
    <div class="col col-name ${state}">
      ${colHeader(3, "Room", state, r.points.name, MAX_POINTS.name)}
      ${body}
    </div>`;
}

function answer(update: () => void, next: Step) {
  update();
  game!.step = next;
  saveProgress();
  renderHud();
  renderSteps();
}

function bindShape(r: RoundResult) {
  app.querySelectorAll<HTMLButtonElement>("[data-shape]").forEach((b) =>
    b.addEventListener("click", () =>
      answer(() => {
        r.shape = b.dataset.shape as Shape;
        r.points.shape = scoreShape(r.shape, r.room.shape);
      }, "secrets"),
    ),
  );
}

function bindSecrets(r: RoundResult) {
  app.querySelectorAll<HTMLButtonElement>("[data-n]").forEach((b) =>
    b.addEventListener("click", () =>
      answer(() => {
        r.secrets = Number(b.dataset.n);
        r.points.secrets = scoreSecrets(r.secrets, r.room.secrets);
      }, "name"),
    ),
  );
}

function bindName(r: RoundResult) {
  const input = app.querySelector<HTMLInputElement>("#name")!;
  const filter = app.querySelector<HTMLInputElement>("#filter");
  const list = app.querySelector<HTMLUListElement>("#names")!;
  if (filter) filter.checked = getPrefs().filterByShape;
  const onlyShape = () => NAMES_MATCH_SHAPE || filter!.checked;
  const choices = data.guessableRooms.filter((room) => game!.includePuzzles || room.type !== "puzzle");

  let matches: Room[] = [];
  const update = () => {
    const q = input.value.trim().toLowerCase();
    matches = choices.filter(
      (room) => (!onlyShape() || room.shape === r.room.shape) && room.name.toLowerCase().includes(q),
    );
    list.innerHTML = matches
      .map((room, i) => `<li><button class="opt name" data-i="${i}">${esc(room.name)}</button></li>`)
      .join("") || `<li class="hint">No matching rooms</li>`;
  };
  const choose = (room: Room) => {
    answer(() => {
      r.nameGuess = room;
      r.points.name = scoreName(room.id, r.room.id);
    }, "reveal");
    if (room.id === r.room.id) cheer(roundTotal(r.points) === MAX_ROUND ? "Perfect!" : "Nice one!");
  };

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
  input.focus({ preventScroll: true });
}

// Result bar over the bottom of the screenshot once the round is answered.
function renderBanner(r: RoundResult) {
  const banner = app.querySelector<HTMLElement>("#banner")!;
  if (game!.step !== "reveal") {
    banner.hidden = true;
    return;
  }
  const last = game!.round === game!.results.length - 1;
  const total = roundTotal(r.points);
  banner.innerHTML = `
    <div class="banner-room">
      <span class="label">The room was</span>
      <strong>${esc(r.room.name)}</strong>
      <span class="meta">${shapeIcon(r.room.shape)} ${r.room.shape} · ${r.room.secrets} secret${r.room.secrets === 1 ? "" : "s"}</span>
    </div>
    <div class="banner-score ${grade(total, MAX_ROUND)}">
      <strong>${fmt(total)}</strong><span>/ ${fmt(MAX_ROUND)}</span>
    </div>
    <button id="next" class="primary">${last ? "See results" : "Next round"} →</button>`;
  banner.hidden = false;
  const next = banner.querySelector<HTMLButtonElement>("#next")!;
  next.addEventListener("click", nextRound);
  next.focus({ preventScroll: true });
}

// Mort pops up from the bottom of the screenshot with a speech bubble.
function cheer(text: string) {
  const mort = app.querySelector<HTMLElement>("#mort");
  if (!mort) return;
  mort.querySelector(".bubble")!.textContent = text;
  mort.classList.remove("show");
  void mort.offsetWidth; // restart the animation
  mort.classList.add("show");
}

const rankClass = (rank: Rank) => rank.replace("+", "plus").toLowerCase();
// "+" isn't safe in URLs (some servers read it as a space), so S+ is "S_Plus".
const rankImage = (rank: Rank) => asset(`Dungeon_Ranking_${rank.replace("+", "_Plus")}.webp`);
// The emblems are drawn with 5px "pixels"; 0.4 shows them at a crisp 2px.
const RANK_IMG_SCALE = 0.4;

// Rank emblem on the results screen; the letter is a fallback if the image fails.
function rankBadge(rank: Rank) {
  return `
    <div class="rank rank-${rankClass(rank)}" title="Dungeon rank ${rank}">
      <span class="rank-art" style="--img: url('${rankImage(rank)}')">
        <img class="rank-img" src="${rankImage(rank)}" alt="Rank ${rank}" />
      </span>
      <span class="rank-letter">${rank}</span>
    </div>`;
}

function showRankBadge() {
  const badge = app.querySelector<HTMLElement>(".rank");
  const img = badge?.querySelector<HTMLImageElement>(".rank-img");
  if (!badge || !img) return;
  const show = () => {
    img.style.width = `${Math.round(img.naturalWidth * RANK_IMG_SCALE)}px`;
    badge.classList.add("in");
  };
  if (img.complete && img.naturalWidth) show();
  else {
    img.addEventListener("load", show);
    img.addEventListener("error", () => badge.classList.add("no-img", "in"));
  }
}

// "x more points for <next rank>" under the score.
function rankHint(rank: Rank, score: number, max: number) {
  const i = RANKS.findIndex((r) => r.rank === rank);
  if (i === 0) return `<p class="rank-hint">Flawless run!</p>`;
  const next = RANKS[i - 1];
  const need = rankThreshold(next.min, max) - score;
  return `<p class="rank-hint">${fmt(need)} more points for <b>${next.rank}</b></p>`;
}

function renderSummary(g: Game) {
  const score = gameScore(g);
  const max = gameMax(g);
  const rank = scoreRank(score, max);
  const title = `${g.mode === "daily" ? `DungeonGuessr Daily ${g.date}` : "DungeonGuessr"} · ${rank}`;
  const streak = g.mode === "daily" ? getStreaks(todayUTC()).current : 0;
  const cell = (pts: number, m: number) => `<td><span class="chip ${grade(pts, m)}">${fmt(pts)}</span></td>`;
  app.innerHTML = `
    <section class="summary card">
      <h2>${g.mode === "daily" ? `Daily challenge · ${g.date}` : "Final score"}</h2>
      ${rankBadge(rank)}
      <p class="big">${fmt(score)} <small>/ ${fmt(max)}</small></p>
      ${rankHint(rank, score, max)}
      ${streak ? `<p class="streak">🔥 ${streak}-day streak</p>` : ""}
      <table>
        <thead><tr><th>#</th><th>Room</th><th>Shape</th><th>Secrets</th><th>Name</th><th>Total</th></tr></thead>
        <tbody>
          ${g.results.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td class="room">${esc(r.room.name)}</td>
              ${cell(r.points.shape, MAX_POINTS.shape)}
              ${cell(r.points.secrets, MAX_POINTS.secrets)}
              ${cell(r.points.name, MAX_POINTS.name)}
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

  showRankBadge();
  const share = app.querySelector<HTMLButtonElement>("#share")!;
  share.addEventListener("click", async () => {
    const ok = await copyText(shareText(title, score, max, g.results.map((r) => r.points)));
    share.textContent = ok ? "Copied!" : "Copy failed";
    setTimeout(() => (share.textContent = "Share result"), 1500);
  });
  app.querySelector("#again")?.addEventListener("click", () => startClassic(g.difficulty, g.includePuzzles));
  app.querySelector("#menu")!.addEventListener("click", showMenu);
}

function renderMenu() {
  const today = todayUTC();
  const daily = getDaily(today);
  const { current, best } = getStreaks(today);
  const stats = getStats();
  const prefs = getPrefs();
  const filters = ["all", ...DIFFICULTIES] as DifficultyFilter[];
  let difficulty: DifficultyFilter = (filters as string[]).includes(prefs.difficulty)
    ? (prefs.difficulty as DifficultyFilter)
    : "all";
  let includePuzzles = prefs.includePuzzles;

  const dailyBody = daily?.done
    ? `<p class="result">
         <img class="rank-icon" src="${rankImage(scoreRank(daily.score, daily.max))}" alt="Rank ${scoreRank(daily.score, daily.max)}" />
         <span>Today: <b>${fmt(daily.score)}</b> / ${fmt(daily.max)}</span>
       </p>
       <button id="daily" class="primary">View result</button>`
    : `<button id="daily" class="primary">${daily ? "Continue" : "Play daily"}</button>`;

  app.innerHTML = `
    <section class="hero">
      ${mortImg("hero-mort")}
      <div>
        <h2>Where in the dungeon are you?</h2>
        <p class="muted">Guess the room's shape, its secret count, then its name.</p>
      </div>
    </section>
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
        <div class="segmented" role="radiogroup" aria-label="Difficulty"></div>
        <label class="check"><input type="checkbox" id="puzzles" /> Include puzzle rooms</label>
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
        <p>Each round shows a screenshot taken inside a Hypixel SkyBlock dungeon room. Answer from left to right:</p>
        <ol>
          <li><b>Shape</b> (1x1, 1x2, 1x3, 1x4, 2x2 or L): ${fmt(MAX_POINTS.shape)} pts. Wrong shapes still score by size: same number of tiles 600, one tile off 400, two off 150. Keys 1–6.</li>
          <li><b>Secrets</b>: ${fmt(MAX_POINTS.secrets)} pts if exact, 600 if off by one, 300 if off by two. Keys 0–9.</li>
          <li><b>Room name</b>: ${fmt(MAX_POINTS.name)} pts. Only rooms of the right shape are listed.</li>
        </ol>
        <p>At the end you get a dungeon rank:
          ${RANKS.map((r) => `<b>${r.rank}</b> ${r.min ? `${fmt(rankThreshold(r.min, ROUNDS_PER_GAME * MAX_ROUND))}+` : "below"}`).join(" · ")}.</p>
        <p>Click the screenshot to view it full size.</p>
      </details>
    </section>`;

  const seg = app.querySelector<HTMLElement>(".segmented")!;
  const puzzles = app.querySelector<HTMLInputElement>("#puzzles")!;
  const play = app.querySelector<HTMLButtonElement>("#classic")!;
  puzzles.checked = includePuzzles;

  // Re-drawn when the puzzle toggle changes, since the counts depend on it.
  const drawSegments = () => {
    const count = (d: DifficultyFilter) => pool(d, includePuzzles).length;
    if (!count(difficulty)) difficulty = "all";
    seg.innerHTML = filters.map((d) => `
      <button role="radio" data-d="${d}" aria-checked="${d === difficulty}" ${count(d) ? "" : "disabled"}>
        ${d === "all" ? "Any" : cap(d)} <small>${count(d)}</small>
      </button>`).join("");
    play.disabled = !count(difficulty);
  };
  seg.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-d]");
    if (!b || b.disabled) return;
    difficulty = b.dataset.d as DifficultyFilter;
    setPrefs({ difficulty });
    drawSegments();
  });
  puzzles.addEventListener("change", () => {
    includePuzzles = puzzles.checked;
    setPrefs({ includePuzzles });
    drawSegments();
  });
  drawSegments();

  app.querySelector("#daily")!.addEventListener("click", startDaily);
  play.addEventListener("click", () => startClassic(difficulty, includePuzzles));
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
