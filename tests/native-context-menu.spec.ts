import { expect, test } from "@playwright/test";

test("native adapter subscribes first, rejects stale scope and disposes after one selection", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const calls: string[] = [];
    const handlers = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, number>();
    let next = 0;
    let request: Record<string, unknown> = {};
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => listeners.delete(id) },
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => { const id = ++next; handlers.set(id, callback); return id; },
        invoke: async (command: string, args: { handler?: number; eventId?: number; request?: Record<string, unknown> }) => {
          calls.push(command);
          if (command === "plugin:event|listen") { const id = ++next; listeners.set(id, args.handler!); return id; }
          if (command === "plugin:event|unlisten") { listeners.delete(args.eventId!); return null; }
          if (command === "row_context_menu_show") request = args.request!;
          return null;
        },
      },
    });
    // @ts-expect-error Vite serves this source module in the browser fixture.
    const api = await import("/src/app/cluster/nativeContextMenu.ts");
    const selected: string[] = [];
    const handle = await api.showNativeContextMenu({ clusterId: "cluster", sessionId: "session", target: { type: "forward", id: "forward" }, actions: ["stop"] }, (action: string) => selected.push(action));
    const send = (payload: object) => { for (const [id, handler] of [...listeners]) handlers.get(handler)?.({ event: api.NATIVE_CONTEXT_MENU_EVENT, id, payload }); };
    send({ clusterId: request.clusterId, sessionId: "stale", requestId: request.requestId, action: "stop" });
    send({ clusterId: request.clusterId, sessionId: request.sessionId, requestId: request.requestId, action: "delete" });
    const before = [...selected];
    send({ clusterId: request.clusterId, sessionId: request.sessionId, requestId: request.requestId, action: "stop" });
    send({ clusterId: request.clusterId, sessionId: request.sessionId, requestId: request.requestId, action: "stop" });
    handle.dispose();
    return { before, selected, calls, supported: handle.supported, listeners: listeners.size };
  });
  expect(result.before).toEqual([]);
  expect(result.selected).toEqual(["stop"]);
  expect(result.supported).toBe(true);
  expect(result.calls.indexOf("plugin:event|listen")).toBeLessThan(result.calls.indexOf("row_context_menu_show"));
  expect(result.calls).toContain("row_context_menu_cancel");
  expect(result.listeners).toBe(0);
});

test("browser preview returns an unsupported handle without native IPC", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module in the browser fixture.
    const api = await import("/src/app/cluster/nativeContextMenu.ts");
    const handle = await api.showNativeContextMenu({ clusterId: "cluster", sessionId: "session", target: { type: "forward", id: "forward" }, actions: ["stop"] }, () => { throw new Error("Unexpected action"); });
    handle.dispose();
    return handle.supported;
  });
  expect(result).toBe(false);
});
