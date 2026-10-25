import { useCallback, useEffect, useRef, useState } from "react";
import { connectSession, disconnectSession, errorCode, openSession, type ConnectionErrorCode, type ConnectionSnapshot } from "./api";

type View = { snapshot: ConnectionSnapshot | null; phase: "opening" | "ready" | "connecting" | "releasing" | "failed"; error: ConnectionErrorCode | null };
type Owner = { disposed: boolean; generation: number; snapshot: ConnectionSnapshot | null; phase: View["phase"]; release: (() => Promise<void>) | null };

export function useClusterSession(clusterId: string) {
  const owner = useRef<Owner | null>(null);
  const [view, setView] = useState<View>({ snapshot: null, phase: "opening", error: null });
  const publish = useCallback((scope: Owner, next: View) => {
    if (scope.disposed || owner.current !== scope) return;
    scope.snapshot = next.snapshot; scope.phase = next.phase; setView(next);
  }, []);
  const attach = useCallback(async (scope: Owner, generation: number) => {
    const snapshot = await openSession(clusterId);
    let released: Promise<void> | null = null;
    const release = () => released ??= disconnectSession({ clusterId, sessionId: snapshot.sessionId });
    if (scope.disposed || generation !== scope.generation) { void release().catch(() => {}); return null; }
    scope.release = release;
    publish(scope, { snapshot, phase: "ready", error: snapshot.error });
    return snapshot;
  }, [clusterId, publish]);
  const connectOwned = useCallback(async (scope: Owner) => {
    if (scope.disposed || scope.phase !== "ready" || !scope.snapshot || scope.snapshot.clusterId !== clusterId || scope.snapshot.status === "connected") return;
    const snapshot = scope.snapshot;
    const generation = ++scope.generation;
    publish(scope, { snapshot: { ...snapshot, status: "connecting", error: null }, phase: "connecting", error: null });
    try {
      const next = await connectSession({ clusterId, sessionId: snapshot.sessionId });
      if (scope.disposed || generation !== scope.generation) return;
      publish(scope, { snapshot: next, phase: "ready", error: next.error });
    } catch (reason) {
      if (scope.disposed || generation !== scope.generation) return;
      const error = errorCode(reason);
      publish(scope, { snapshot: { ...snapshot, status: "error", error }, phase: "ready", error });
    }
  }, [clusterId, publish]);
  useEffect(() => {
    const scope: Owner = { disposed: false, generation: 0, snapshot: null, phase: "opening", release: null };
    owner.current = scope;
    publish(scope, { snapshot: null, phase: "opening", error: null });
    void attach(scope, scope.generation).then((snapshot) => {
      if (snapshot && !scope.disposed) return connectOwned(scope);
    }).catch((reason) => publish(scope, { snapshot: null, phase: "failed", error: errorCode(reason) }));
    return () => {
      scope.disposed = true; scope.generation++;
      if (scope.release) void scope.release().catch(() => {});
      if (owner.current === scope) owner.current = null;
    };
  }, [attach, connectOwned, publish]);

  const reset = useCallback(async (reconnect: boolean) => {
    const scope = owner.current;
    if (!scope || scope.disposed || !scope.snapshot || !scope.release || ["opening", "releasing"].includes(scope.phase)) return;
    const generation = ++scope.generation;
    const previous = scope.snapshot;
    publish(scope, { snapshot: null, phase: "releasing", error: null });
    try {
      await scope.release();
      if (scope.disposed || generation !== scope.generation) return;
      scope.release = null;
      const snapshot = await attach(scope, generation);
      if (snapshot && reconnect) await connectOwned(scope);
    } catch (reason) {
      if (scope.disposed || generation !== scope.generation) return;
      scope.release = () => disconnectSession({ clusterId, sessionId: previous.sessionId });
      publish(scope, { snapshot: null, phase: "failed", error: errorCode(reason) });
    }
  }, [attach, clusterId, connectOwned, publish]);
  const connect = useCallback(async () => {
    const scope = owner.current;
    if (!scope) return;
    if (scope.snapshot?.error === "staleSession") {
      await reset(true);
      return;
    }
    await connectOwned(scope);
  }, [connectOwned, reset]);
  const disconnect = useCallback(() => reset(false), [reset]);
  const reconnect = useCallback(() => reset(true), [reset]);
  return { ...view, connect, disconnect, reconnect, canRelease: !!owner.current?.snapshot };
}
