import { expect, test, type Page } from "@playwright/test";

async function connectedMacWindow(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__ICEKUBE_WINDOW_LAYOUT__", {
      value: Object.freeze({ platform: "macos", seamless: true }),
    });
    let sequence = 0;
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
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
          if (command === "cluster_session_open") return snapshot;
          if (command === "cluster_connect") return { ...snapshot, status: "connected", apiVersion: "v1.34.1" };
          if (command === "cluster_disconnect" || command === "cluster_resources_cancel") return;
          throw new Error(`Unexpected toolbar fixture command: ${command}`);
        },
      },
    });
  });
  await page.goto("/#/cluster/one");
  await expect(page.getByRole("table", { name: "Cluster destinations", exact: true })).toBeVisible();
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
      const statusBadge = toolbar.getByText("Connected", { exact: true }).filter({ visible: true });
      if (width >= 640) await expect(statusBadge).toBeVisible();
      else await expect(statusBadge).toHaveCount(0);
      const actions = toolbar.getByRole("button", { name: "Cluster actions", exact: true });
      await expect(toolbar.getByRole("button", { name: "Open Icekube on GitHub", exact: true })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Refresh cluster", exact: true })).toBeVisible();
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
      expect.soft(geometry.controls).toHaveLength(width >= 640 ? 10 : 7);
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
  }
}
