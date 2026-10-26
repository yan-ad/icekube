import { expect, test, type Page } from "@playwright/test";
import { resourceViews } from "../src/app/cluster/resourceViews";
import type { ResourceKind } from "../src/app/cluster/api";
import type { ResourceReference } from "../src/app/cluster/detailApi";

type Request = Record<string, unknown> & { reference?: ResourceReference };
type Call = { command: string; request: Request };
type Controls = { sections?: { title: string; facts: { label: string; value: string }[] }[]; holdName?: string; error?: string; malformed?: string; revision?: string; missingRelation?: boolean };
type FixtureWindow = Window & {
  __inspectorCalls: Call[];
  __inspectorControl: Controls;
  __releaseInspector: () => void;
};
const inspector = (page: Page) => page.getByRole("region", { name: "Resource details", exact: true });

test("workspace disposal cancels an in-flight detail and late completion cannot reopen it", async ({ page }) => {
  await fixture(page, "deployments", { holdName: "sample-a" });
  await grid(page, "Deployments").getByRole("button", { name: "sample-a", exact: true }).click();
    await expect(inspector(page).getByText("Loading resource details…", { exact: true })).toBeVisible();
  const reads = await calls(page, "cluster_resource_detail");
  await page.evaluate(() => { location.hash = "/catalog/all"; });
  await expect(inspector(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page, "cluster_resource_detail_cancel")).map(call => call.request)).toEqual(reads.map(read => read.request));
  await release(page); await page.waitForTimeout(650);
  await expect(inspector(page)).toHaveCount(0);
  expect(await calls(page, "cluster_resource_detail")).toEqual(reads);
});

test("metadata detail namespace link preserves the selected namespace identity", async ({ page }) => {
  await fixture(page);
  await grid(page, "Deployments").getByRole("button", { name: "sample-a", exact: true }).click();
  await expect(inspector(page)).toContainText("detail-version-1");
  await inspector(page).getByRole("button", { name: "team-a", exact: true }).click();
  await expect(page).toHaveURL(/section=namespaces$/);
  await expect(inspector(page)).toContainText("uid-namespaces-team-a");
  expect((await calls(page, "cluster_resource_detail")).at(-1)!.request.reference)
    .toEqual({ kind: "namespaces", namespace: null, name: "team-a" });
});
const grid = (page: Page, label: string) => page.getByRole("table", { name: label, exact: true });
const calls = (page: Page, command: string) => page.evaluate(command =>
  (window as unknown as FixtureWindow).__inspectorCalls.filter(call => call.command === command), command);
const control = (page: Page, value: Controls) => page.evaluate(value =>
  Object.assign((window as unknown as FixtureWindow).__inspectorControl, value), value);
const release = (page: Page) => page.evaluate(async () => {
  (window as unknown as FixtureWindow).__releaseInspector();
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
const rowName = (kind: string) => kind === "nodes" ? "node-a" : kind === "namespaces" ? "team-a" : "sample-a";

async function fixture(page: Page, section = "deployments", options: Controls = {}) {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(({ views, options }) => {
    const calls: Call[] = [], pending: (() => void)[] = [];
    const control: Controls = { revision: "detail-version-1", ...options };
    const relation = (kind: string): Record<string, ResourceReference> => {
      const ref = (kind: ResourceKind, name: string, namespace: string | null = null): ResourceReference =>
        ({ kind, name, namespace, uid: `uid-${kind}-${name}` });
      switch (kind) {
        case "pods": return { node: ref("nodes", "related-node"), controlledBy: ref("replicaSets", "related-owner", "team-a") };
        case "persistentVolumeClaims": return { storageClass: ref("storageClasses", "related-class"), volume: ref("persistentVolumes", "related-volume") };
        case "persistentVolumes": return { storageClass: ref("storageClasses", "related-class"), claim: ref("persistentVolumeClaims", "related-claim", "team-b") };
        case "roleBindings": return { roleRef: ref("roles", "related-role", "team-a") };
        case "clusterRoleBindings": return { roleRef: ref("clusterRoles", "related-role") };
        case "horizontalPodAutoscalers": case "verticalPodAutoscalers": return { target: ref("deployments", "related-target", "team-a") };
        case "validatingAdmissionPolicyBindings": return { policy: ref("validatingAdmissionPolicies", "related-policy") };
        default: return {};
      }
    };
    const item = (kind: string, name: string, namespace?: string | null) => {
      const view = views.find(view => view.kind === kind);
      const ns = namespace === undefined ? view?.namespaced ? "team-a" : null : namespace;
      const columns: Record<string, string> = Object.fromEntries((view?.columns ?? []).map(column => [column.key, `value-${column.key}`]));
      for (const [column, reference] of Object.entries(relation(kind))) columns[column] = reference.name;
      if (kind === "pods") Object.assign(columns, { health: "healthy", ready: "1/1", restarts: "0" });
      return { name, namespace: ns, uid: `uid-${kind}-${name}`, resourceVersion: "list-version", createdAt: "2026-10-01T00:00:00Z",
        status: kind === "pods" ? "Running" : kind === "nodes" ? "Ready" : "Active", columns,
        node: kind === "nodes" ? { roles: ["worker"], taints: 0, version: "v1.35.8", internalIps: [], schedulable: true,
          diskAllocatable: null, metricsTimestamp: null, cpu: { used: null, allocatable: null, capacity: null },
          memory: { used: null, allocatable: null, capacity: null }, conditions: [{ type: "Ready", status: "True" }] } : null };
    };
    Object.assign(window, { isTauri: true, __inspectorCalls: calls, __inspectorControl: control,
      __releaseInspector: () => pending.splice(0).forEach(resolve => resolve()),
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Request }) => {
        const request = structuredClone(args?.request ?? {});
        calls.push({ command, request });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "cluster_session_open" || command === "cluster_connect") return {
          clusterId: request.clusterId, sessionId: request.sessionId ?? "inspector-lease", contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null,
        };
        if (["cluster_disconnect", "cluster_resources_cancel", "cluster_resource_detail_cancel", "helm_cancel"].includes(command)) return null;
        if (command === "cluster_resources") {
          const kind = String(request.kind);
          const first = kind === "nodes" ? "node-a" : kind === "namespaces" ? "team-a" : "sample-a";
          const items = [item(kind, first), item(kind, "sample-b")];
          if (kind === "pods") {
            for (const [health, status] of [["warning", "CrashLoopBackOff"], ["completed", "Succeeded"], ["terminating", "Terminating"], ["unknown", "Unknown"]]) {
              const next = item(kind, `pod-${health}`); next.status = status; Object.assign(next.columns, { health, warning: "CrashLoopBackOff" }); items.push(next);
            }
          }
          return { clusterId: request.clusterId, sessionId: request.sessionId, kind, readId: request.readId,
            namespace: request.namespace ?? null, items, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null };
        }
        if (command === "cluster_resource_detail") {
          const reference = request.reference!;
          const result = item(reference.kind, reference.name, reference.namespace);
          result.uid = reference.uid ?? result.uid; result.resourceVersion = control.revision!;
          const related = control.missingRelation ? {} : relation(reference.kind);
          const response: Record<string, unknown> = { clusterId: request.clusterId, sessionId: request.sessionId, readId: request.readId,
            reference: { ...reference, uid: result.uid }, item: result, related, ...(control.sections ? { sections: control.sections } : {}) };
          if (control.malformed === "readId") response.readId = -1;
          if (control.malformed === "session") response.sessionId = "other-lease";
          if (control.malformed === "uid") response.reference = { ...reference, uid: "replacement-uid" };
          if (control.malformed === "secret") result.columns = { token: "PRIVATE_SECRET_VALUE" };
          if (control.malformed === "raw") response.data = { token: "PRIVATE_SECRET_VALUE" };
          const error = control.error;
          if (control.holdName === reference.name) await new Promise<void>(resolve => pending.push(resolve));
          if (error) throw error;
          return response;
        }
        if (command === "cluster_pod_detail") return { ...request, uid: request.uid ?? `uid-pods-${request.name}`, resourceVersion: "pod-detail-version",
          phase: "Running", node: "related-node", podIps: [], hostIps: [], serviceAccount: "default", qos: "Burstable",
          createdAt: "2026-10-01T00:00:00Z", deletionTimestamp: null, containers: [], conditions: [], events: [], yaml: "apiVersion: v1\nkind: Pod\n" };
        if (command === "helm_table") return { ...request, items: [], truncated: false };
        if (command === "cluster_pod_forward_list") return [];
        throw `Unexpected inspector fixture command: ${command}`;
      } },
    });
  }, { views: resourceViews, options });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/cluster/one?section=${section}`);
}

for (const view of [...resourceViews.filter(view => view.kind && view.kind !== "pods"),
  { section: "nodes", label: "Nodes", kind: "nodes", namespaced: false }]) {
  test(`${view.label}: name opens scoped metadata in the nonmodal right inspector, without selecting a row`, async ({ page }) => {
    await fixture(page, view.section);
    const before = (await page.locator('[aria-label="Resource workspace"]').boundingBox())!;
    const name = rowName(view.kind!);
    const button = grid(page, view.label).getByRole("button", { name, exact: true });
    await button.focus(); await button.press("Enter");
    await expect(inspector(page)).toBeVisible();
    await expect(inspector(page)).toBeFocused();
    expect(await inspector(page).evaluate(element => element.tagName)).toBe("ASIDE");
    await expect(page.getByRole("dialog", { name: "Resource details" })).toHaveCount(0);
    await expect(inspector(page)).not.toHaveAttribute("aria-modal");
    await expect(inspector(page)).toContainText("detail-version-1");
    await expect(inspector(page).getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Pod dock", exact: true })).toHaveCount(0);
    await expect(grid(page, view.label).getByRole("checkbox", { name: `Select ${view.namespaced ? "team-a/" : ""}${name}`, exact: true })).not.toBeChecked();
    const reads = await calls(page, "cluster_resource_detail");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.request).toEqual(
      { clusterId: "one", sessionId: "inspector-lease", readId: expect.any(Number),
        reference: { kind: view.kind, name, namespace: view.namespaced ? "team-a" : null, uid: `uid-${view.kind}-${name}` } });
    expect(new Set(reads.map(read => read.request.readId)).size).toBe(reads.length);
    expect(await calls(page, "cluster_pod_detail")).toHaveLength(0);
    expect((await page.evaluate(() => (window as unknown as FixtureWindow).__inspectorCalls))
      .filter(call => /mutate|create|delete|stream_open/.test(call.command))).toHaveLength(0);
    const box = (await inspector(page).boundingBox())!;
    const workspace = (await page.locator('[aria-label="Resource workspace"]').boundingBox())!;
    expect(workspace.width).toBeLessThan(before.width);
    expect(box.x).toBeGreaterThanOrEqual(workspace.x + workspace.width - 1);
    expect(Math.abs(box.x + box.width - 1440)).toBeLessThanOrEqual(2);
    await page.keyboard.press("Escape"); await expect(inspector(page)).toHaveCount(0); await expect(button).toBeFocused();
    await expect.poll(async () => (await calls(page, "cluster_resource_detail_cancel")).map(read => read.request)).toEqual(reads.map(read => read.request));
  });
}

test("checkbox selection does not inspect; close button restores focus and cancels the exact detail read", async ({ page }) => {
  await fixture(page);
  const table = grid(page, "Deployments");
  const checkbox = table.getByRole("checkbox", { name: "Select team-a/sample-a", exact: true });
  await checkbox.click(); await expect(checkbox).toBeChecked(); await expect(inspector(page)).toHaveCount(0);
  expect(await calls(page, "cluster_resource_detail")).toHaveLength(0);
  const name = table.getByRole("button", { name: "sample-a", exact: true });
  await name.click(); await expect(inspector(page)).toContainText("detail-version-1");
  await inspector(page).getByRole("button", { name: /close/i }).click();
  await expect(inspector(page)).toHaveCount(0); await expect(name).toBeFocused(); await expect(checkbox).toBeChecked();
  await expect.poll(async () => (await calls(page, "cluster_resource_detail_cancel")).map(call => call.request))
    .toEqual((await calls(page, "cluster_resource_detail")).map(call => call.request));
});

const relationships = [
  ["persistent-volume-claims", "Persistent Volume Claims", "related-class", "storageClasses", "storage-classes", null, "storageClass"],
  ["persistent-volumes", "Persistent Volumes", "related-class", "storageClasses", "storage-classes", null, "storageClass"],
  ["persistent-volumes", "Persistent Volumes", "related-claim", "persistentVolumeClaims", "persistent-volume-claims", "team-b", "claim"],
  ["role-bindings", "Role Bindings", "related-role", "roles", "roles", "team-a", "roleRef"],
  ["cluster-role-bindings", "Cluster Role Bindings", "related-role", "clusterRoles", "cluster-roles", null, "roleRef"],
  ["horizontal-pod-autoscalers", "Horizontal Pod Autoscalers", "related-target", "deployments", "deployments", "team-a", "target"],
  ["vertical-pod-autoscalers", "Vertical Pod Autoscalers", "related-target", "deployments", "deployments", "team-a", "target"],
  ["pods", "Pods", "related-node", "nodes", "nodes", null, "node"],
  ["pods", "Pods", "related-owner", "replicaSets", "replica-sets", "team-a", "controlledBy"],
  ["validating-admission-policy-bindings", "Validating Admission Policy Bindings", "related-policy", "validatingAdmissionPolicies", "validating-admission-policies", null, "policy"],
] as const;
for (const [section, label, name, kind, targetSection, namespace, column] of relationships) {
  test(`${section}.${column} resolves the relationship before navigating to the exact target`, async ({ page }) => {
    await fixture(page, section);
    await grid(page, label).getByRole("row").filter({ has: page.getByRole("button", { name: "sample-a", exact: true }) })
      .getByRole("button", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`section=${targetSection}$`));
    await expect(inspector(page)).toContainText(`uid-${kind}-${name}`);
    await expect(inspector(page)).toContainText("detail-version-1");
    const reads = await calls(page, "cluster_resource_detail");
    const sourceReads = reads.filter(read => read.request.reference?.name === "sample-a");
    const targetReads = reads.filter(read => read.request.reference?.name === name);
    expect(sourceReads.length).toBeGreaterThan(0);
    expect(targetReads.length).toBeGreaterThan(0);
    expect(reads).toHaveLength(sourceReads.length + targetReads.length);
    expect(targetReads.at(-1)!.request.reference).toEqual({ kind, name, namespace, uid: `uid-${kind}-${name}` });
    expect(targetReads.at(-1)!.request).toMatchObject({ clusterId: "one", sessionId: "inspector-lease" });
    await expect(inspector(page).getByRole("alert")).toHaveCount(0);
  });
}

test("namespace links navigate to the named namespace, not a guessed row", async ({ page }) => {
  await fixture(page);
  await grid(page, "Deployments").getByRole("button", { name: "team-a", exact: true }).first().click();
  await expect(page).toHaveURL(/section=namespaces$/);
  await expect(inspector(page)).toContainText("uid-namespaces-team-a");
  expect((await calls(page, "cluster_resource_detail"))[0].request.reference).toEqual({ kind: "namespaces", namespace: null, name: "team-a" });
});

test("missing relationship fails honestly without navigating", async ({ page }) => {
  await fixture(page, "persistent-volumes", { missingRelation: true });
  await grid(page, "Persistent Volumes").getByRole("button", { name: "related-claim", exact: true }).first().click();
  await expect(inspector(page).getByRole("alert")).toContainText("relationship is no longer available");
  await expect(page).toHaveURL(/section=persistent-volumes$/);
  expect((await calls(page, "cluster_resource_detail")).every(read => read.request.reference?.name === "sample-a")).toBe(true);
});

for (const [error, message] of [["conflict", "resource was replaced"], ["notFound", "no longer available"], ["resourceUnavailable", "no longer available"]]) {
  test(`${error} detail error never fabricates metadata`, async ({ page }) => {
    await fixture(page, "deployments", { error });
    await grid(page, "Deployments").getByRole("button", { name: "sample-a", exact: true }).click();
    await expect(inspector(page).getByRole("alert")).toContainText(message);
    await expect(inspector(page)).not.toContainText("detail-version-1");
    await expect(inspector(page).getByRole("button", { name: "Refresh details", exact: true })).toBeEnabled();
  });
}

for (const malformed of ["readId", "session", "uid", "raw", "secret"]) {
  test(`rejects ${malformed} detail contract without exposing raw secrets`, async ({ page }) => {
    await fixture(page, "secrets", { malformed });
    await grid(page, "Secrets").getByRole("button", { name: "sample-a", exact: true }).click();
    await expect(inspector(page).getByRole("alert")).toContainText("unsupported response");
    await expect(inspector(page)).not.toContainText("detail-version-1");
    await expect(page.locator("body")).not.toContainText("PRIVATE_SECRET_VALUE");
  });
}

test("late old detail cannot overwrite the latest selection and each disposal cancels its own read", async ({ page }) => {
  await fixture(page, "deployments", { holdName: "sample-a", revision: "old-response" });
  await grid(page, "Deployments").getByRole("button", { name: "sample-a", exact: true }).click();
  await expect(inspector(page).getByText("Loading resource details…", { exact: true })).toBeVisible();
  await expect(inspector(page).getByRole("button", { name: "Refresh details", exact: true })).toBeDisabled();
  await control(page, { revision: "latest-response" });
  await grid(page, "Deployments").getByRole("button", { name: "sample-b", exact: true }).click();
  await expect(inspector(page)).toContainText("latest-response");
  await release(page); await expect(inspector(page)).not.toContainText("old-response");
  await expect(inspector(page)).toContainText("uid-deployments-sample-b");
  await page.keyboard.press("Escape");
  const reads = await calls(page, "cluster_resource_detail");
  await expect.poll(async () => (await calls(page, "cluster_resource_detail_cancel")).map(call => call.request)).toEqual(reads.map(call => call.request));
  await page.waitForTimeout(650);
  expect(await calls(page, "cluster_resource_detail")).toEqual(reads);
});

test("closing a loading relationship ignores late completion and never navigates or reads after disposal", async ({ page }) => {
  await fixture(page, "pods", { holdName: "sample-a" });
  await grid(page, "Pods").getByRole("button", { name: "related-owner", exact: true }).first().click();
  await expect(inspector(page).getByText("Loading resource details…", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await release(page);
  await page.waitForTimeout(650);
  await expect(inspector(page)).toHaveCount(0); await expect(page).toHaveURL(/section=pods$/);
  expect((await calls(page, "cluster_resource_detail")).every(read => read.request.reference?.name === "sample-a")).toBe(true);
  await expect.poll(async () => (await calls(page, "cluster_resource_detail_cancel")).map(read => read.request))
    .toEqual((await calls(page, "cluster_resource_detail")).map(read => read.request));
});

test("failed refresh marks retained metadata stale and recovery replaces it", async ({ page }) => {
  await fixture(page);
  await grid(page, "Deployments").getByRole("button", { name: "sample-a", exact: true }).click();
  await expect(inspector(page)).toContainText("detail-version-1");
  await control(page, { error: "resourceUnavailable" });
  await inspector(page).getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect(inspector(page).getByRole("alert")).toContainText("Retained details may be stale.");
  await expect(inspector(page)).toContainText("detail-version-1");
  await control(page, { error: "", revision: "detail-version-2" });
  await inspector(page).getByRole("button", { name: "Refresh details", exact: true }).click();
  await expect(inspector(page)).toContainText("detail-version-2"); await expect(inspector(page)).not.toContainText("detail-version-1");
  await expect(inspector(page).getByRole("alert")).toHaveCount(0);
});

for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"] as const) {
  test(`inspector stays inside viewport with internal scrolling at ${width}, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme }); await fixture(page, "resource-quotas");
    await page.setViewportSize({ width, height: 650 });
    await grid(page, "Resource Quotas").getByRole("button", { name: "sample-a", exact: true }).click();
    await expect(inspector(page)).toContainText("detail-version-1");
    const bounds = (await inspector(page).boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(-1); expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    const workspace = (await page.locator('[aria-label="Resource workspace"]').boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(workspace.x + workspace.width - 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(651);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await inspector(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await inspector(page).evaluate(element => {
      const scroll = [element, ...Array.from(element.querySelectorAll("*"))].find(candidate => {
        const style = getComputedStyle(candidate);
        return ["auto", "scroll"].includes(style.overflowY) && candidate.scrollHeight > candidate.clientHeight;
      });
      if (!scroll) return false;
      scroll.scrollTop = scroll.scrollHeight;
      return scroll.scrollTop > 0;
    })).toBe(true);
    const close = inspector(page).getByRole("button", { name: /close/i });
    await expect(close).toBeInViewport();
    await close.click(); await expect(inspector(page)).toHaveCount(0);
  });
}

test("Pod detail uses the Pod API in the inspector, never the bottom dock or generic detail API", async ({ page }) => {
  await fixture(page, "pods");
  const name = grid(page, "Pods").getByRole("button", { name: "sample-a", exact: true });
  await name.click(); await expect(inspector(page)).toBeVisible();
  await expect(inspector(page)).toContainText("pod-detail-version");
  await expect(page.getByRole("complementary", { name: "Pod dock", exact: true })).toHaveCount(0);
  expect((await calls(page, "cluster_pod_detail"))[0].request).toEqual({ clusterId: "one", sessionId: "inspector-lease", namespace: "team-a", name: "sample-a", uid: "uid-pods-sample-a" });
  expect(await calls(page, "cluster_resource_detail")).toHaveLength(0);
  await expect(grid(page, "Pods").getByRole("checkbox", { name: "Select team-a/sample-a", exact: true })).not.toBeChecked();
  await page.keyboard.press("Escape"); await expect(name).toBeFocused();
});

test("Pod health icons and status badges distinguish healthy, warning, completed, terminating and unknown", async ({ page }) => {
  await fixture(page, "pods");
  for (const [name, health, status, variant] of [
    ["sample-a", "Ready: all required containers and readiness gates are ready", "Running", "neutral"],
    ["pod-warning", "Pod needs attention: Crash Loop Back Off", "CrashLoopBackOff", "error"],
    ["pod-completed", "Completed: Pod finished successfully", "Succeeded", "neutral"],
    ["pod-terminating", "Terminating: Pod shutdown is in progress", "Terminating", "warning"],
    ["pod-unknown", "Pod readiness unknown", "Unknown", "neutral"],
  ]) {
    const row = grid(page, "Pods").getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) });
    await expect(row.getByRole("img", { name: health, exact: true })).toBeVisible();
    await expect(row.locator(".astryx-badge").filter({ hasText: new RegExp(`^${status}$`) })).toHaveAttribute("data-variant", variant);
  }
  expect(await calls(page, "cluster_resource_detail")).toHaveLength(0);
  expect(await calls(page, "cluster_pod_detail")).toHaveLength(0);
});

for (const [section, label, title, fact, value] of [
  ["deployments", "Deployments", "Replica status", "Available replicas", "3 of 4 replicas"],
  ["services", "Services", "Service ports", "https", "443/TCP → 8443"],
  ["roles", "Roles", "Policy rules", "Resources", "pods: get, list, watch"],
]) test(`${section} renders reviewed section-specific facts from the detail contract`, async ({ page }) => {
  await fixture(page, section, { sections: [{ title, facts: [{ label: fact, value }] }] });
  await grid(page, label).getByRole("button", { name: "sample-a", exact: true }).click();
  await expect(inspector(page).getByText(title, { exact: true })).toBeVisible();
  await expect(inspector(page).getByText(fact, { exact: true })).toBeVisible();
  await expect(inspector(page).getByText(value, { exact: true })).toBeVisible();
  await expect(inspector(page).getByRole("alert")).toHaveCount(0);
});
