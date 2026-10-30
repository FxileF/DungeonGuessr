// Converts the original screenshots in screenshots-src/ into web-friendly WebP
// files with neutral names in public/screenshots/, and rebuilds
// public/data/screenshots.json.
//
// Source file names: RoomName-Number-Difficulty.png  (e.g. PurpleFlags-2-Medium.png)
//   - RoomName: room name without spaces, any case. Unknown names can be mapped
//     in scripts/room-aliases.json.
//   - Difficulty: easy, medium or hard, or "Unlabeled" (playable, no difficulty).
//
// Subfolders are read too (e.g. screenshots-src/auto/ for shots from the capture
// mod). A RoomName-Number-Difficulty.json next to an image (written by the mod)
// adds where the shot was taken to the manifest.
//
// Usage: npm run import-screenshots

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadRooms } from "./lib/rooms.mjs";

const ROOT = new URL("../", import.meta.url);
const SRC = new URL("screenshots-src/", ROOT);
const OUT = new URL("public/screenshots/", ROOT);
const MANIFEST = new URL("public/data/screenshots.json", ROOT);
const MAX_WIDTH = 1600;
const QUALITY = 80;

const roomLookup = await loadRooms();

// "easy" | "medium" | "hard", null for shots not labelled yet ("Unlabeled"),
// undefined if unreadable.
function parseDifficulty(s) {
  const d = s.toLowerCase();
  if (d === "unlabeled") return null;
  // Tolerates typos like "Eeasy".
  if (d.includes("easy")) return "easy";
  if (d.includes("med")) return "medium";
  if (d.includes("hard")) return "hard";
  return undefined;
}

// The capture mod's sidecar JSON, or null.
async function readMeta(jsonUrl) {
  const text = await readFile(jsonUrl, "utf8").catch(() => null);
  return text && JSON.parse(text);
}

// Where the shot was taken, from the sidecar JSON, or undefined.
function poseOf(meta) {
  if (!meta) return undefined;
  const { min, max } = meta.roomBounds;
  return {
    block: meta.blockInRoom,
    roomSize: max.map((v, i) => v - min[i] + 1),
    yaw: meta.camera.yaw,
    pitch: meta.camera.pitch,
    fov: meta.camera.fov,
  };
}

await mkdir(OUT, { recursive: true });
// Paths relative to SRC, with "/" separators.
const files = (await readdir(SRC, { recursive: true }))
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  .sort();
const shots = [];
const produced = new Set();
let converted = 0;

for (const file of files) {
  const rel = file.replace(/\.[^.]+$/, "");
  const base = rel.split("/").pop();
  const match = base.match(/^(.+?)-(\d+)-([A-Za-z]+)$/);
  if (!match) {
    console.warn(`SKIP ${file}: name is not RoomName-Number-Difficulty`);
    continue;
  }
  const [, roomName, , diff] = match;
  const meta = await readMeta(new URL(`${rel}.json`, SRC));
  const room = roomLookup.find(roomName, meta?.secrets);
  if (!room) {
    console.warn(
      roomLookup.isAliasedToNull(roomName, meta?.secrets)
        ? `SKIP ${file}: "${roomName}" is set to null in room-aliases.json`
        : `SKIP ${file}: no room named "${roomName}" (add it to scripts/room-aliases.json)`,
    );
    continue;
  }
  let difficulty = parseDifficulty(diff);
  if (difficulty === undefined) {
    console.warn(`WARN ${file}: unknown difficulty "${diff}"`);
    difficulty = null;
  }

  // Neutral, stable name so players can't read the answer from the file name.
  // Top-level files hash just their name (keeps existing URLs); files in
  // subfolders hash their path, so the same name in two folders can't collide.
  const id = createHash("sha256").update(rel.toLowerCase()).digest("hex").slice(0, 12);
  const outName = `${id}.webp`;
  const outFile = new URL(outName, OUT);
  if (produced.has(outName)) {
    console.warn(`SKIP ${file}: same name as another screenshot`);
    continue;
  }
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
  const pose = poseOf(meta);
  shots.push({ id, image: `screenshots/${outName}`, roomId: room.id, difficulty, ...(pose && { pose }) });
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
