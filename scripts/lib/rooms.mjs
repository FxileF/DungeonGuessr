// Room lookup by the name used in screenshot file names (any case, no spaces),
// shared by import-screenshots.mjs and review-captures.mjs.

import { readFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);

export const roomKey = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function loadRooms() {
  const rooms = JSON.parse(await readFile(new URL("public/data/rooms.json", ROOT), "utf8"));
  const aliases = JSON.parse(await readFile(new URL("scripts/room-aliases.json", ROOT), "utf8"));
  const byKey = new Map(rooms.map((r) => [roomKey(r.name), r]));

  return {
    rooms,
    aliases,
    // The room for a file-name room name, or null (unknown, or aliased to null).
    // With the secret count (from the mod's JSON), "NAME-SECRETS" aliases win,
    // for server worlds that share a name (Waterfall-2 and Waterfall-8).
    find(name, secrets) {
      const k = aliasKey(name, secrets);
      if (k in aliases) return aliases[k] ? rooms.find((r) => r.id === aliases[k]) ?? null : null;
      return byKey.get(k) ?? null;
    },
    isAliasedToNull: (name, secrets) => aliases[aliasKey(name, secrets)] === null,
  };

  function aliasKey(name, secrets) {
    const k = roomKey(name);
    return secrets != null && `${k}-${secrets}` in aliases ? `${k}-${secrets}` : k;
  }
}
