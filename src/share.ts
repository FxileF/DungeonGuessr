import { MAX_POINTS } from "./scoring";
import type { Points } from "./storage";

const square = (pts: number, max: number) => (pts === max ? "🟩" : pts > 0 ? "🟨" : "🟥");

// One row per round: shape, secrets, name.
export const resultGrid = (rounds: Points[]) =>
  rounds
    .map((p) =>
      square(p.shape, MAX_POINTS.shape) +
      square(p.secrets, MAX_POINTS.secrets) +
      square(p.name, MAX_POINTS.name),
    )
    .join("\n");

export function shareText(title: string, score: number, max: number, rounds: Points[]) {
  const url = location.origin + location.pathname;
  return `${title}\n${score.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}\n${resultGrid(rounds)}\n${url}`;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts: fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
