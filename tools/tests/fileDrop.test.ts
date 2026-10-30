import { describe, expect, test } from "bun:test";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { bindFileDrop, droppedPath, fileDropError, fileDropUnavailable, insideDropSurface } from "../../src/app/catalog/fileDrop";

const rect = { left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 };
const event = (paths: string[], x = 40, y = 60): DragDropEvent => ({ type: "drop", paths, position: { x, y } } as DragDropEvent);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("kubeconfig file drop", () => {
  test("accepts one absolute local path without reading file contents", () => {
    for (const path of ["/tmp/config", "/tmp/配置.yaml", "C:\\Users\\test\\config", "D:/kube/config", "\\\\host\\share\\config"]) expect(droppedPath([path])).toBe(path);
    for (const paths of [null, [], ["/tmp/a", "/tmp/b"], [null], [""], ["config"], ["file:///tmp/config"], ["https://example.test/config"], ["/tmp/config\0"], ["/tmp/\nconfig"], ["/" + "a".repeat(4096)], ["/" + "配".repeat(1400)]]) expect(droppedPath(paths)).toBeNull();
  });

  test("hit testing accounts for display scale and zoom and ignores outside/hidden surfaces", () => {
    expect(insideDropSurface({ x: 40, y: 60 }, rect, 2)).toBe(true);
    expect(insideDropSurface({ x: 60, y: 90 }, rect, 3)).toBe(true);
    expect(insideDropSurface({ x: 5, y: 60 }, rect, 2)).toBe(false);
    expect(insideDropSurface({ x: 420, y: 60 }, rect, 2)).toBe(false);
    expect(insideDropSurface({ x: 40, y: 60 }, { ...rect, width: 0 }, 2)).toBe(false);
    expect(insideDropSurface({ x: 40, y: 60 }, rect, 0)).toBe(false);
  });

  function fixture() {
    let handler!: (event: DragDropEvent) => void;
    let resolve!: (unlisten: () => void) => void;
    let reject!: (reason: unknown) => void;
    let stopped = 0, ready = 0, allowed = true;
    const selected: string[] = [], errors: string[] = [], hover: boolean[] = [];
    const dispose = bindFileDrop({
      subscribe: callback => { handler = callback; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
      surface: () => ({ getBoundingClientRect: () => rect }), scale: () => 2,
      canAccept: () => allowed, hovering: value => hover.push(value), select: path => selected.push(path),
      error: message => errors.push(message), ready: () => ready++,
    });
    return { handler, dispose, resolve: () => resolve(() => stopped++), reject, selected, errors, hover, setAllowed: (value: boolean) => { allowed = value; }, counts: () => ({ stopped, ready }) };
  }

  test("handles hover/leave, selects without importing, and rejects multiple files", async () => {
    const f = fixture(); f.resolve(); await flush();
    f.handler({ type: "over", position: { x: 40, y: 60 } } as DragDropEvent);
    expect(f.hover[f.hover.length - 1]).toBe(true);
    f.handler({ type: "leave" }); expect(f.hover[f.hover.length - 1]).toBe(false);
    f.handler(event(["/tmp/config"])); expect(f.selected).toEqual(["/tmp/config"]);
    f.handler(event(["/tmp/a", "/tmp/b"])); expect(f.errors).toEqual([fileDropError]);
    f.handler(event(["/tmp/outside"], 0, 0)); expect(f.selected).toHaveLength(1);
    f.setAllowed(false); f.handler(event(["/tmp/busy"])); expect(f.selected).toHaveLength(1);
    f.dispose(); expect(f.counts()).toEqual({ stopped: 1, ready: 1 });
    f.handler(event(["/tmp/stale"])); expect(f.selected).toHaveLength(1);
  });

  test("late registrations and failures cannot affect closed/reopened dialogs", async () => {
    const old = fixture(); old.dispose(); old.resolve(); await flush();
    expect(old.counts()).toEqual({ stopped: 1, ready: 0 });
    old.handler(event(["/tmp/stale"])); expect(old.selected).toEqual([]);
    const closed = fixture(); closed.dispose(); closed.reject(new Error("private detail")); await flush(); expect(closed.errors).toEqual([]);
    const current = fixture(); current.reject(new Error("private detail")); await flush(); expect(current.errors).toEqual([fileDropUnavailable]);
  });
});
