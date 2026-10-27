import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { catalogError, catalogRequest, hasCatalogEngine, loadCatalogConnectionStates, openSavedWebLink, type CatalogCommand, type CatalogSnapshot, type ClusterConnectionStatus } from "./api";
import type { ConnectionSnapshot, SessionRequest } from "../cluster/api";

export type RuntimeConnectionStatus = ClusterConnectionStatus | "disconnecting" | "unknown";

type CatalogState = {
  snapshot: CatalogSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  available: boolean;
  run: (command: CatalogCommand, request?: Record<string, unknown>) => Promise<boolean>;
  openWebLink: (id: string) => Promise<boolean>;
  connectionStates: Record<string, RuntimeConnectionStatus>;
  observeConnection: (snapshot: ConnectionSnapshot) => void;
  releaseConnection: (request: SessionRequest, release: () => Promise<void>) => Promise<void>;
  refreshConnectionStates: () => Promise<void>;
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
  const [connectionStates, setConnectionStates] = useState<Record<string, RuntimeConnectionStatus>>({});
  const lease = useRef<{ clusterId: string; sessionId: string; status: RuntimeConnectionStatus } | null>(null);
  const runtimeGeneration = useRef(0);
  const statusRead = useRef(false);
  const observeConnection = useCallback((next: ConnectionSnapshot) => {
    runtimeGeneration.current++;
    const previous = lease.current;
    lease.current = { clusterId: next.clusterId, sessionId: next.sessionId, status: next.status };
    if (mounted.current) setConnectionStates(current => ({ ...current,
      ...(previous && previous.clusterId !== next.clusterId ? { [previous.clusterId]: "disconnected" as const } : {}),
      [next.clusterId]: next.status,
    }));
  }, []);
  const releaseConnection = useCallback(async (request: SessionRequest, release: () => Promise<void>) => {
    const current = lease.current;
    const owns = current?.clusterId === request.clusterId && current.sessionId === request.sessionId;
    if (owns) {
      runtimeGeneration.current++;
      current.status = "disconnecting";
      if (mounted.current) setConnectionStates(states => ({ ...states, [request.clusterId]: "disconnecting" }));
    }
    try {
      await release();
      if (owns && lease.current === current) {
        runtimeGeneration.current++;
        current.status = "disconnected";
        if (mounted.current) setConnectionStates(states => ({ ...states, [request.clusterId]: "disconnected" }));
      }
    } catch (error) {
      if (owns && lease.current === current) {
        runtimeGeneration.current++;
        current.status = "unknown";
        if (mounted.current) setConnectionStates(states => ({ ...states, [request.clusterId]: "unknown" }));
      }
      throw error;
    }
  }, []);
  const refreshConnectionStates = useCallback(async () => {
    if (!available || statusRead.current) return;
    statusRead.current = true;
    const generation = runtimeGeneration.current;
    try {
      const states = await loadCatalogConnectionStates();
      if (mounted.current && generation === runtimeGeneration.current) {
        runtimeGeneration.current++;
        setConnectionStates(current => Object.fromEntries([
          ...Object.keys(current).map(id => [id, "disconnected"]),
          ...states.map(state => [state.clusterId, state.status]),
        ]));
      }
    } catch {
      if (mounted.current && generation === runtimeGeneration.current) {
        runtimeGeneration.current++;
        setConnectionStates(current => Object.fromEntries(
          Object.entries(current).map(([id, status]) => [id, status === "disconnected" ? status : "unknown"]),
        ));
      }
    } finally { statusRead.current = false; }
  }, [available]);

  const perform = useCallback(async (operation: () => Promise<CatalogSnapshot | void>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    const current = ++generation.current;
    const connectionGeneration = runtimeGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (!mounted.current || current !== generation.current) return false;
      if (result) {
        setSnapshot((previous) => previous && previous.revision > result.revision ? previous : result);
        setConnectionStates(current => {
          const newerRuntime = connectionGeneration !== runtimeGeneration.current;
          const next = Object.fromEntries(result.clusters.map(cluster => [cluster.id,
            newerRuntime ? current[cluster.id] ?? "disconnected" : cluster.status,
          ])) as Record<string, RuntimeConnectionStatus>;
          const active = lease.current;
          if (active && Object.prototype.hasOwnProperty.call(next, active.clusterId)
            && (active.status !== "disconnected" || connectionGeneration !== runtimeGeneration.current)) next[active.clusterId] = current[active.clusterId] ?? active.status;
          return next;
        });
      }
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

  return <CatalogContext value={{ snapshot, loading, busy, error, available, run, openWebLink, connectionStates, observeConnection, releaseConnection, refreshConnectionStates }}>{children}</CatalogContext>;
}
export function useCatalog() {
  const state = useContext(CatalogContext);
  if (!state) throw new Error("CatalogProvider is required");
  return state;
}
