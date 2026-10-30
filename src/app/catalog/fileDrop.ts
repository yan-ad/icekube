import type { DragDropEvent } from "@tauri-apps/api/webview";

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Surface = { getBoundingClientRect(): Rect };
type Unlisten = () => void;
export type DropSubscriber = (handler: (event: DragDropEvent) => void) => Promise<Unlisten>;

export const fileDropError = "Drop one kubeconfig file. You can also choose a file or enter its full path.";
export const fileDropUnavailable = "File drop is unavailable. Choose a file or enter its full path.";

export function droppedPath(paths: unknown): string | null {
  if (!Array.isArray(paths) || paths.length !== 1) return null;
  const path: unknown = paths[0];
  if (typeof path !== "string" || new TextEncoder().encode(path).length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return /^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(path) ? path : null;
}

export function insideDropSurface(position: { x: number; y: number }, rect: Rect, physicalPerCss: number): boolean {
  if (!Number.isFinite(physicalPerCss) || physicalPerCss <= 0 || rect.width <= 0 || rect.height <= 0) return false;
  const x = position.x / physicalPerCss, y = position.y / physicalPerCss;
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

// Disposal must also release a listener whose registration resolves after the dialog closes.
export function bindFileDrop(options: {
  subscribe: DropSubscriber;
  surface: () => Surface | null;
  scale: () => number;
  canAccept: () => boolean;
  hovering: (active: boolean) => void;
  select: (path: string) => void;
  error: (message: string) => void;
  ready: () => void;
}): () => void {
  let disposed = false;
  let unlisten: Unlisten | undefined;
  void options.subscribe(event => {
    if (disposed) return;
    if (event.type === "leave" || !options.canAccept()) { options.hovering(false); return; }
    const surface = options.surface();
    const inside = !!surface && insideDropSurface(event.position, surface.getBoundingClientRect(), options.scale());
    options.hovering(inside && event.type !== "drop");
    if (!inside || event.type !== "drop") return;
    const path = droppedPath(event.paths);
    if (path) options.select(path);
    else options.error(fileDropError);
  }).then(stop => {
    if (disposed) stop();
    else { unlisten = stop; options.ready(); }
  }).catch(() => { if (!disposed) options.error(fileDropUnavailable); });
  return () => { disposed = true; unlisten?.(); };
}
