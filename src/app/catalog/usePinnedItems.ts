import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRouterState } from "@tanstack/react-router";
import { catalogError, pinKey, type PinTarget } from "./api";
import { useCatalog } from "./CatalogProvider";

export function usePinnedItems() {
  const { snapshot, busy, available, run } = useCatalog();
  const location = useRouterState({ select: state => state.location.href });
  const [error, setError] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const drag = useRef<{ key: string; keys: string[] } | null>(null);
  const suppressClickUntil = useRef(0);
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
  useEffect(() => {
    return () => {
      const requestId = menu.current;
      menu.current = null;
      drag.current = null;
      if (requestId) void invoke("catalog_pin_menu_cancel", { request: { requestId } }).catch(() => {});
    };
  }, [location, keys]);

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
    if (!available) { setError("Pin context menus are available in the desktop app only."); return; }
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
      draggable: available && !busy,
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
        if (busy || !available) { event.preventDefault(); return; }
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
      onClick(event: MouseEvent) {
        if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); return false; }
        return true;
      },
    };
  }
  return { items, handlers, error };
}
