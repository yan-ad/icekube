import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useRouterState } from "@tanstack/react-router";
import { catalogError, pinKey, type PinTarget } from "./api";
import { useCatalog } from "./CatalogProvider";
import { getWindowLayout } from "../layouts/window-layout";

export function usePinnedItems() {
  const { snapshot, busy, available, run } = useCatalog();
  const nativePointerDrag = isTauri() && getWindowLayout().platform !== "browser";
  const location = useRouterState({ select: state => state.location.href });
  const [error, setError] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const drag = useRef<{ key: string; keys: string[] } | null>(null);
  const pointer = useRef<{
    key: string;
    keys: string[];
    pointerId: number;
    startX: number;
    startY: number;
    element: HTMLElement;
    started: boolean;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  const suppressPointerClick = useRef(false);
  const menu = useRef<string | null>(null);
  const focus = useRef<{ key: string; root: HTMLElement } | null>(null);
  const items = snapshot?.pinnedItems ?? [];
  const current = useRef({ items, busy });
  current.current = { items, busy };
  const keys = items.map(pinKey).join("|");
  useLayoutEffect(() => {
    const pending = focus.current;
    if (!pending) return;
    focus.current = null;
    const element = [...pending.root.querySelectorAll<HTMLElement>("[data-pin-key]")].find(element => element.dataset.pinKey === pending.key);
    element?.focus({ preventScroll: true });
  }, [keys]);
  function cancelDrag() {
    const pending = pointer.current;
    pointer.current = null;
    if (drag.current || pending?.started) suppressClickUntil.current = Date.now() + 250;
    drag.current = null;
    setDropKey(null);
    if (pending?.started && pending.element.hasPointerCapture(pending.pointerId)) {
      pending.element.releasePointerCapture(pending.pointerId);
    }
  }
  useEffect(() => {
    return () => {
      const requestId = menu.current;
      menu.current = null;
      focus.current = null;
      if (requestId) void invoke("catalog_pin_menu_cancel", { request: { requestId } }).catch(() => {});
    };
  }, [location, keys]);
  useLayoutEffect(() => {
    return () => cancelDrag();
  }, [location, keys, snapshot, busy, available]);
  useEffect(() => {
    if (!nativePointerDrag) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") cancelDrag();
    }
    function onPointerMove(event: globalThis.PointerEvent) {
      const pending = pointer.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1) || current.current.busy) { cancelDrag(); return; }
      if (!pending.started) {
        if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < 6) return;
        try { pending.element.setPointerCapture(event.pointerId); }
        catch { cancelDrag(); return; }
        pending.started = true;
        drag.current = { key: pending.key, keys: pending.keys };
        suppressPointerClick.current = true;
        suppressClickUntil.current = Number.POSITIVE_INFINITY;
      }
      event.preventDefault();
      setDropKey(pointerKeyAt(event.clientX, event.clientY));
    }
    function onPointerUp(event: globalThis.PointerEvent) { finishPointerDrag(event); }
    function onPointerCancel(event: globalThis.PointerEvent) { finishPointerDrag(event, true); }
    function onLostCapture(event: globalThis.PointerEvent) {
      if (pointer.current?.started) finishPointerDrag(event, true);
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("blur", cancelDrag);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("lostpointercapture", onLostCapture);
      window.removeEventListener("blur", cancelDrag);
      cancelDrag();
    };
  }, [nativePointerDrag]);

  function pointerKeyAt(x: number, y: number) {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pin-key]");
    return element?.dataset.pinKey ?? null;
  }
  function finishPointerDrag(event: globalThis.PointerEvent, cancelled = false) {
    const pending = pointer.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    pointer.current = null;
    if (pending.started) {
      suppressClickUntil.current = Date.now() + 250;
      if (pending.element.hasPointerCapture(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
    }
    const source = drag.current;
    drag.current = null;
    const targetKey = cancelled ? null : pointerKeyAt(event.clientX, event.clientY);
    setDropKey(null);
    if (!pending.started || !source || !targetKey || current.current.busy || source.keys.join("|") !== current.current.items.map(pinKey).join("|")) return;
    const sourceItem = current.current.items.find(item => pinKey(item) === source.key);
    const targetIndex = current.current.items.findIndex(item => pinKey(item) === targetKey);
    if (sourceItem && targetIndex >= 0) void reorder(sourceItem, targetIndex);
  }

  async function reorder(target: PinTarget, index: number) {
    const list = current.current.items;
    const from = list.findIndex(item => pinKey(item) === pinKey(target));
    if (current.current.busy || from < 0 || index < 0 || index >= list.length || from === index) return;
    const next = [...list];
    next.splice(index, 0, next.splice(from, 1)[0]);
    setError(null);
    await run("catalog_reorder_pins", { items: next });
  }
  async function context(target: PinTarget) {
    if (!available || !isTauri()) { setError("Pin context menus are available in the desktop app only."); return; }
    if (current.current.busy) return;
    const previous = menu.current;
    if (previous) void invoke("catalog_pin_menu_cancel", { request: { requestId: previous } }).catch(() => {});
    const requestId = crypto.randomUUID();
    menu.current = requestId;
    setError(null);
    try {
      const action: unknown = await invoke("catalog_pin_menu_show", { request: { requestId, target } });
      if (menu.current !== requestId) return;
      menu.current = null;
      const index = current.current.items.findIndex(item => pinKey(item) === pinKey(target));
      if (index < 0 || current.current.busy) { focus.current = null; return; }
      if (action === "unpin") await run(target.section ? "catalog_set_section_pin" : "catalog_set_pin",
        target.section ? { clusterId: target.id, section: target.section, pinned: false } : { id: target.id, pinned: false });
      else if (action === "moveUp" || action === "moveDown") await reorder(target, index + (action === "moveUp" ? -1 : 1));
      else {
        focus.current = null;
        if (action !== null) setError(catalogError("invalidResponse"));
      }
    } catch (reason) {
      if (menu.current === requestId) { menu.current = null; focus.current = null; setError(catalogError(reason)); }
    }
  }
  function handlers(target: PinTarget) {
    const key = pinKey(target);
    return {
      draggable: !nativePointerDrag && available && !busy,
      "data-pin-key": key,
      "data-drop-target": dropKey === key || undefined,
      "aria-description": "Right-click or press Shift+F10 for Unpin and move actions. Drag to reorder. Alt+Arrow Up or Down also moves this shortcut.",
      onContextMenu(event: MouseEvent) { event.preventDefault(); event.stopPropagation(); void context(target); },
      onKeyDownCapture(event: KeyboardEvent) {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          const root = event.currentTarget.closest("nav");
          if (root) focus.current = { key, root };
          event.preventDefault(); event.stopPropagation(); void context(target);
        } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          const root = event.currentTarget.closest("nav");
          if (root) focus.current = { key, root };
          event.preventDefault(); event.stopPropagation();
          const index = current.current.items.findIndex(item => pinKey(item) === key);
          void reorder(target, index + (event.key === "ArrowUp" ? -1 : 1));
        }
      },
      onDragStart(event: DragEvent) {
        if (nativePointerDrag || busy || !available) { event.preventDefault(); return; }
        drag.current = { key, keys: items.map(pinKey) };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-iceon-pin", key);
        suppressClickUntil.current = Number.POSITIVE_INFINITY;
      },
      onDragOver(event: DragEvent) {
        if (!drag.current || busy) return;
        event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropKey(key);
      },
      onDragLeave() { setDropKey(previous => previous === key ? null : previous); },
      onDrop(event: DragEvent) {
        event.preventDefault(); event.stopPropagation();
        const source = drag.current;
        drag.current = null; setDropKey(null); suppressClickUntil.current = Date.now() + 250;
        if (!source || busy || source.keys.join("|") !== current.current.items.map(pinKey).join("|")) return;
        const item = items.find(item => pinKey(item) === source.key);
        if (item) void reorder(item, items.findIndex(item => pinKey(item) === key));
      },
      onDragEnd() { drag.current = null; setDropKey(null); suppressClickUntil.current = Date.now() + 250; },
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!nativePointerDrag || pointer.current || busy || !available || !event.isPrimary || event.button !== 0 || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
        suppressPointerClick.current = false;
        pointer.current = { key, keys: current.current.items.map(pinKey), pointerId: event.pointerId,
          startX: event.clientX, startY: event.clientY, element: event.currentTarget, started: false };
      },
      onClick(event: MouseEvent) {
        if ((suppressPointerClick.current && event.detail !== 0) || Date.now() < suppressClickUntil.current) {
          suppressPointerClick.current = false;
          event.preventDefault(); event.stopPropagation(); return false;
        }
        return true;
      },
    };
  }
  return { items, handlers, error };
}
