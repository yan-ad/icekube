import { createStore } from "zustand/vanilla";
import { cancelResources, errorCode, loadResources, nextReadId, type ConnectionErrorCode, type ResourceRequest, type SessionRequest } from "./api";
import { loadNamespaceCache, refreshNamespaceSnapshot, parseNamespaceSnapshot, NAMESPACE_LIMIT, validNamespace } from "./namespaceCacheApi";
import type { PermissionDecision } from "./permissionsApi";

export { NAMESPACE_LIMIT, validNamespace } from "./namespaceCacheApi";
type Access = { decision: PermissionDecision; loading: boolean; epoch: string | null };
type NamespaceState = {
  namespaces: string[];
  loading: boolean;
  error: ConnectionErrorCode | null;
  partial: boolean;
  loaded: boolean;
  cached: boolean;
  subscribers: number;
  subscribeSelector: () => () => void;
  setAccess: (access: Access) => void;
  refresh: () => void;
  retry: () => void;
};
type Dependencies = {
  load?: typeof loadResources;
  cancel?: typeof cancelResources;
  loadCache?: typeof loadNamespaceCache;
  refreshSnapshot?: typeof refreshNamespaceSnapshot;
};

// One ephemeral store per connected lease. Page subscriptions do not own its request.
export function createNamespaceStore(scope: SessionRequest & { contextName?: string }, dependencies: Dependencies = {}) {
  const requestScope = { clusterId: scope.clusterId, sessionId: scope.sessionId };
  // Injected resource readers keep the paginated test/legacy path without default IPC.
  const loadCache = dependencies.loadCache ?? (dependencies.load ? undefined : loadNamespaceCache);
  const refreshSnapshot = dependencies.refreshSnapshot ?? (dependencies.load ? undefined : refreshNamespaceSnapshot);
  const load = dependencies.load ?? loadResources;
  let access: Access = { decision: "unknown", loading: true, epoch: null };
  let explicitRead = false;
  let generation = 0;
  let boundary = 0;
  let liveVersion = 0;
  let hasSnapshot = false;
  let hydrationStarted = false;
  let pending: ResourceRequest | null = null;
  let owners = 0;
  let disposed = false;
  let activate = () => {};
  const cancel = () => {
    generation++;
    if (pending) void (dependencies.cancel ?? cancelResources)(pending).catch(() => {});
    pending = null;
  };
  const store = createStore<NamespaceState>()((set, get) => {
    const hydrate = () => {
      if (!loadCache || hydrationStarted || disposed || access.decision === "denied") return;
      hydrationStarted = true;
      const currentBoundary = boundary, currentLive = liveVersion;
      void loadCache(requestScope).then(value => {
        if (value === null || disposed || boundary !== currentBoundary || liveVersion !== currentLive || access.decision === "denied") return;
        const snapshot = parseNamespaceSnapshot(value, requestScope);
        hasSnapshot = true;
        set({ namespaces: snapshot.names, partial: snapshot.partial, cached: true });
      }).catch(() => {});
    };
    const ensure = () => {
      if (disposed || access.loading || access.decision === "denied" || access.decision === "unknown" && !explicitRead
        || !get().subscribers || get().loaded || pending) return;
      const current = generation;
      set({ loading: true, error: null });
      const read = async () => {
        if (refreshSnapshot) {
          const request: ResourceRequest = { ...requestScope, kind: "namespaces", readId: nextReadId(), continueToken: null };
          pending = request;
          const value = await refreshSnapshot({ ...requestScope, readId: request.readId });
          if (disposed || generation !== current) return;
          const snapshot = parseNamespaceSnapshot(value, requestScope);
          liveVersion++;
          hasSnapshot = true;
          set({ namespaces: snapshot.names, partial: snapshot.partial, loaded: true, cached: false });
          return;
        }
        const names = new Set<string>();
        const tokens = new Set<string>();
        let token: string | null = null;
        let incomplete = false;
        do {
          const request: ResourceRequest = { ...requestScope, kind: "namespaces", readId: nextReadId(), continueToken: token };
          pending = request;
          const page = await load(request);
          if (disposed || generation !== current) return;
          pending = null;
          for (const item of page.items) {
            if (!validNamespace(item.name) || names.has(item.name) || names.size >= NAMESPACE_LIMIT) throw "invalidResponse";
            names.add(item.name);
          }
          token = page.continueToken;
          if (token && tokens.has(token)) throw "invalidResponse";
          if (token) tokens.add(token);
          incomplete = page.truncated || token !== null;
          if (names.size >= NAMESPACE_LIMIT || tokens.size >= NAMESPACE_LIMIT / 100) break;
        } while (token);
        if (generation === current && !disposed) {
          liveVersion++;
          hasSnapshot = true;
          set({ namespaces: [...names].sort((left, right) => left.localeCompare(right)), partial: incomplete, loaded: true, cached: false });
        }
      };
      void read().catch(reason => {
        if (generation !== current || disposed) return;
        const error = errorCode(reason);
        if (error === "permissionDenied") {
          boundary++;
          hasSnapshot = false;
          set({ namespaces: [], partial: false, cached: false });
        }
        set({ error, loaded: true });
      }).finally(() => {
        if (generation === current && !disposed) { pending = null; set({ loading: false }); }
      });
    };
    activate = () => { hydrate(); ensure(); };
    const clear = () => {
      boundary++;
      hydrationStarted = true;
      hasSnapshot = false;
      cancel();
      set({ namespaces: [], partial: false, error: null, loaded: false, cached: false, loading: access.loading || access.decision === "allowed" });
    };
    const refresh = () => {
      if (access.decision === "unknown" && hasSnapshot) explicitRead = true;
      cancel();
      set({ error: null, loaded: false, cached: hasSnapshot,
        loading: access.loading || access.decision === "allowed" || explicitRead && access.decision !== "denied" });
      ensure();
    };
    return {
      namespaces: [], loading: true, error: null, partial: false, loaded: false, cached: false, subscribers: 0,
      subscribeSelector: () => {
        let subscribed = true;
        set(state => ({ subscribers: state.subscribers + 1 }));
        activate();
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
        if (epochChanged || revoked) { explicitRead = false; clear(); }
        if (!next.loading && next.decision !== "allowed" && !pending) set({ loading: false });
        ensure();
      },
      refresh,
      retry: () => { explicitRead = true; refresh(); },
    };
  });
  return {
    store,
    retain: () => {
      owners++;
      disposed = false;
      activate();
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
        owners--;
        // React Strict Mode releases and immediately reacquires this same lease.
        queueMicrotask(() => {
          if (owners) return;
          disposed = true;
          boundary++;
          hydrationStarted = false;
          hasSnapshot = false;
          explicitRead = false;
          cancel();
          store.setState({ namespaces: [], partial: false, error: null, loaded: false, cached: false, loading: true });
        });
      };
    },
  };
}
