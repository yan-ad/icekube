import { useEffect, useRef, useState } from "react";
import { connectSession, disconnectSession, errorCode, openSession, type ConnectionErrorCode, type ConnectionSnapshot } from "./api";

type View = { snapshot: ConnectionSnapshot | null; phase: "opening" | "ready" | "connecting" | "releasing" | "failed"; error: ConnectionErrorCode | null };
type Owner = { disposed: boolean; generation: number; snapshot: ConnectionSnapshot | null; phase: View["phase"]; release: (() => Promise<void>) | null };

export function useClusterSession(clusterId: string) {
  const owner = useRef<Owner | null>(null);
  const [view, setView] = useState<View>({ snapshot: null, phase: "opening", error: null });
  useEffect(() => {
    const scope: Owner = { disposed: false, generation: 0, snapshot: null, phase: "opening", release: null };
    owner.current = scope;
    const publish = (next: View) => {
      if (scope.disposed) return;
      scope.snapshot = next.snapshot; scope.phase = next.phase; setView(next);
    };
    publish({ snapshot: null, phase: "opening", error: null });
    void openSession(clusterId).then((snapshot) => {
      // A lease still belongs to this effect when open completes after unmount.
      let released: Promise<void> | null = null;
      const release = () => released ??= disconnectSession({ clusterId, sessionId: snapshot.sessionId });
      scope.release = release;
      if (scope.disposed) { void release().catch(() => {}); return; }
      publish({ snapshot, phase: "ready", error: snapshot.error });
    }).catch((reason) => publish({ snapshot: null, phase: "failed", error: errorCode(reason) }));
    return () => {
      scope.disposed = true; scope.generation++;
      if (scope.release) void scope.release().catch(() => {});
      if (owner.current === scope) owner.current = null;
    };
  }, [clusterId]);

  const connect = async () => {
    const scope = owner.current;
    if (!scope || scope.disposed || scope.phase !== "ready" || !scope.snapshot || scope.snapshot.clusterId !== clusterId) return;
    const snapshot = scope.snapshot;
    const generation = ++scope.generation;
    scope.phase = "connecting";
    setView({ snapshot: { ...snapshot, status: "connecting", error: null }, phase: "connecting", error: null });
    try {
      const next = await connectSession({ clusterId, sessionId: snapshot.sessionId });
      if (scope.disposed || generation !== scope.generation || scope.snapshot?.sessionId !== snapshot.sessionId) return;
      scope.snapshot = next; scope.phase = "ready";
      setView({ snapshot: next, phase: "ready", error: next.error });
    } catch (reason) {
      if (scope.disposed || generation !== scope.generation) return;
      scope.phase = "ready";
      scope.snapshot = { ...snapshot, status: "error", error: errorCode(reason) };
      setView({ snapshot: scope.snapshot, phase: "ready", error: errorCode(reason) });
    }
  };
  const disconnect = async () => {
    const scope = owner.current;
    if (!scope || scope.disposed || !scope.snapshot || !scope.release || scope.phase === "releasing") return;
    const generation = ++scope.generation;
    scope.phase = "releasing";
    setView({ snapshot: null, phase: "releasing", error: null });
    try {
      await scope.release();
      scope.snapshot = null; scope.release = null;
      if (scope.disposed || generation !== scope.generation) return;
      const next = await openSession(clusterId);
      let released: Promise<void> | null = null;
      const release = () => released ??= disconnectSession({ clusterId, sessionId: next.sessionId });
      scope.release = release;
      if (scope.disposed || generation !== scope.generation) { void release().catch(() => {}); return; }
      scope.snapshot = next; scope.phase = "ready";
      setView({ snapshot: next, phase: "ready", error: next.error });
    } catch (reason) {
      if (scope.disposed || generation !== scope.generation) return;
      // Keep a failed release retryable without reconnecting an uncertain lease.
      if (scope.snapshot) {
        const lease = scope.snapshot;
        scope.release = () => disconnectSession({ clusterId, sessionId: lease.sessionId });
      }
      scope.phase = "failed";
      setView({ snapshot: null, phase: "failed", error: errorCode(reason) });
    }
  };
  return { ...view, connect, disconnect, canRelease: !!owner.current?.snapshot };
}
