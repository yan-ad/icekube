import { useCallback, useSyncExternalStore } from "react";
import { Text } from "@astryxdesign/core/Text";
import { formatAge } from "./formatAge";

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function tick() {
  now = Date.now();
  listeners.forEach(listener => listener());
}

function resume() {
  clearInterval(timer);
  timer = undefined;
  if (document.visibilityState === "hidden") return;
  tick();
  timer = setInterval(tick, 1000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    resume();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    }
  };
}

export function ResourceAge({ timestamp, fallback = "N/A" }: {
  timestamp: string | number | null | undefined;
  fallback?: string;
}) {
  const snapshot = useCallback(() => formatAge(timestamp, now) ?? fallback, [timestamp, fallback]);
  const age = useSyncExternalStore(subscribe, snapshot);
  return <Text hasTabularNumbers style={{ whiteSpace: "nowrap" }}>{age}</Text>;
}
