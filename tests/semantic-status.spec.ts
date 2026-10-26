import { expect, test, type Page } from "@playwright/test";

const statuses = [
  ["Connected", "success"], ["Running", "success"], ["Active", "success"],
  ["Succeeded", "success"], ["Bound", "success"], ["Deployed", "success"],
  ["Healthy", "success"], ["Ready", "success"], ["Success", "success"],
  ["  rUnNiNg  ", "success"],
  ["Failed", "error"], ["NotReady", "error"], ["CrashLoopBackOff", "error"],
  ["Pending", "warning"], ["Terminating", "warning"], ["Degraded", "warning"],
  ["True", "neutral"], ["False", "neutral"], ["Unknown", "neutral"],
  ["Disconnected", "neutral"], ["Not checked", "neutral"], ["Custom state", "neutral"],
] as const;

async function fixture(page: Page) {
  await page.addInitScript((statuses) => {
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: { request: Record<string, unknown> }) => {
        const request = args?.request ?? {};
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? "semantic-lease", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: "v1.35.8", error: null,
        };
        if (["cluster_disconnect", "cluster_resources_cancel"].includes(command)) return;
        if (command === "cluster_resources") return { ...request, namespace: null,
          items: statuses.map(([status], index) => ({ name: `state-${index}`, uid: `uid-${index}`, namespace: null, createdAt: null, columns: {}, node: null, status })),
          truncated: false, continueToken: null, fetchedAt: Date.now(), metrics: null,
        };
        throw "unexpected mock command";
      },
    } });
  }, statuses);
  await page.goto("/#/cluster/one?section=namespaces");
  await expect(page.getByRole("table", { name: "Namespaces", exact: true })).toBeVisible();
}

for (const colorScheme of ["light", "dark"] as const) test(`semantic statuses use Astryx variants without interpreting generic booleans in ${colorScheme}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ colorScheme });
  await fixture(page);
  const table = page.getByRole("table", { name: "Namespaces", exact: true });
  for (const [index, [status, variant]] of statuses.entries()) {
    const row = table.getByRole("row").filter({ has: page.getByRole("button", { name: `state-${index}`, exact: true }) });
    const badge = row.locator(".astryx-badge");
    await expect(badge).toHaveText(status.trim());
    await expect(badge).toHaveAttribute("data-variant", variant);
    await expect(badge.getByRole("button")).toHaveCount(0);
  }
  const success = table.locator('.astryx-badge[data-variant="success"]').first();
  const neutral = table.locator('.astryx-badge[data-variant="neutral"]').first();
  const background = (element: Element) => getComputedStyle(element).backgroundColor;
  expect(await success.evaluate(background)).not.toEqual(await neutral.evaluate(background));
  expect(errors).toEqual([]);
});
