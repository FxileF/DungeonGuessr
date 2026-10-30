// Lists the route-recorder server's room worlds that don't match a room in
// public/data/rooms.json, with likely candidates, so they can be mapped in
// scripts/room-aliases.json.
//
// Usage: npm run check-rooms -- "<server folder>/polar_worlds"
//
// World names look like "Mithril-Cave-10" (10 = secret count). The capture mod
// names screenshots after the part before the number ("MithrilCave"), which is
// also the alias key, in capitals: "MITHRILCAVE".

import { readdir } from "node:fs/promises";
import { loadRooms, roomKey } from "./lib/rooms.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: npm run check-rooms -- "<server folder>/polar_worlds"');
  process.exit(1);
}

// Same parsing as the mod's RoomName.java.
function parseWorld(world) {
  const m = world.match(/^(.*?)-(\d+)(?:-(.+))?$/);
  if (!m) return { world, name: world, key: roomKey(world), secrets: null };
  return { world, name: m[1] + (m[3] ?? ""), key: roomKey(m[1] + (m[3] ?? "")), secrets: Number(m[2]) };
}

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function similarity(world, room) {
  const a = world.key, b = roomKey(room.name);
  let score = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  if (a.includes(b) || b.includes(a)) score += 0.3;
  if (world.secrets != null && world.secrets === room.secrets) score += 0.3;
  return score;
}

const lookup = await loadRooms();
const worlds = (await readdir(dir))
  .filter((f) => f.endsWith(".polar"))
  .map((f) => parseWorld(f.replace(/\.polar$/, "")))
  .sort((a, b) => a.world.localeCompare(b.world));

const matched = [], unmatched = [], skipped = [];
for (const w of worlds) {
  if (lookup.isAliasedToNull(w.name, w.secrets)) skipped.push(w);
  else {
    const room = lookup.find(w.name, w.secrets);
    if (room) matched.push({ ...w, room });
    else unmatched.push(w);
  }
}
const matchedIds = new Set(matched.map((m) => m.room.id));
const unusedRooms = lookup.rooms.filter((r) => !matchedIds.has(r.id));

const roomLabel = (r) => `${r.name} (id ${r.id}, ${r.secrets} secrets, ${r.shape}, ${r.type})`;

console.log(`${worlds.length} worlds: ${matched.length} matched, ${unmatched.length} unmatched, ${skipped.length} set to null in room-aliases.json\n`);

console.log("=== Worlds with no matching room ===");
for (const w of unmatched) {
  console.log(`\n${w.world}  →  alias key "${w.key}", ${w.secrets ?? "no"} secrets in the file name`);
  const candidates = unusedRooms
    .map((r) => ({ r, score: similarity(w, r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  for (const { r } of candidates) console.log(`    maybe: ${roomLabel(r)}`);
}

const mismatched = matched.filter((m) => m.secrets != null && m.secrets !== m.room.secrets);
console.log(`\n=== Matched, but secret counts differ (${mismatched.length}) ===`);
for (const m of mismatched) console.log(`${m.world}: file says ${m.secrets}, rooms.json says ${m.room.secrets} (${m.room.name})`);

const missing = unusedRooms.filter((r) => r.guessable);
console.log(`\n=== Quiz rooms with no world on the server (${missing.length}) ===`);
for (const r of missing) console.log(roomLabel(r));

console.log(`\nTo map a world, add "ALIASKEY": "room-id" to scripts/room-aliases.json ("ALIASKEY": null skips it).`);
console.log(`For worlds sharing a name, add the secret count: "ALIASKEY-2": "room-id".`);
