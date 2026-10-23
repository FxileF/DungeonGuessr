// Downloads the dungeon room database from the Odin mod (BSD-3-Clause,
// https://github.com/odtheking/Odin) and converts it to public/data/rooms.json.
//
// Usage: npm run update-rooms

import { writeFile } from "node:fs/promises";

const SOURCE =
  "https://raw.githubusercontent.com/odtheking/Odin/main/src/main/resources/assets/odin/rooms.json";
const OUT = new URL("../public/data/rooms.json", import.meta.url);

// Room types players can be asked to guess. Blood, entrance, fairy, trap and
// champion (miniboss) rooms are too recognisable or lack secret data.
const GUESSABLE_TYPES = new Set(["normal", "rare", "puzzle"]);

const slug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Failed to download ${SOURCE}: ${res.status}`);
const odin = await res.json();

const rooms = odin
  .map((r) => {
    const type = r.type.toLowerCase();
    return {
      id: slug(r.name),
      name: r.name,
      type,
      shape: r.shape,
      secrets: r.maxSecrets ?? 0,
      crypts: r.crypts ?? 0,
      guessable: GUESSABLE_TYPES.has(type),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const ids = new Set();
for (const r of rooms) {
  if (ids.has(r.id)) throw new Error(`Duplicate room id: ${r.id}`);
  ids.add(r.id);
}

await writeFile(OUT, JSON.stringify(rooms, null, 2) + "\n");
console.log(
  `Wrote ${rooms.length} rooms (${rooms.filter((r) => r.guessable).length} guessable) to ${OUT.pathname}`,
);
