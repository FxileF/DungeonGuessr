// Converts the original screenshots in screenshots-src/ into web-friendly WebP
// files with neutral names in public/screenshots/, and rebuilds
// public/data/screenshots.json.
//
// Source file names: RoomName-Number-Difficulty.png  (e.g. PurpleFlags-2-Medium.png)
//   - RoomName: room name without spaces, any case. Unknown names can be mapped
//     in scripts/room-aliases.json.
//   - Difficulty: easy, medium or hard.
//
// Usage: npm run import-screenshots

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = new URL("../", import.meta.url);
const SRC = new URL("screenshots-src/", ROOT);
const OUT = new URL("public/screenshots/", ROOT);
const MANIFEST = new URL("public/data/screenshots.json", ROOT);
const MAX_WIDTH = 1600;
const QUALITY = 80;

const rooms = JSON.parse(await readFile(new URL("public/data/rooms.json", ROOT), "utf8"));
const aliases = JSON.parse(await readFile(new URL("room-aliases.json", import.meta.url), "utf8"));

const key = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const roomsByKey = new Map(rooms.map((r) => [key(r.name), r]));

function findRoom(name) {
  const k = key(name);
  if (k in aliases) return aliases[k] ? rooms.find((r) => r.id === aliases[k]) ?? null : null;
  return roomsByKey.get(k) ?? null;
}

function parseDifficulty(s) {
  const d = s.toLowerCase();
  // Tolerates typos like "Eeasy".
  if (d.includes("easy")) return "easy";
  if (d.includes("med")) return "medium";
  if (d.includes("hard")) return "hard";
  return null;
}

await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
const shots = [];
const produced = new Set();
let converted = 0;

for (const file of files) {
  const base = file.replace(/\.[^.]+$/, "");
  const match = base.match(/^(.+?)-(\d+)-([A-Za-z]+)$/);
  if (!match) {
    console.warn(`SKIP ${file}: name is not RoomName-Number-Difficulty`);
    continue;
  }
  const [, roomName, , diff] = match;
  const k = key(roomName);
  const room = findRoom(roomName);
  if (!room) {
    console.warn(
      k in aliases
        ? `SKIP ${file}: "${roomName}" is set to null in room-aliases.json`
        : `SKIP ${file}: no room named "${roomName}" (add it to scripts/room-aliases.json)`,
    );
    continue;
  }
  const difficulty = parseDifficulty(diff);
  if (!difficulty) console.warn(`WARN ${file}: unknown difficulty "${diff}"`);

  // Neutral, stable name so players can't read the answer from the file name.
  const id = createHash("sha256").update(base.toLowerCase()).digest("hex").slice(0, 12);
  const outName = `${id}.webp`;
  const outFile = new URL(outName, OUT);
  produced.add(outName);

  const srcStat = await stat(new URL(file, SRC));
  const outStat = await stat(outFile).catch(() => null);
  if (!outStat || outStat.mtimeMs < srcStat.mtimeMs) {
    await sharp(fileURLToPath(new URL(file, SRC)))
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(fileURLToPath(outFile));
    converted++;
  }
  shots.push({ id, image: `screenshots/${outName}`, roomId: room.id, difficulty });
}

// Remove images whose source no longer exists.
for (const f of await readdir(OUT)) {
  if (!produced.has(f)) {
    await rm(new URL(f, OUT));
    console.log(`Removed stale ${f}`);
  }
}

// Sort by id so the manifest order doesn't hint at the room.
shots.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(MANIFEST, JSON.stringify(shots, null, 2) + "\n");
console.log(`${shots.length} screenshots in manifest (${converted} converted).`);
