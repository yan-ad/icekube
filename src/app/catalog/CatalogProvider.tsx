import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { catalogError, catalogRequest, hasCatalogEngine, type CatalogCommand, type CatalogSnapshot } from "./api";

type CatalogState = {
  snapshot: CatalogSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  available: boolean;
  run: (command: CatalogCommand, request?: Record<string, unknown>) => Promise<boolean>;
};
const CatalogContext = createContext<CatalogState | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const available = hasCatalogEngine();

  const run = useCallback(async (command: CatalogCommand, request?: Record<string, unknown>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await catalogRequest(command, request);
      if (!mounted.current || current !== generation.current) return false;
      setSnapshot((previous) => previous && previous.revision > result.revision ? previous : result);
      return true;
    } catch (reason) {
      if (mounted.current && current === generation.current) setError(catalogError(reason));
      return false;
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        if (mounted.current) { setBusy(false); setLoading(false); }
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void run("catalog_list");
    return () => {
      mounted.current = false;
      generation.current++;
      inFlight.current = false;
    };
  }, [run]);

  return <CatalogContext value={{ snapshot, loading, busy, error, available, run }}>{children}</CatalogContext>;
}
export function useCatalog() {
  const state = useContext(CatalogContext);
  if (!state) throw new Error("CatalogProvider is required");
  return state;
}
