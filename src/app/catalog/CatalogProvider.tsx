import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { catalogError, catalogRequest, hasCatalogEngine, openSavedWebLink, type CatalogCommand, type CatalogSnapshot } from "./api";

type CatalogState = {
  snapshot: CatalogSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  available: boolean;
  run: (command: CatalogCommand, request?: Record<string, unknown>) => Promise<boolean>;
  openWebLink: (id: string) => Promise<boolean>;
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

  const perform = useCallback(async (operation: () => Promise<CatalogSnapshot | void>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (!mounted.current || current !== generation.current) return false;
      if (result) setSnapshot((previous) => previous && previous.revision > result.revision ? previous : result);
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
  const run = useCallback((command: CatalogCommand, request?: Record<string, unknown>) => perform(() => catalogRequest(command, request)), [perform]);
  const openWebLink = useCallback((id: string) => perform(() => openSavedWebLink(id)), [perform]);

  useEffect(() => {
    mounted.current = true;
    void run("catalog_list");
    return () => {
      mounted.current = false;
      generation.current++;
      inFlight.current = false;
    };
  }, [run]);

  return <CatalogContext value={{ snapshot, loading, busy, error, available, run, openWebLink }}>{children}</CatalogContext>;
}
export function useCatalog() {
  const state = useContext(CatalogContext);
  if (!state) throw new Error("CatalogProvider is required");
  return state;
}
