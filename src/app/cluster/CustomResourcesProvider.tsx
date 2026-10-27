import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { connectionMessage, errorCode, nextReadId, type ConnectionErrorCode, type SessionRequest } from "./api";
import { cancelCustomRead, loadCustomDefinitions, type CustomDefinition, type CustomRead } from "./customResourcesApi";

const MAX_ITEMS = 1_000;
type Snapshot = SessionRequest & { items: CustomDefinition[]; loading: boolean; error: ConnectionErrorCode | null; partial: boolean; nextToken: string | null; seenTokens: string[] };
const Context = createContext<{
  snapshot: Snapshot | null; publish: (owner: symbol, value: Snapshot) => void; clear: (owner: symbol) => void;
  wanted: string | null; request: (clusterId: string | null) => void; revision: number; refresh: () => void;
  seed: Snapshot | null; loadMore: () => void; canLoadMore: boolean;
} | null>(null);
export function CustomResourcesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ owner: symbol; value: Snapshot } | null>(null);
  const latest = useRef(state);
  const [wanted, request] = useState<string | null>(null);
  const [scan, setScan] = useState<{ revision: number; seed: Snapshot | null }>({ revision: 0, seed: null });
  const pending = useRef(false);
  const publish = useCallback((owner: symbol, value: Snapshot) => {
    latest.current = { owner, value }; pending.current = value.loading; setState({ owner, value });
  }, []);
  const clear = useCallback((owner: symbol) => {
    if (latest.current?.owner === owner) { latest.current = null; pending.current = false; }
    setState(previous => previous?.owner === owner ? null : previous);
  }, []);
  const refresh = useCallback(() => { pending.current = true; setScan(value => ({ revision: value.revision + 1, seed: null })); }, []);
  const loadMore = useCallback(() => {
    const seed = latest.current?.value;
    if (pending.current || !seed?.nextToken || seed.items.length >= MAX_ITEMS || seed.error) return;
    pending.current = true;
    setScan(value => ({ revision: value.revision + 1, seed }));
  }, []);
  const value = useMemo(() => ({ snapshot: state?.value ?? null, publish, clear, wanted, request, ...scan, refresh, loadMore,
    canLoadMore: !!state?.value.nextToken && state.value.items.length < MAX_ITEMS && !state.value.error,
  }), [state, publish, clear, wanted, scan, refresh, loadMore]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCustomResources() {
  const value = useContext(Context);
  if (!value) throw new Error("CustomResourcesProvider is required");
  return value;
}
export function CustomResourcesDiscovery({ clusterId, sessionId, active }: SessionRequest & { active: boolean }) {
  const { publish, clear, wanted, revision, seed } = useCustomResources();
  const enabled = active || wanted === clusterId;
  useEffect(() => {
    const owner = Symbol();
    let disposed = false;
    let request: CustomRead | null = null;
    if (!enabled) return;
    const previous = seed?.clusterId === clusterId && seed.sessionId === sessionId ? seed : null;
    const initial: Snapshot = previous ?? { clusterId, sessionId, items: [], loading: false, error: null, partial: false, nextToken: null, seenTokens: [] };
    publish(owner, { ...initial, loading: true });
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const items = [...initial.items];
      const names = new Map(items.map(item => [item.name, item.uid]));
      const uids = new Set(items.map(item => item.uid));
      const tokens = new Set(initial.seenTokens);
      let token = initial.nextToken;
      let partial = false;
      let overflow = false;
      for (let count = 0; count < 10; count += 1) {
        request = { clusterId, sessionId, readId: nextReadId(), continueToken: token };
        const page = await loadCustomDefinitions({ ...request });
        if (disposed) return;
        for (const item of page.items) {
          if (names.has(item.name)) throw names.get(item.name) === item.uid ? "invalidResponse" : "sourceChanged";
          if (uids.has(item.uid)) throw "invalidResponse";
          uids.add(item.uid);
          names.set(item.name, item.uid);
          if (items.length < MAX_ITEMS) items.push(item);
          else overflow = true;
        }
        token = page.continueToken;
        if (token && tokens.has(token)) throw "invalidResponse";
        if (token) tokens.add(token);
        partial = page.truncated || overflow;
        if (!token || items.length >= MAX_ITEMS) break;
      }
      if (!disposed) publish(owner, { clusterId, sessionId, items: items.sort((a, b) => a.group.localeCompare(b.group) || a.kind.localeCompare(b.kind)), loading: false, error: null, partial: partial || !!token, nextToken: token, seenTokens: [...tokens] });
    };
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject("timeout"), 5_000); });
    void Promise.race([read(), deadline]).catch(reason => {
      if (!disposed) {
        disposed = true;
        if (request) void cancelCustomRead({ ...request }, true).catch(() => {});
        publish(owner, { ...initial, loading: false, error: errorCode(reason) });
      }
    }).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); clear(owner); if (request) void cancelCustomRead({ ...request }, true).catch(() => {}); };
  }, [clusterId, sessionId, enabled, revision, seed, publish, clear]);
  return null;
}
export function customDiscoveryMessage(error: ConnectionErrorCode) { return connectionMessage(error); }
