import { expect, test } from "@playwright/test";
import { clusterDestinations, clusterSections } from "../src/app/cluster/navigation";
import { destinationDescriptions } from "../src/app/cluster/destinationDescriptions";

test("every fixed destination has specific descriptive copy", () => {
  expect(Object.keys(destinationDescriptions).sort()).toEqual(clusterDestinations.map(item => item.id).sort());
  expect(new Set(Object.values(destinationDescriptions)).size).toBe(clusterDestinations.length);
  for (const description of Object.values(destinationDescriptions)) {
    expect(description.length).toBeGreaterThan(30);
    expect(description).not.toMatch(/browse resources|view resources|coming soon/i);
  }
});

test("parent directories use named card anchors rather than a View table", async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args?: { request?: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        if (command === "plugin:event|listen") return 1;
        if (command === "plugin:event|unlisten" || command === "cluster_disconnect") return null;
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [{ id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" }] };
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: request.clusterId, sessionId: request.sessionId ?? "grid", contextName: "dev", status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        throw "invalidInput";
      },
    } });
  });
  await page.goto("/#/cluster/one?section=storage");
  const grid = page.getByRole("navigation", { name: "Storage destinations" });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("link")).toHaveCount(3);
  const claim = grid.getByRole("link", { name: "Persistent Volume Claims", exact: true });
  await expect(claim).toHaveAttribute("href", "#/cluster/one?section=persistent-volume-claims");
  await expect(claim).toHaveAccessibleDescription("Namespaced requests for persistent storage.");
  await expect(page.getByRole("columnheader", { name: "View", exact: true })).toHaveCount(0);
  for (const category of clusterSections.filter(section => "children" in section && section.id !== "custom-resources")) {
    await page.goto(`/#/cluster/one?section=${category.id}`);
    const directory = page.getByRole("navigation", { name: `${category.label} destinations` });
    await expect(directory).toBeVisible();
    const children = "children" in category ? category.children : [];
    for (const destination of children.filter(child => child.id !== "workloads-overview")) {
      await expect(directory.getByRole("link", { name: destination.label, exact: true })).toHaveAccessibleDescription(destinationDescriptions[destination.id]);
    }
  }
  await page.goto("/#/cluster/one?section=storage");
  await page.setViewportSize({ width: 390, height: 720 });
  await expect(claim).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await claim.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=persistent-volume-claims/);
});
