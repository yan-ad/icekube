import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences } from "../src/app/preferences/api";

async function connectedMacWindow(page: Page) {
  await page.addInitScript(preferences => {
    Object.defineProperty(window, "__ICEON_WINDOW_LAYOUT__", {
      value: Object.freeze({ platform: "macos", seamless: true }),
    });
    let sequence = 0;
    let callbackId = 0;
    const handlers = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number; target: unknown }>();
    const native = { ready: false, listeners };
    Object.assign(window, {
      isTauri: true,
      __toolbarNative: native,
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (_event: string, id: number) => { listeners.delete(id); },
      },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: (callback: (event: unknown) => void) => {
          const id = ++callbackId;
          handlers.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => { handlers.delete(id); },
        invoke: async (command: string, args?: { request?: Record<string, unknown>; event?: string; handler?: number; target?: unknown; eventId?: number }) => {
          if (command === "plugin:event|listen") {
            if (!args?.event || args.handler === undefined || !handlers.has(args.handler)) throw new Error("Missing native event callback");
            const id = ++callbackId;
            listeners.set(id, { event: args.event, handler: args.handler, target: args.target });
            return id;
          }
          if (command === "plugin:event|unlisten") {
            listeners.delete(args!.eventId!);
            return;
          }
          if (command === "native_navigation_ready") {
            const subscribed = [...listeners.values()].some(listener => listener.event === "iceon://native-navigation"
              && JSON.stringify(listener.target) === JSON.stringify({ kind: "WebviewWindow", label: "main" }));
            if (!subscribed) throw new Error("Native navigation must subscribe before readiness");
            native.ready = true;
            return;
          }
          if (command === "preferences_get") return { revision: 1, preferences };
          if (command === "update_state") return (window as unknown as { __toolbarUpdateState?: unknown }).__toolbarUpdateState ?? { phase: "idle", version: null, error: null };
          if (command === "update_window_ready") return;
          if (command === "route_history_get") return null;
          if (command === "route_history_save") return;
          const request = args?.request ?? {};
          const snapshot = {
            clusterId: request.clusterId,
            sessionId: request.sessionId ?? `toolbar-lease-${++sequence}`,
            contextName: "fixture-context",
            status: "disconnected",
            apiVersion: null,
            error: null,
          };
          if (command === "catalog_list") return {
            revision: 1, discoveryError: null, webLinks: [],
            clusters: [{ id: "one", name: "Toolbar fixture", contextName: "fixture-context", source: "kubeconfig", status: "disconnected", pinned: true, labels: ["file=/fixtures/config"], color: "#476BA1" }],
          };
          if (command === "cluster_permissions_review") {
            const review = args?.request as unknown as { clusterId: string; sessionId: string; readId: number; checks: unknown[] };
            const checkedAt = Date.now();
            return { clusterId: review.clusterId, sessionId: review.sessionId, readId: review.readId,
              authorizationEpoch: `fixture-${review.sessionId}`, revision: review.readId, checkedAt, expiresAt: checkedAt + 30_000,
              items: review.checks.map(check => ({ check, decision: "allowed", reason: null })) };
          }
          if (command === "cluster_permissions_cancel" || command === "cluster_permissions_refresh") return null;
          if (command === "cluster_session_open") return snapshot;
          if (command === "cluster_connect") return { ...snapshot, status: "connected", apiVersion: "v1.34.1" };
          if (command === "cluster_resources" && ["nodes", "events"].includes(String(request.kind))) return { ...request, namespace: null, continueToken: null, metrics: null, items: [], truncated: false, fetchedAt: 1793000000000 };
          if (command === "cluster_disconnect" || command === "cluster_resources_cancel") return;
          throw new Error(`Unexpected toolbar fixture command: ${command}`);
        },
      },
    });
  }, defaultPreferences);
  await page.goto("/#/cluster/one");
  await expect.poll(() => page.evaluate(() => {
    const native = (window as unknown as { __toolbarNative: { ready: boolean; listeners: Map<number, { event: string }> } }).__toolbarNative;
    return { ready: native.ready, navigationListeners: [...native.listeners.values()].filter(listener => listener.event === "iceon://native-navigation").length };
  })).toEqual({ ready: true, navigationListeners: 1 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert", { name: "Update error", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Cluster overview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cluster actions", exact: true })).toHaveAttribute("aria-description", "Connection status: Connected");
}

for (const fontPercent of [100, 125]) {
  for (const width of [360, 390, 560, 800, 1440]) {
    test(`connected macOS toolbar fits ${width}px at ${fontPercent}% root font`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 800 });
      await connectedMacWindow(page);
      await page.evaluate(percent => { document.documentElement.style.fontSize = `${percent}%`; }, fontPercent);
      await page.evaluate(() => document.fonts.ready);
      const toolbar = page.getByRole("navigation", { name: "App toolbar", exact: true });
      await expect(toolbar.getByRole("button", { name: /^(Open|Collapse|Expand) sidebar$/ })).toHaveCount(0);
      const statusBadge = toolbar.getByText("Connected", { exact: true }).filter({ visible: true });
      if (width >= 640) await expect(statusBadge).toBeVisible();
      else await expect(statusBadge).toHaveCount(0);
      const actions = toolbar.getByRole("button", { name: "Cluster actions", exact: true });
      await expect(toolbar.getByRole("button", { name: "Open Iceon on GitHub", exact: true })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Refresh overview", exact: true })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Switch cluster", exact: true })).toBeVisible();
      await expect(actions).toHaveAttribute("aria-description", "Connection status: Connected");
      const iconColor = await actions.locator("svg").evaluate(icon => {
        const probe = document.createElement("i");
        probe.style.color = "var(--color-success)";
        icon.parentElement!.append(probe);
        const colors = { actual: getComputedStyle(icon).color, success: getComputedStyle(probe).color };
        probe.remove();
        return colors;
      });
      expect(iconColor.actual).toBe(iconColor.success);
      await actions.hover();
      await expect(page.getByRole("tooltip", { name: "Cluster actions · Connected", exact: true })).toBeVisible();
      await actions.click();
      const menu = page.getByRole("menu", { name: "Cluster actions", exact: true });
      const connected = menu.getByRole("menuitem", { name: "Connected", exact: true });
      await expect(connected).toBeDisabled();
      await expect(menu.getByRole("menuitem").first()).toHaveText("Connected");
      await expect(menu.getByRole("menuitem", { name: /^Refresh / })).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: "Search", exact: true })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Preferences", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      const geometry = await toolbar.evaluate(element => {
        const rect = (target: Element) => {
          const bounds = target.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom };
        };
        const style = getComputedStyle(element);
        const dragRegions = [...element.querySelectorAll("[data-tauri-drag-region]")].map(rect);
        const controls = [...element.querySelectorAll("button"), ...element.querySelectorAll('[class*="badge"]')]
          .filter(target => target.tagName === "BUTTON" || target.textContent === "Connected")
           .filter((target, index, all) => all.indexOf(target) === index)
           .filter(target => target.getClientRects().length > 0)
          .map(target => ({
            label: target.getAttribute("aria-label") ?? target.textContent,
            ...rect(target),
            insideDragRegion: target.closest("[data-tauri-drag-region]") !== null,
          }));
        const status = [...element.querySelectorAll('[class*="badge"]')].find(target => target.textContent === "Connected" && target.getClientRects().length > 0);
        const statusText = status?.querySelector("span");
        return {
          toolbar: rect(element), paddingRight: Number.parseFloat(style.paddingRight),
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
          scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
          dragRegions, controls,
          statusText: statusText ? { clientWidth: statusText.clientWidth, scrollWidth: statusText.scrollWidth } : null,
        };
      });
      await testInfo.attach("toolbar-geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
      console.log(JSON.stringify({ width, fontPercent, ...geometry }));
      expect.soft(geometry.controls.filter(control => control.label === "Connected")).toHaveLength(width >= 640 ? 1 : 0);
      expect.soft(geometry.controls).toHaveLength(width >= 640 ? 9 : 6);
      if (width >= 640) expect.soft(geometry.statusText, "Connected label is measured").not.toBeNull();
      if (geometry.statusText) expect.soft(geometry.statusText.scrollWidth, "Connected label is not clipped").toBeLessThanOrEqual(geometry.statusText.clientWidth);
      for (const control of geometry.controls) {
        expect.soft(control.x, `${control.label}: left traffic-light clearance`).toBeGreaterThanOrEqual(Math.max(geometry.toolbar.x + 80, geometry.dragRegions[0].right));
        expect.soft(control.right, `${control.label}: right padding clearance`).toBeLessThanOrEqual(geometry.toolbar.right - geometry.paddingRight + 0.5);
        expect.soft(control.y, `${control.label}: toolbar top`).toBeGreaterThanOrEqual(geometry.toolbar.y);
        expect.soft(control.bottom, `${control.label}: toolbar bottom`).toBeLessThanOrEqual(geometry.toolbar.bottom + 0.5);
        expect.soft(control.insideDragRegion, `${control.label}: drag ancestry`).toBe(false);
        for (const drag of geometry.dragRegions) {
          const overlap = Math.min(control.right, drag.right) - Math.max(control.x, drag.x) > 0.5
            && Math.min(control.bottom, drag.bottom) - Math.max(control.y, drag.y) > 0.5;
          expect.soft(overlap, `${control.label}: drag geometry overlap`).toBe(false);
        }
      }
      expect.soft(geometry.scrollWidth, "document horizontal overflow").toBeLessThanOrEqual(width);
      expect.soft(geometry.bodyScrollWidth, "body horizontal overflow").toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    });

    test(`update indicators preserve connected toolbar at ${width}px and ${fontPercent}% root font`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 800 });
      await connectedMacWindow(page);
      await page.evaluate(percent => { document.documentElement.style.fontSize = `${percent}%`; }, fontPercent);
      await page.evaluate(() => document.fonts.ready);
      const toolbar = page.getByRole("navigation", { name: "App toolbar", exact: true });
      const snapshots = [
        { phase: "checking", version: null, error: null },
        { phase: "downloading", version: "1.2.3", error: null, progress: { downloaded: 42, total: 100 } },
        { phase: "ready", version: "1.2.3", error: null },
        { phase: "error", version: "1.2.3", error: "installFailed" },
        { phase: "ready", version: "1.2.3", error: "installFailed" },
      ];
      for (const snapshot of snapshots) {
        await page.evaluate(state => Object.assign(window, { __toolbarUpdateState: state }), snapshot);
        const indicator = snapshot.error ? toolbar.getByRole("alert", { name: "Update error", exact: true }) : snapshot.phase === "ready" ? toolbar.getByRole("button", { name: "Restart to Update", exact: true }) : toolbar.getByRole("status", { name: /^Downloading update/ });
        if (snapshot.phase === "checking") await expect(indicator).toHaveCount(0);
        else {
          await expect(indicator).toBeVisible();
          await expect(indicator).toContainText(snapshot.error ? "could not be installed" : snapshot.phase === "ready" ? "Restart to Update" : "42%");
        }
        const geometry = await toolbar.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const rect = (target: Element) => { const box = target.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width }; };
          const controls = [...element.querySelectorAll('button, [role="status"][tabindex], [role="alert"][tabindex]')].filter(target => target.getClientRects().length > 0).map(target => ({ label: target.getAttribute("aria-label"), ...rect(target), drag: !!target.closest("[data-tauri-drag-region]") }));
          return { toolbar: rect(element), paddingRight: parseFloat(getComputedStyle(element).paddingRight), controls,
            drags: [...element.querySelectorAll("[data-tauri-drag-region]")].map(rect),
            indicators: [...element.querySelectorAll('[role="status"][tabindex], [role="alert"][tabindex]')].map(rect),
            scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, height: bounds.height };
        });
        await testInfo.attach(`${snapshot.phase}${snapshot.error ? "-error" : ""}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
        expect(geometry.controls.filter(control => control.label === "Search" || control.label === "Preferences")).toHaveLength(width >= 640 ? 2 : 0);
        expect(await toolbar.getByRole("button").count()).toBe((width >= 640 ? 8 : 6) + (snapshot.phase === "ready" ? 1 : 0));
        for (const indicatorBounds of geometry.indicators) {
          expect(indicatorBounds.width).toBeLessThanOrEqual(fontPercent === 125 ? 20 : 16);
          expect(indicatorBounds.width).toBeGreaterThan(0);
        }
        for (const [index, control] of geometry.controls.entries()) {
          expect(control.drag).toBe(false);
          expect(control.left).toBeGreaterThanOrEqual(geometry.toolbar.left + 80);
          expect(control.right).toBeLessThanOrEqual(geometry.toolbar.right - geometry.paddingRight + 0.5);
          expect(control.top).toBeGreaterThanOrEqual(geometry.toolbar.top);
          expect(control.bottom).toBeLessThanOrEqual(geometry.toolbar.bottom + 0.5);
          for (const other of [...geometry.controls.slice(index + 1), ...geometry.drags]) {
            const overlap = Math.min(control.right, other.right) - Math.max(control.left, other.left) > 0.5
              && Math.min(control.bottom, other.bottom) - Math.max(control.top, other.top) > 0.5;
            expect(overlap, `${control.label} overlaps another toolbar region`).toBe(false);
          }
        }
        expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
        expect(geometry.bodyWidth).toBeLessThanOrEqual(width);
        if (snapshot.phase === "ready" || snapshot.error) {
          await indicator.focus();
          await expect(indicator).toBeFocused();
          await expect(page.getByRole("tooltip").filter({ hasText: snapshot.error ? "could not be installed" : "Update downloaded and verified" })).toBeVisible();
          await page.keyboard.press("Escape");
          await indicator.blur();
        }
      }
      expect(errors).toEqual([]);
    });
  }
}
