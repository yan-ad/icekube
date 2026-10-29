import { expect, test } from "@playwright/test";
import { formatAge } from "../src/app/cluster/formatAge";

const now = Date.parse("2026-10-29T12:00:00Z");
const minute = 60;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;

for (const [seconds, expected] of [
  [0, "0s"], [0.999, "0s"], [1, "1s"], [59, "59s"],
  [minute, "1m"], [59 * minute + 59, "59m"],
  [hour, "1h"], [hour + minute, "1h 1m"], [day - 1, "23h 59m"],
  [day, "1d"], [day + hour, "1d 1h"], [week - 1, "6d 23h 59m"],
  [week, "1w"], [week + minute, "1w 1m"],
  [2 * week + 3 * day + 2 * hour + 4 * minute, "2w 3d 2h 4m"],
  [2 * week + 3 * day + 2 * hour + 4 * minute + 59, "2w 3d 2h 4m"],
  [474 * day, "67w 5d"], [857 * day, "122w 3d"],
] as const) {
  test(`formats ${seconds} seconds as ${expected}`, () => {
    const timestamp = now - seconds * 1000;
    expect(formatAge(new Date(timestamp).toISOString(), now)).toBe(expected);
    expect(formatAge(timestamp, now)).toBe(expected);
  });
}

test("missing, invalid and future timestamps remain unavailable", () => {
  for (const timestamp of [null, undefined, "", "invalid", NaN, Infinity, -Infinity, now + 1, new Date(now + 1000).toISOString()]) {
    expect(formatAge(timestamp, now)).toBeNull();
  }
  expect(formatAge(now, NaN)).toBeNull();
});

test("uses the current time by default", () => {
  expect(formatAge(new Date(Date.now() - (2 * week + 3 * day + 2 * hour + 4 * minute) * 1000).toISOString())).toBe("2w 3d 2h 4m");
});
