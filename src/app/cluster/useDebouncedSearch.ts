import { useEffect, useState } from "react";

/** Keep input urgent while resource reads wait for a quiet typing interval. */
export function useDebouncedSearch<T>(draft: T, delay = 175) {
  const [committed, setCommitted] = useState(draft);
  const pending = !Object.is(draft, committed);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setCommitted(() => draft), delay);
    return () => window.clearTimeout(timer);
  }, [draft, delay, pending]);
  return { committed, pending };
}
