import { useEffect, useRef, useState } from "react";

const transientErrors = new Set(["timeout", "network", "busy", "connectionFailed"]);
export function refreshDelay(interval: number, failures: number) {
  return Math.min(60_000, interval * 2 ** Math.min(failures, 6));
}
export function canRefreshDocument() {
  const blocked = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"]')]
    .some(element => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"], [hidden]'));
  return document.visibilityState === "visible" && document.hasFocus() && navigator.onLine && !blocked
    && !(document.activeElement instanceof HTMLElement && (document.activeElement.matches("input, textarea, select") || document.activeElement.isContentEditable));
}

/** Schedules bounded IPC reads only. The owning effect cancels its exact read on disposal. */
export function useAutoRefresh({ scope, interval, busy, paused = false, refresh }: {
  scope: string; interval: number; busy: boolean; paused?: boolean; refresh: () => void;
}) {
  const background = useRef(false);
  const failures = useRef(0);
  const stopped = useRef(false);
  const retryAt = useRef(0);
  const delivery = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [completion, setCompletion] = useState(0);
  const latest = useRef({ busy, paused, refresh });
  latest.current = { busy, paused, refresh };
  useEffect(() => {
    failures.current = 0; stopped.current = false; background.current = false; retryAt.current = 0;
    return () => clearTimeout(delivery.current);
  }, [scope]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const schedule = () => { clearTimeout(timer); if (!disposed) timer = setTimeout(run, refreshDelay(interval, failures.current)); };
    const run = () => {
      if (disposed) return;
      if (stopped.current || Date.now() < retryAt.current || background.current || latest.current.busy || latest.current.paused || !canRefreshDocument()) { schedule(); return; }
      background.current = true;
      latest.current.refresh();
    };
    const resume = () => { if (canRefreshDocument()) run(); };
    schedule();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener("focus", resume); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [scope, interval, busy, paused, completion]);
  return { background, deliver: (apply: () => void) => {
    clearTimeout(delivery.current);
    const attempt = () => {
      if (background.current && !canRefreshDocument()) { delivery.current = setTimeout(attempt, 250); return; }
      apply();
    };
    attempt();
  }, complete: (reason?: unknown) => {
    background.current = false;
    if (reason) { failures.current += 1; stopped.current = !transientErrors.has(String(reason)); }
    else { failures.current = 0; stopped.current = false; }
    retryAt.current = reason ? Date.now() + refreshDelay(interval, failures.current) : 0;
    setCompletion(value => value + 1);
  } };
}

// Request IDs and fetch times change even when the inventory does not.
export function sameInventory<T extends { items: unknown[]; truncated: boolean }>(previous: T | null, next: T) {
  if (!previous) return false;
  const content = (page: T) => ({ ...page, readId: undefined, fetchedAt: undefined });
  return JSON.stringify(content(previous)) === JSON.stringify(content(next));
}
