import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built site works both at the domain root and under
  // a sub-path like https://<user>.github.io/DungeonGuessr/ (GitHub Pages).
  base: "./",
});
