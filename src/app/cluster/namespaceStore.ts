import { createStore } from "zustand/vanilla";
import { cancelResources, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceRequest, type SessionRequest } from "./api";
import type { PermissionDecision } from "./permissionsApi";

export const NAMESPACE_LIMIT = 1_000;
export const validNamespace = (value: string) => value.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);

type Access = { decision: PermissionDecision; loading: boolean; epoch: string | null };
type NamespaceState = {
  namespaces: string[];
  loading: boolean;
  error: ConnectionErrorCode | null;
  partial: boolean;
  loaded: boolean;
  subscribers: number;
  subscribeSelector: () => () => void;
  setAccess: (access: Access) => void;
  refresh: () => void;
  retry: () => void;
};
type Dependencies = { load: typeof loadResources; cancel: typeof cancelResources };

// One ephemeral store per connected lease. Page subscriptions do not own its request.
export function createNamespaceStore(scope: SessionRequest, dependencies: Dependencies = { load: loadResources, cancel: cancelResources }) {
  let access: Access = { decision: "unknown", loading: true, epoch: null };
  let explicitRead = false;
  let generation = 0;
  let pending: ResourceRequest | null = null;
  let owners = 0;
  let disposed = false;
  const cancel = () => {
    generation++;
    if (pending) void dependencies.cancel(pending).catch(() => {});
    pending = null;
  };
  const store = createStore<NamespaceState>()((set, get) => {
    const ensure = () => {
      if (disposed || access.loading || access.decision === "denied" || access.decision === "unknown" && !explicitRead
        || !get().subscribers || get().loaded || pending) return;
      const current = generation;
      set({ loading: true, error: null });
      const read = async () => {
        const names = new Set<string>();
        const tokens = new Set<string>();
        let token: string | null = null;
        let incomplete = false;
        do {
          const request: ResourceRequest = { ...scope, kind: "namespaces", readId: nextReadId(), continueToken: token };
          pending = request;
          const page = await dependencies.load(request);
          if (disposed || generation !== current) return;
          pending = null;
          for (const item of page.items) {
            if (!validNamespace(item.name) || names.has(item.name)) throw "invalidResponse";
            names.add(item.name);
          }
          token = page.continueToken;
          if (token && tokens.has(token)) throw "invalidResponse";
          if (token) tokens.add(token);
          incomplete = page.truncated || token !== null;
          if (names.size >= NAMESPACE_LIMIT || tokens.size >= NAMESPACE_LIMIT / 100) break;
        } while (token);
        if (generation === current && !disposed) {
          set({ namespaces: [...names].sort((left, right) => left.localeCompare(right)), partial: incomplete, loaded: true });
        }
      };
      void read().catch(reason => {
        if (generation === current && !disposed) set({ error: errorCode(reason), loaded: true });
      }).finally(() => {
        if (generation === current && !disposed) { pending = null; set({ loading: false }); }
      });
    };
    const invalidate = () => {
      cancel();
      set({ namespaces: [], partial: false, error: null, loaded: false, loading: access.loading || access.decision === "allowed" || explicitRead });
      ensure();
    };
    return {
      namespaces: [], loading: true, error: null, partial: false, loaded: false, subscribers: 0,
      subscribeSelector: () => {
        let subscribed = true;
        set(state => ({ subscribers: state.subscribers + 1 }));
        ensure();
        return () => {
          if (!subscribed) return;
          subscribed = false;
          set(state => ({ subscribers: state.subscribers - 1 }));
        };
      },
      setAccess: next => {
        const epochChanged = access.epoch !== null && next.epoch !== access.epoch;
        const revoked = !next.loading && access.decision !== "denied" && next.decision === "denied";
        access = next;
        if (epochChanged || revoked) { explicitRead = false; invalidate(); }
        if (!next.loading && next.decision !== "allowed" && !pending) set({ loading: false });
        ensure();
      },
      refresh: invalidate,
      retry: () => { explicitRead = true; invalidate(); },
    };
  });
  return {
    store,
    retain: () => {
      owners++;
      disposed = false;
      return () => {
        owners--;
        // React Strict Mode releases and immediately reacquires this same lease.
        queueMicrotask(() => {
          if (owners) return;
          disposed = true;
          cancel();
          store.setState({ namespaces: [], partial: false, error: null, loaded: false, loading: true });
        });
      };
    },
  };
}
