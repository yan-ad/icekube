const units = [
  [7 * 24 * 60, "w"],
  [24 * 60, "d"],
  [60, "h"],
  [1, "m"],
] as const;

export function formatAge(timestamp: string | number | null | undefined, now = Date.now()): string | null {
  if (timestamp == null || timestamp === "") return null;
  const elapsed = now - (typeof timestamp === "number" ? timestamp : Date.parse(timestamp));
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;

  let minutes = Math.floor(seconds / 60);
  const parts: string[] = [];
  for (const [size, suffix] of units) {
    const amount = Math.floor(minutes / size);
    if (amount > 0) parts.push(`${amount}${suffix}`);
    minutes %= size;
  }
  return parts.join(" ");
}
