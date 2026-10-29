import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { checkForUpdates } from "../layouts/nativeNavigationApi";
import { hasUpdateEngine, readUpdateState, reportUpdateWindowPrepared, reportUpdateWindowReady, updateError, type UpdateSnapshot } from "./api";

type UpdateState = { snapshot: UpdateSnapshot | null; busy: boolean; error: string | null; check: () => Promise<void>; block: (token: symbol, reason: string | null) => void };
const UpdateContext = createContext<UpdateState | null>(null);
function sameSnapshot(previous: UpdateSnapshot | null, next: UpdateSnapshot): boolean {
  return previous !== null && previous.phase === next.phase && previous.version === next.version
    && previous.error === next.error && previous.preparationId === next.preparationId
    && (previous.progress === next.progress || previous.progress != null && next.progress != null
      && previous.progress.downloaded === next.progress.downloaded && previous.progress.total === next.progress.total);
}
type Editable = HTMLInputElement | HTMLTextAreaElement;
function isDraftField(element: Element): element is Editable {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.readOnly || element.disabled) return false;
  if (element instanceof HTMLInputElement && !["text", "email", "password", "url", "number", "tel"].includes(element.type)) return false;
  return !/^(search|find|filter)\b/i.test(`${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("placeholder") ?? ""}`.trim());
}
function hasBlockingSurface(dirty: Map<Editable, string>): boolean {
  if (document.querySelector('[data-update-blocking]:not([data-update-blocking="false"])')) return true;
  if ([...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')].some(element => element.getClientRects().length > 0 && !element.closest('[hidden], [aria-hidden="true"]'))) return true;
  // Editors can retain drafts in inactive tabs. Visibility and window focus are not safety signals.
  if (document.querySelector('[contenteditable="true"]:not([aria-readonly="true"]), [contenteditable="plaintext-only"]:not([aria-readonly="true"]), [contenteditable=""]:not([aria-readonly="true"])')) return true;
  for (const [element, baseline] of dirty) {
    if (!element.isConnected || !isDraftField(element) || element.value === baseline) dirty.delete(element);
    else return true;
  }
  const focused = document.activeElement;
  return focused !== null && isDraftField(focused) && focused.value.length > 0;
}
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const phase = useRef<UpdateSnapshot["phase"] | null>(null);
  const blockers = useRef(new Map<symbol, string>());
  const dirty = useRef(new Map<Editable, string>());
  const baselines = useRef(new WeakMap<Editable, string>());
  const heartbeat = useRef<() => void>(() => {});
  const admission = useRef<HTMLElement>(null);
  const frozen = useRef(false);
  const attempt = useRef<string | null>(null);
  const unsafeSeen = useRef(false);
  const restoreInert = useRef<() => void>(() => {});
  const thaw = useCallback(() => {
    restoreInert.current(); restoreInert.current = () => {};
    frozen.current = false; attempt.current = null; unsafeSeen.current = false;
  }, []);
  const block = useCallback((token: symbol, reason: string | null) => {
    if (reason === null) blockers.current.delete(token); else blockers.current.set(token, reason);
    heartbeat.current();
  }, []);
  const apply = useCallback((next: UpdateSnapshot) => {
    if (next.phase === "preparing" || next.phase === "restarting") {
      if (next.phase === "preparing" && attempt.current !== next.preparationId) {
        attempt.current = next.preparationId!;
        unsafeSeen.current = blockers.current.size > 0 || hasBlockingSurface(dirty.current);
      }
      if (!frozen.current) {
        // Capture draft safety before inert can move focus out of an editor.
        unsafeSeen.current ||= blockers.current.size > 0 || hasBlockingSurface(dirty.current);
        frozen.current = true;
        const root = document.getElementById("root") ?? admission.current;
        if (root) {
          const prior = root.getAttribute("inert");
          root.inert = true;
          restoreInert.current = () => { if (prior === null) root.removeAttribute("inert"); else root.setAttribute("inert", prior); };
        } else unsafeSeen.current = true;
      }
    } else thaw();
    phase.current = next.phase;
    setSnapshot(current => sameSnapshot(current, next) ? current : next);
    setError(next.error ? updateError(next.error) : null);
  }, [thaw]);
  useLayoutEffect(() => {
    mounted.current = true;
    if (!hasUpdateEngine()) return () => { mounted.current = false; };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reporting = false;
    let queued = false;
    const report = async () => {
      if (disposed || (phase.current !== "ready" && phase.current !== "preparing")) return;
      if (reporting) { queued = true; return; }
      reporting = true;
      const reportingAttempt = attempt.current;
      try {
        const unsafe = blockers.current.size > 0 || hasBlockingSurface(dirty.current);
        if (phase.current === "preparing" && attempt.current) {
          unsafeSeen.current ||= unsafe;
          await reportUpdateWindowPrepared(attempt.current, frozen.current && !unsafeSeen.current);
        } else await reportUpdateWindowReady(!unsafe);
      }
      catch { if (!disposed && reportingAttempt === attempt.current) { unsafeSeen.current = true; setError("Update readiness could not be reported. Automatic installation is paused."); } }
      finally {
        reporting = false;
        if (queued) { queued = false; void report(); }
      }
    };
    heartbeat.current = () => { void report(); };
    const preventWork = (event: Event) => {
      if (!frozen.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    // Portals live outside the root. Capture before document/React handlers too.
    const admissionEvents = ["keydown", "keyup", "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "beforeinput", "input", "change", "submit", "focusin", "contextmenu", "drop", "paste", "compositionstart"];
    admissionEvents.forEach(event => window.addEventListener(event, preventWork, true));
    const interaction = (event: Event) => {
      if (event.target instanceof Element && isDraftField(event.target)) {
        if (event.type === "focusin" && !dirty.current.has(event.target)) baselines.current.set(event.target, event.target.value);
        if (event.type === "input" || event.type === "change") dirty.current.set(event.target, baselines.current.get(event.target) ?? event.target.defaultValue);
      }
      void report();
    };
    const events = ["input", "change", "focusin", "focusout", "visibilitychange"];
    events.forEach(event => document.addEventListener(event, interaction, true));
    const observer = new MutationObserver(() => { void report(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden", "aria-hidden", "aria-readonly", "readonly", "disabled", "contenteditable", "data-update-blocking"] });
    const poll = async () => {
      const epoch = generation.current;
      try {
        const next = await readUpdateState();
        if (!disposed && epoch === generation.current) { apply(next); void report(); }
      } catch {
        if (!disposed && epoch === generation.current && !operation.current) {
          if (phase.current === "ready") void reportUpdateWindowReady(false).catch(() => {});
          if (attempt.current) void reportUpdateWindowPrepared(attempt.current, false).catch(() => {});
          thaw();
          phase.current = null; setSnapshot(null); setError(updateError("invalidResponse"));
        }
      }
      if (!disposed) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => {
      disposed = true; mounted.current = false; clearTimeout(timer); observer.disconnect();
      events.forEach(event => document.removeEventListener(event, interaction, true));
      admissionEvents.forEach(event => window.removeEventListener(event, preventWork, true));
      heartbeat.current = () => {};
      if (phase.current === "ready") void reportUpdateWindowReady(false).catch(() => {});
      if (attempt.current) void reportUpdateWindowPrepared(attempt.current, false).catch(() => {});
      thaw(); phase.current = null;
    };
  }, [apply, thaw]);
  const check = useCallback(async () => {
    if (operation.current || frozen.current || !hasUpdateEngine()) return;
    operation.current = true;
    generation.current++;
    setBusy(true); setError(null);
    try { const next = await checkForUpdates(); if (mounted.current) { apply(next); heartbeat.current(); } }
    catch (reason) { if (mounted.current) setError(updateError(reason)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }, [apply]);
  const value = useMemo(() => ({ snapshot, busy, error, check, block }), [snapshot, busy, error, check, block]);
  return <UpdateContext value={value}><section ref={admission} data-update-admission="" style={{ display: "contents" }}>{children}</section></UpdateContext>;
}
export function useUpdateBlocker(active: boolean, reason: string) {
  const context = useContext(UpdateContext);
  const token = useRef(Symbol("update-blocker"));
  const register = context?.block;
  useLayoutEffect(() => {
    if (!register) return;
    register(token.current, active ? reason : null);
  }, [register, active, reason]);
  useLayoutEffect(() => {
    const identity = token.current;
    return () => register?.(identity, null);
  }, [register]);
}
export function useUpdates() {
  const context = useContext(UpdateContext);
  if (!context) throw new Error("UpdateProvider is required");
  return context;
}
