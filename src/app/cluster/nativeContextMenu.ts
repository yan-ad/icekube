import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SessionRequest } from "./api";
import type { ResourceReference } from "./detailApi";

export type RowAction = "details" | "edit" | "logs" | "shell" | "attach" | "forward" | "delete" | "stop" | "remove" | "install";
export type NativeContextTarget =
  | { type: "resource"; reference: ResourceReference }
  | { type: "helmChart"; id: string; name: string }
  | { type: "helmRelease"; name: string; namespace: string }
  | { type: "forward"; id: string };
export type NativeContextMenuRequest = SessionRequest & { target: NativeContextTarget; actions: readonly RowAction[] };
export type NativeContextMenuHandle = { supported: boolean; dispose: () => void };
export const NATIVE_CONTEXT_MENU_EVENT = "iceon://row-context-menu";
const lifetimeMs = 30_000;
let activeDispose: (() => void) | undefined;

/** Register before showing; dispose on row/view removal or session change. Browser callers render their own fallback. */
export async function showNativeContextMenu(
  input: NativeContextMenuRequest,
  onAction: (action: RowAction) => void,
  signal?: AbortSignal,
): Promise<NativeContextMenuHandle> {
  if (!isTauri()) return { supported: false, dispose: () => {} };
  activeDispose?.();
  const request = { ...input, target: structuredClone(input.target), actions: [...input.actions], requestId: crypto.randomUUID() };
  const scope = { clusterId: request.clusterId, sessionId: request.sessionId, requestId: request.requestId };
  let disposed = false;
  let shown = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { void invoke("row_context_menu_cancel", { request: scope }).catch(() => {}); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", dispose);
    unlisten?.();
    if (activeDispose === dispose) activeDispose = undefined;
    if (shown) cancel();
  };
  activeDispose = dispose;
  signal?.addEventListener("abort", dispose, { once: true });
  if (signal?.aborted) dispose();
  try {
    if (disposed) return { supported: true, dispose };
    unlisten = await listen<unknown>(NATIVE_CONTEXT_MENU_EVENT, ({ payload }) => {
      if (disposed || payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
      const event = payload as Record<string, unknown>;
      if (Object.keys(event).some((key) => !["clusterId", "sessionId", "requestId", "action"].includes(key))
        || event.clusterId !== scope.clusterId || event.sessionId !== scope.sessionId || event.requestId !== scope.requestId) return;
      if (event.action === null) { dispose(); return; }
      if (typeof event.action !== "string" || !request.actions.includes(event.action as RowAction)) return;
      const action = event.action as RowAction;
      dispose();
      onAction(action);
    });
    if (disposed) { unlisten(); return { supported: true, dispose }; }
    // A bounded listener is required even when the native platform has no dismiss notification.
    timer = setTimeout(dispose, lifetimeMs);
    shown = true;
    await invoke("row_context_menu_show", { request });
    if (disposed) cancel();
    return { supported: true, dispose };
  } catch (reason) {
    dispose();
    throw reason;
  }
}
