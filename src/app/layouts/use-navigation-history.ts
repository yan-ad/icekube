import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

const HISTORY_KEY = "icekube.history-limit.v1";

export function useNavigationHistory() {
  const router = useRouter();
  const index = useRouterState({ select: (state) => state.location.state.__TSR_index });
  const [furthestIndex, setFurthestIndex] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem(HISTORY_KEY));
      return Number.isSafeInteger(saved) && saved >= index ? saved : index;
    } catch {
      return index;
    }
  });

  useEffect(() => router.history.subscribe(({ location, action }) => {
    const nextIndex = location.state.__TSR_index;
    setFurthestIndex((previous) => {
      const next = action.type === "PUSH" ? nextIndex : Math.max(previous, nextIndex);
      try {
        sessionStorage.setItem(HISTORY_KEY, String(next));
      } catch {
        // History navigation still works when session storage is unavailable.
      }
      return next;
    });
  }), [router]);

  return {
    canGoBack: index > 0,
    canGoForward: index < furthestIndex,
    back: () => router.history.back(),
    forward: () => router.history.forward(),
  };
}
