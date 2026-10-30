// Local review tool for the capture mod's screenshots.
//
//   npm run review            then open http://localhost:5174
//   npm run review -- <dir>   to review another captures folder
//
// Shots move between four folders (always as a PNG + JSON pair):
//   pending    capture-mod/run/dungeonguessr-captures/            (what the mod writes)
//   rejected   capture-mod/run/dungeonguessr-captures/rejected/
//   accepted   screenshots-src/auto/                              (published, with a difficulty)
//   unlabeled  screenshots-src/unlabeled/                         (published, no difficulty yet)
// Changing the difficulty renames the pair; giving an unlabeled shot a
// difficulty moves it to accepted. Other subfolders (e.g. old-fov70/) are
// ignored. Only listens on localhost.

import { createServer } from "node:http";
import { readdir, readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { loadRooms } from "./lib/rooms.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.REVIEW_PORT ?? 5174);
const CAPTURES = resolve(process.argv[2] ?? join(ROOT, "capture-mod/run/dungeonguessr-captures"));
// Second argument only for testing: the import step always reads the repo's screenshots-src.
const PUBLISHED = resolve(process.argv[3] ?? join(ROOT, "screenshots-src"));
const DIRS = {
  pending: CAPTURES,
  rejected: join(CAPTURES, "rejected"),
  accepted: join(PUBLISHED, "auto"),
  unlabeled: join(PUBLISHED, "unlabeled"),
};
const DIFFICULTIES = ["Easy", "Medium", "Hard"];
// RoomKey-Number-Difficulty, as written by the mod (or "Unlabeled", by this tool).
const NAME = /^([A-Za-z0-9]+)-(\d+)-(Easy|Medium|Hard|Unlabeled)$/;

// Re-read on every listing, so edits to room-aliases.json show up after Refresh.
let rooms = await loadRooms();
for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true });

async function listShots(status) {
  const files = await readdir(DIRS[status]).catch(() => []);
  const shots = [];
  for (const f of files) {
    const base = f.replace(/\.png$/i, "");
    if (base === f || !NAME.test(base)) continue;
    shots.push(await describe(status, base));
  }
  return shots;
}

async function describe(status, base) {
  const [, roomName, number, difficulty] = base.match(NAME);
  const meta = JSON.parse(await readFile(join(DIRS[status], `${base}.json`), "utf8").catch(() => "null"));
  const room = rooms.find(roomName, meta?.secrets);
  const issues = [];
  if (!meta) issues.push("No JSON next to the image");
  if (!room) {
    issues.push(rooms.isAliasedToNull(roomName, meta?.secrets) ? "Room is skipped in room-aliases.json" : `No room named "${roomName}" in rooms.json`);
  } else {
    if (meta?.secrets != null && meta.secrets !== room.secrets)
      issues.push(`Secrets differ: server file says ${meta.secrets}, rooms.json says ${room.secrets}`);
    if (!room.guessable) issues.push(`Room type "${room.type}" isn't used in the quiz`);
  }
  return {
    status,
    base,
    roomName,
    number: Number(number),
    difficulty,
    guess: meta?.difficultyGuess ?? difficulty,
    room: room && { id: room.id, name: room.name, shape: room.shape, secrets: room.secrets, type: room.type },
    meta,
    issues,
  };
}

// Moves/renames a shot's PNG + JSON. Keeps its number unless that number is
// taken in the target folder by another shot of the same room.
async function updateShot(status, base, { difficulty, to }) {
  const [, roomName, number, oldDifficulty] = base.match(NAME);
  const jsonPath = join(DIRS[status], `${base}.json`);
  const meta = JSON.parse(await readFile(jsonPath, "utf8").catch(() => "null"));

  // Labelling a published unlabeled shot makes it a normal accepted one.
  const target = to ?? (status === "unlabeled" && difficulty ? "accepted" : status);
  // Only the unlabeled folder holds "Unlabeled" shots; leaving it brings back
  // the mod's guess unless a difficulty was picked.
  const guess = meta?.difficultyGuess ?? (oldDifficulty === "Unlabeled" ? "Medium" : oldDifficulty);
  const newDifficulty =
    target === "unlabeled" ? "Unlabeled" : difficulty ?? (oldDifficulty === "Unlabeled" ? guess : oldDifficulty);

  const taken = new Set(
    (await readdir(DIRS[target]))
      .map((f) => f.match(/^([A-Za-z0-9]+)-(\d+)-\w+\.(png|json)$/))
      .filter((m) => m && m[1] === roomName && !(target === status && `${m[1]}-${m[2]}` === `${roomName}-${number}`))
      .map((m) => Number(m[2])),
  );
  let n = Number(number);
  if (taken.has(n)) n = Math.max(...taken) + 1;
  const newBase = `${roomName}-${n}-${newDifficulty}`;

  if (meta) {
    // Keep the mod's guess, to compare with manual labels later.
    meta.difficultyGuess ??= meta.difficulty;
    meta.difficulty = newDifficulty;
    meta.shot = n;
    const newJsonPath = join(DIRS[target], `${newBase}.json`);
    await writeFile(newJsonPath, JSON.stringify(meta, null, 2));
    if (newJsonPath !== jsonPath) await rm(jsonPath);
  }
  await rename(join(DIRS[status], `${base}.png`), join(DIRS[target], `${newBase}.png`));
  return describe(target, newBase);
}

const thumbs = new Map();
async function thumbnail(path) {
  const { mtimeMs } = await stat(path);
  const cached = thumbs.get(path);
  if (cached?.mtimeMs === mtimeMs) return cached.data;
  const data = await sharp(path).resize({ width: 360 }).webp({ quality: 70 }).toBuffer();
  thumbs.set(path, { mtimeMs, data });
  return data;
}

function runImport() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(ROOT, "scripts/import-screenshots.mjs")], { cwd: ROOT });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => done({ code, output }));
  });
}

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const [, kind, status, file] = url.pathname.split("/").map(decodeURIComponent);

    if (url.pathname === "/") {
      return send(res, 200, await readFile(join(ROOT, "scripts/review/index.html")), "text/html; charset=utf-8");
    }
    if (url.pathname === "/api/shots") {
      rooms = await loadRooms();
      const all = (await Promise.all(Object.keys(DIRS).map(listShots))).flat();
      return send(res, 200, { captures: CAPTURES, shots: all });
    }
    if ((kind === "img" || kind === "thumb") && status in DIRS && NAME.test(file ?? "")) {
      const path = join(DIRS[status], `${file}.png`);
      if (kind === "thumb") return send(res, 200, await thumbnail(path), "image/webp");
      return send(res, 200, await readFile(path), "image/png");
    }
    if (url.pathname === "/api/update" && req.method === "POST") {
      const { status, base, difficulty, to } = await readBody(req);
      if (!(status in DIRS) || !NAME.test(base ?? "")) return send(res, 400, { error: "Bad shot" });
      if (difficulty && !DIFFICULTIES.includes(difficulty)) return send(res, 400, { error: "Bad difficulty" });
      if (to && !(to in DIRS)) return send(res, 400, { error: "Bad target" });
      if (to === "unlabeled" && difficulty) return send(res, 400, { error: "Unlabeled shots have no difficulty" });
      return send(res, 200, await updateShot(status, base, { difficulty, to }));
    }
    if (url.pathname === "/api/import" && req.method === "POST") {
      return send(res, 200, await runImport());
    }
    // Publishes every pending shot without a difficulty, then imports. Shots
    // with an issue (unknown room, secret mismatch, non-quiz room) stay pending,
    // since their answer may be wrong.
    if (url.pathname === "/api/publish-unlabeled" && req.method === "POST") {
      rooms = await loadRooms();
      const pending = await listShots("pending");
      const ready = pending.filter((s) => !s.issues.length);
      for (const s of ready) await updateShot("pending", s.base, { to: "unlabeled" });
      const kept = [...new Set(pending.filter((s) => s.issues.length).map((s) => s.roomName))];
      return send(res, 200, { moved: ready.length, kept, ...(await runImport()) });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message ?? e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Reviewing ${CAPTURES}`);
  console.log(`Open http://localhost:${PORT}`);
});
