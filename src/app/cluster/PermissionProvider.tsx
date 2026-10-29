import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ResourceKind, SessionRequest } from "./api";
import { resourceView, resourceViews } from "./resourceViews";
import { cancelPermissionReview, nextReadId, permissionCheck, permissionKey, refreshPermissions, reviewPermissions, validPermissionCheck, type PermissionAction, type PermissionCheck, type PermissionCheckInput, type PermissionDecision, type PermissionReviewRequest } from "./permissionsApi";

type Entry = { decision: PermissionDecision; expiresAt: number; epoch: string | null; used: number };
const MAX_CACHE = 1024;
const MAX_SUBSCRIPTIONS = 1024;
const MAX_SUBSCRIPTION_CHECKS = 256;
const navigationChecks = [{ kind: "nodes" as const, action: "list" as const }, ...resourceViews.flatMap(view => view.kind ? [{ kind: view.kind, action: "list" as const }] : [])];
const navigationKeys = new Set(navigationChecks.map(permissionKey));
/** One queue owns the backend's latest-review slot. Subscribers never cancel each other's shared checks. */
export class PermissionStore {
  private context: SessionRequest | null = null;
  private owner: symbol | null = null;
  private epoch: string | null = null;
  private revision = -1;
  private generation = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private subscriptions = new Map<symbol, PermissionCheck[]>();
  private cache = new Map<string, Entry>();
  // Presentation only: renewal must not briefly reveal a previously denied destination.
  private navigation = new Map<string, boolean>();
  private pending: PermissionReviewRequest | null = null;
  private scheduled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  authorizationEpoch = () => this.epoch;
  get revisionSnapshot() { return this.revision; }
  get versionSnapshot() { return this.version; }
  private emit() { this.version++; this.listeners.forEach(listener => listener()); }
  setContext(context: SessionRequest) {
    const owner = Symbol();
    this.owner = owner;
    this.generation++;
    this.cancel();
    this.context = context;
    this.epoch = null;
    this.revision = -1;
    this.cache.clear();
    this.navigation.clear();
    this.emit(); this.schedule();
    return () => {
      if (this.owner !== owner) return;
      this.generation++; this.cancel(); this.context = null; this.owner = null;
      this.cache.clear(); this.navigation.clear(); this.epoch = null; this.revision = -1; this.emit();
    };
  }
  navigationVisible = (check: PermissionCheckInput, clusterId?: string) => {
    if (!this.context || (clusterId !== undefined && this.context.clusterId !== clusterId)) return false;
    return this.navigation.get(permissionKey(check)) ?? false;
  };
  private cancel() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.pending) void cancelPermissionReview(this.pending).catch(() => {});
    this.pending = null;
  }
  request(checks: PermissionCheck[]) {
    if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) return () => {};
    const unique = [...new Map(checks.map(check => [permissionKey(check), permissionCheck(check)])).values()];
    if (unique.length > MAX_SUBSCRIPTION_CHECKS || !unique.every(validPermissionCheck)) return () => {};
    const needed = new Set([...this.subscriptions.values()].flatMap(subscription => subscription.map(permissionKey)));
    for (const check of unique) needed.add(permissionKey(check));
    if (needed.size > MAX_CACHE) return () => {};
    const id = Symbol(); this.subscriptions.set(id, unique); this.schedule();
    return () => { this.subscriptions.delete(id); this.armExpiry(); this.schedule(); };
  }
  hasSubscription(checks: PermissionCheck[]) { return [...this.subscriptions.values()].some(value => value.length === checks.length && value.every((check, index) => permissionKey(check) === permissionKey(checks[index]))); }
  decision = (check: PermissionCheckInput): PermissionDecision => {
    const entry = this.cache.get(permissionKey(check));
    if (!this.context || !entry || entry.epoch !== this.epoch || entry.expiresAt <= Date.now()) return "unknown";
    entry.used = Date.now(); return entry.decision;
  };
  observed = (check: PermissionCheckInput) => {
    const entry = this.cache.get(permissionKey(check));
    return !!this.context && !!entry && entry.epoch === this.epoch;
  };
  loading(checks: PermissionCheckInput[]) {
    return checks.length > 0 && (!this.context || checks.some(check => { const entry = this.cache.get(permissionKey(check)); return !entry || entry.expiresAt <= Date.now() || entry.epoch !== this.epoch; }));
  }
  fingerprint(checks: readonly PermissionCheckInput[]) { return checks.map(check => `${permissionKey(check)}:${this.decision(check)}`).sort().join("|"); }
  retry = () => {
    if (!this.context) return;
    const generation = ++this.generation;
    this.cancel(); this.cache.clear(); this.emit();
    void refreshPermissions(this.context).catch(() => {}).finally(() => { if (generation === this.generation) this.schedule(); });
  };
  private needed() {
    const checks = new Map<string, PermissionCheck>();
    for (const subscription of this.subscriptions.values()) for (const check of subscription) {
      const key = permissionKey(check), entry = this.cache.get(key);
      if (!entry || entry.expiresAt <= Date.now() || entry.epoch !== this.epoch) checks.set(key, check);
    }
    return [...checks.values()];
  }
  private schedule() { if (this.scheduled) return; this.scheduled = true; queueMicrotask(() => { this.scheduled = false; void this.flush(); }); }
  private async flush() {
    if (!this.context || this.pending) return;
    const checks = this.needed().slice(0, 32);
    if (!checks.length) { this.armExpiry(); return; }
    const generation = this.generation;
    const request = { ...this.context, readId: nextReadId(), checks };
    this.pending = request;
    try {
      const response = await reviewPermissions(request);
      if (generation !== this.generation) return;
      if (this.epoch !== response.authorizationEpoch) { this.cache.clear(); this.navigation.clear(); this.epoch = response.authorizationEpoch; this.revision = -1; }
      if (response.revision < this.revision) throw "invalidResponse";
      this.revision = response.revision;
      for (const item of response.items) {
        const key = permissionKey(item.check);
        this.cache.delete(key);
        this.cache.set(key, { decision: item.decision, epoch: this.epoch, used: Date.now(), expiresAt: Math.min(response.expiresAt, Date.now() + (item.decision === "unknown" ? 5_000 : 60_000)) });
        if (navigationKeys.has(key)) this.navigation.set(key, item.decision === "unknown" ? this.navigation.get(key) ?? true : item.decision === "allowed");
      }
      while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
    } catch {
      if (generation !== this.generation) return;
      for (const check of checks) {
        const key = permissionKey(check);
        this.cache.set(key, { decision: "unknown", epoch: this.epoch, used: Date.now(), expiresAt: Date.now() + 5_000 });
        if (navigationKeys.has(key) && !this.navigation.has(key)) this.navigation.set(key, true);
      }
      while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
    } finally {
      if (generation === this.generation) { this.pending = null; this.emit(); this.schedule(); }
    }
  }
  private armExpiry() {
    clearTimeout(this.timer); this.timer = undefined;
    const expiries = [...this.subscriptions.values()].flatMap(checks => checks.flatMap(check => { const entry = this.cache.get(permissionKey(check)); return entry ? [entry.expiresAt] : []; }));
    if (expiries.length) this.timer = setTimeout(() => { this.timer = undefined; this.emit(); this.schedule(); }, Math.max(1, Math.min(...expiries) - Date.now()));
  }
}
const Context = createContext<PermissionStore | null>(null);
const fallback = new PermissionStore();
export function PermissionProvider({ children }: { children: ReactNode }) { const [store] = useState(() => new PermissionStore()); return <Context.Provider value={store}>{children}</Context.Provider>; }
export function PermissionSession({ clusterId, sessionId, children }: SessionRequest & { children?: ReactNode }) { const store = useContext(Context); useLayoutEffect(() => store?.setContext({ clusterId, sessionId }), [store, clusterId, sessionId]); return children; }
export function usePermissions() { return useContext(Context) ?? fallback; }
export function usePermissionRevision() { const store = usePermissions(); return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot); }
export function usePermissionChecks(inputs: readonly PermissionCheckInput[]) {
  const store = usePermissions();
  const key = JSON.stringify([...new Map(inputs.map(input => { const check = permissionCheck(input); return [permissionKey(check), check]; })).values()].sort((a, b) => permissionKey(a).localeCompare(permissionKey(b))));
  const checks = useMemo(() => JSON.parse(key) as PermissionCheck[], [key]);
  usePermissionRevision();
  useEffect(() => store.request(checks), [store, checks]);
  const decision = store.decision;
  const loading = store !== fallback && store.loading(checks);
  const read = checks.filter(check => check.action === "list" || check.action === "get");
  const mutations = checks.filter(check => ["create", "update", "patch", "delete"].includes(check.action));
  return { decision, loading, observed: store.observed, epoch: store.authorizationEpoch(), authorizationEpoch: store.authorizationEpoch, retry: store.retry, fingerprint: () => store.fingerprint(checks), can: (action: PermissionAction) => checks.some(check => check.action === action && decision(check) === "allowed"), readOnly: read.some(check => decision(check) === "allowed") && mutations.length > 0 && mutations.every(check => decision(check) === "denied") };
}
export function useResourcePermissions(kind: ResourceKind, namespace: string | null = null, name: string | null = null) { const allNamespaces = namespace === null && resourceViews.some(view => view.kind === kind && view.namespaced); const actions = allNamespaces ? ["list"] as const : ["list", "get", "create", "update", "patch", "delete"] as const; return usePermissionChecks(actions.map(action => ({ kind, namespace, name: action === "create" || action === "list" ? null : name, action }))); }
export function destinationPermission(id: string): PermissionCheck | null { if (id === "users") return null; const kind = id === "nodes" ? "nodes" : id === "custom-resources" ? "customResourceDefinitions" : resourceView(id)?.kind; return kind ? permissionCheck({ kind, action: "list" }) : null; }
export function usersPermissionChecks(namespace: string | null = null): PermissionCheck[] { return (["roleBindings", "clusterRoleBindings", "serviceAccounts"] as const).map(kind => permissionCheck({ kind, namespace, action: "list" })); }
export function useNavigationPermissions(clusterId: string) {
  const store = usePermissions();
  const permissions = usePermissionChecks(navigationChecks);
  return { ...permissions, visible: (id: string) => {
    if (id === "users") return true;
    // An all-namespaces denial does not decide access within a chosen namespace.
    if (resourceView(id)?.namespaced) return true;
    const check = destinationPermission(id);
    return !check || store.navigationVisible(check, clusterId);
  } };
}
