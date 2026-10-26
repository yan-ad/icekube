import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { hasUpdateEngine, readUpdateState, restartUpdate, updateError, type UpdateSnapshot } from "./api";

type UpdateState = { snapshot: UpdateSnapshot | null; busy: boolean; error: string | null; restart: () => Promise<void> };
const UpdateContext = createContext<UpdateState | null>(null);
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restarting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!hasUpdateEngine()) return () => { mounted.current = false; };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // This polls a local snapshot only. Checks/downloads and their cadence belong to Rust.
    const poll = async () => {
      try {
        const next = await readUpdateState();
        if (!disposed && !restarting.current) { setSnapshot(next); setError(next.error ? updateError(next.error) : null); }
      } catch { if (!disposed) setError(updateError("invalidResponse")); }
      if (!disposed) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { disposed = true; mounted.current = false; clearTimeout(timer); };
  }, []);
  const restart = useCallback(async () => {
    if (restarting.current || snapshot?.phase !== "ready") return;
    restarting.current = true;
    setBusy(true); setError(null);
    try { await restartUpdate(); }
    catch (reason) {
      if (mounted.current) { setError(updateError(reason)); setBusy(false); }
      restarting.current = false;
    }
  }, [snapshot]);
  return <UpdateContext value={{ snapshot, busy, error, restart }}>{children}</UpdateContext>;
}
export function useUpdates() {
  const context = useContext(UpdateContext);
  if (!context) throw new Error("UpdateProvider is required");
  return context;
}
