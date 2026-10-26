import { expect, test, type Page } from "@playwright/test";
import { resourceCreation, resourceViews } from "../src/app/cluster/resourceViews";

type Request = Record<string, string | number | boolean | null>;
type Call = { command: string; request: Request };
type Controls = { hold?: boolean; failure?: string; malformed?: string; postName?: string; postFailure?: string };
type MockWindow = Window & { __createCalls: Call[]; __createControls: Controls; __releaseCreate: () => void; __unexpectedCreateCommands: string[]; __createEvents: string[] };
const registry = [
  ["nodes", "nodes", "Node", "v1", false],
  ["namespaces", "namespaces", "Namespace", "v1", false],
  ["pods", "pods", "Pod", "v1", true],
  ["deployments", "deployments", "Deployment", "apps/v1", true],
  ["daemon-sets", "daemonSets", "DaemonSet", "apps/v1", true],
  ["stateful-sets", "statefulSets", "StatefulSet", "apps/v1", true],
  ["replica-sets", "replicaSets", "ReplicaSet", "apps/v1", true],
  ["replication-controllers", "replicationControllers", "ReplicationController", "v1", true],
  ["jobs", "jobs", "Job", "batch/v1", true],
  ["cron-jobs", "cronJobs", "CronJob", "batch/v1", true],
  ["config-maps", "configMaps", "ConfigMap", "v1", true],
  ["secrets", "secrets", "Secret", "v1", true],
  ["resource-quotas", "resourceQuotas", "ResourceQuota", "v1", true],
  ["limit-ranges", "limitRanges", "LimitRange", "v1", true],
  ["horizontal-pod-autoscalers", "horizontalPodAutoscalers", "HorizontalPodAutoscaler", "autoscaling/v2", true],
  ["vertical-pod-autoscalers", "verticalPodAutoscalers", "VerticalPodAutoscaler", "autoscaling.k8s.io/v1", true],
  ["pod-disruption-budgets", "podDisruptionBudgets", "PodDisruptionBudget", "policy/v1", true],
  ["priority-classes", "priorityClasses", "PriorityClass", "scheduling.k8s.io/v1", false],
  ["runtime-classes", "runtimeClasses", "RuntimeClass", "node.k8s.io/v1", false],
  ["leases", "leases", "Lease", "coordination.k8s.io/v1", true],
  ["services", "services", "Service", "v1", true],
  ["endpoints", "endpoints", "Endpoints", "v1", true],
  ["endpoint-slices", "endpointSlices", "EndpointSlice", "discovery.k8s.io/v1", true],
  ["ingresses", "ingresses", "Ingress", "networking.k8s.io/v1", true],
  ["ingress-classes", "ingressClasses", "IngressClass", "networking.k8s.io/v1", false],
  ["network-policies", "networkPolicies", "NetworkPolicy", "networking.k8s.io/v1", true],
  ["mutating-webhook-configs", "mutatingWebhookConfigurations", "MutatingWebhookConfiguration", "admissionregistration.k8s.io/v1", false],
  ["validating-webhook-configs", "validatingWebhookConfigurations", "ValidatingWebhookConfiguration", "admissionregistration.k8s.io/v1", false],
  ["validating-admission-policies", "validatingAdmissionPolicies", "ValidatingAdmissionPolicy", "admissionregistration.k8s.io/v1", false],
  ["validating-admission-policy-bindings", "validatingAdmissionPolicyBindings", "ValidatingAdmissionPolicyBinding", "admissionregistration.k8s.io/v1", false],
  ["pod-security-policies", "podSecurityPolicies", "PodSecurityPolicy", "policy/v1beta1", false],
  ["persistent-volumes", "persistentVolumes", "PersistentVolume", "v1", false],
  ["persistent-volume-claims", "persistentVolumeClaims", "PersistentVolumeClaim", "v1", true],
  ["storage-classes", "storageClasses", "StorageClass", "storage.k8s.io/v1", false],
  ["events", "events", "Event", "v1", true],
  ["service-accounts", "serviceAccounts", "ServiceAccount", "v1", true],
  ["roles", "roles", "Role", "rbac.authorization.k8s.io/v1", true],
  ["role-bindings", "roleBindings", "RoleBinding", "rbac.authorization.k8s.io/v1", true],
  ["cluster-roles", "clusterRoles", "ClusterRole", "rbac.authorization.k8s.io/v1", false],
  ["cluster-role-bindings", "clusterRoleBindings", "ClusterRoleBinding", "rbac.authorization.k8s.io/v1", false],
  ["custom-resource-definitions", "customResourceDefinitions", "CustomResourceDefinition", "apiextensions.k8s.io/v1", false],
] as const;
const dialog = (page: Page) => page.getByRole("dialog");
const editor = (page: Page) => dialog(page).getByRole("textbox", { name: "Resource YAML", exact: true });

test("late old dry-run cannot approve or cancel a new dialog's pending validation", async ({ page }) => {
  await fixture(page); await openEditor(page); await controls(page, { hold: true }); await validate(page);
  const old = (await calls(page))[0].request;
  await dialog(page).getByRole("button", { name: "Cancel request", exact: true }).click();
  await openEditor(page); await validate(page, manifest.replace("héllo 🌨", "new dialog"));
  const current = (await calls(page))[1].request;
  expect(current.readId).toBeGreaterThan(old.readId as number);
  await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
  await expect.poll(async () => (await calls(page, "cluster_resource_create_cancel")).map(c => c.request)).toEqual([cancelScope(old)]);
  await release(page);
  await expect(dialog(page)).toContainText("Server dry-run passed");
  await dialog(page).getByRole("button", { name: "Create ConfigMap", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const post = (await calls(page))[2].request;
  expect(post).toEqual({ ...current, readId: expect.any(Number), dryRun: false });
  expect(await calls(page, "cluster_resource_create_cancel")).toHaveLength(1);
});

test("cluster-scoped creation sends null namespace through dry-run and confirm", async ({ page }) => {
  await fixture(page, "priority-classes"); await openEditor(page);
  const yaml = "apiVersion: scheduling.k8s.io/v1\nkind: PriorityClass\nmetadata:\n  name: sample\nvalue: 1000\n";
  await validate(page, yaml);
  await expect(dialog(page)).toContainText("Server dry-run passed");
  await expect(dialog(page)).toContainText("Namespace: Cluster-scoped");
  await dialog(page).getByRole("button", { name: "Create PriorityClass", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const requests = (await calls(page)).map(call => call.request);
  expect(requests).toHaveLength(2);
  expect(requests.map(request => request.namespace)).toEqual([null, null]);
  expect(requests.map(request => request.kind)).toEqual(["priorityClasses", "priorityClasses"]);
  expect(requests.map(request => request.yaml)).toEqual([yaml, yaml]);
  expect(requests.map(request => request.dryRun)).toEqual([true, false]);
});
const calls = (page: Page, command = "cluster_resource_create") => page.evaluate(command => (window as MockWindow).__createCalls.filter(call => call.command === command), command);
const controls = (page: Page, value: Controls) => page.evaluate(value => Object.assign((window as MockWindow).__createControls, value), value);
const release = (page: Page) => page.evaluate(() => (window as MockWindow).__releaseCreate());
const navigate = (page: Page, section: string) => page.evaluate(section => { location.hash = `/cluster/one?section=${section}`; }, section);
const cancelScope = ({ clusterId, sessionId, kind, readId }: Request) => ({ clusterId, sessionId, kind, readId });
const manifest = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: sample\n  namespace: team-a\ndata:\n  greeting: "héllo 🌨"\n';
const uncertainty = "Creation may already have reached the API server";

async function fixture(page: Page, section = "config-maps") {
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => {
    const calls: Call[] = [], unexpected: string[] = [], events: string[] = [], pending: (() => void)[] = [];
    const control: Controls = {};
    let session = 0;
    Object.assign(window, { isTauri: true, __createCalls: calls, __createControls: control, __unexpectedCreateCommands: unexpected, __createEvents: events,
      __releaseCreate: () => { control.hold = false; pending.splice(0).forEach(resolve => resolve()); },
      __TAURI_INTERNALS__: { invoke: async (command: string, args?: { request: Request }) => {
        const r = { ...args?.request }; calls.push({ command, request: r });
        if (command === "catalog_list") return { revision: 1, discoveryError: null, webLinks: [], clusters: [
          { id: "one", name: "Development", contextName: "dev", source: "kubeconfig", labels: [], color: "#476BA1", pinned: false, status: "disconnected" },
        ] };
        if (command === "update_state") return { phase: "idle", version: null, error: null };
        if (command === "preferences_get") return null;
        if (command === "cluster_session_open" || command === "cluster_connect") return { clusterId: r.clusterId, sessionId: r.sessionId ?? `lease-${++session}`, contextName: "dev",
          status: command === "cluster_connect" ? "connected" : "disconnected", apiVersion: command === "cluster_connect" ? "v1.35.8" : null, error: null };
        if (["cluster_disconnect", "cluster_resources_cancel", "cluster_resource_create_cancel", "cluster_pod_detail_cancel"].includes(command)) return null;
        if (command === "cluster_resources") return { ...r, namespace: r.namespace ?? null, continueToken: null, truncated: false, fetchedAt: Date.now(), metrics: null,
          items: r.kind === "namespaces" ? ["team-a", "team-b", "default"].map(name => ({ name, namespace: null, status: "Active", createdAt: null, columns: {}, node: null })) :
            r.kind === "pods" ? [{ name: "api-pod", namespace: r.namespace ?? "team-a", status: "Running", createdAt: null, columns: {}, node: null }] : [] };
        if (command === "cluster_pod_detail") return { ...r, uid: "fixture-pod", resourceVersion: "1", phase: "Running", node: null, podIps: [], hostIps: [], serviceAccount: null,
          qos: null, createdAt: null, deletionTimestamp: null, containers: [], conditions: [], yaml: "", events: [] };
        if (command === "cluster_resource_create") {
          const options = { ...control };
          if (options.hold) await new Promise<void>(resolve => pending.push(resolve));
          if (options.failure || !r.dryRun && options.postFailure) throw options.failure || options.postFailure;
          const namespaced = !["nodes", "namespaces", "priorityClasses", "runtimeClasses", "mutatingWebhookConfigurations", "validatingWebhookConfigurations", "validatingAdmissionPolicies", "validatingAdmissionPolicyBindings", "ingressClasses", "persistentVolumes", "storageClasses", "clusterRoles", "clusterRoleBindings", "podSecurityPolicies", "customResourceDefinitions"].includes(String(r.kind));
          const result: Record<string, unknown> = { clusterId: r.clusterId, sessionId: r.sessionId, kind: r.kind, namespace: namespaced ? r.namespace ?? "team-a" : null,
            name: !r.dryRun && options.postName ? options.postName : "sample", created: !r.dryRun };
          if (options.malformed === "null") return null;
          if (options.malformed === "array") return [];
          if (options.malformed === "clusterId") result.clusterId = "other";
          if (options.malformed === "sessionId") result.sessionId = "old-session";
          if (options.malformed === "kind") result.kind = "pods";
          if (options.malformed === "namespace") result.namespace = "team-b";
          if (options.malformed === "missingNamespace") delete result.namespace;
          if (options.malformed === "created") result.created = r.dryRun;
          if (options.malformed === "name") result.name = "INVALID/name";
          if (options.malformed === "missingName") delete result.name;
          return result;
        }
        if (command === "plugin:event|emit" || command === "plugin:event|emit_to") events.push(JSON.stringify(args));
        unexpected.push(command); throw `Unexpected fixture command: ${command}`;
      } },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/cluster/one?section=${section}`);
  await expect(page.getByRole("button", { name: /^(?:Create |Add Namespace$)/ }).first()).toBeVisible();
}
async function openEditor(page: Page) {
  await page.getByRole("button", { name: /^(?:Create |Add Namespace$)/ }).first().click();
  await expect(editor(page)).toBeVisible();
}
async function validate(page: Page, yaml = manifest) {
  await editor(page).fill(yaml);
  await dialog(page).getByRole("button", { name: "Validate YAML", exact: true }).click();
}
async function namespace(page: Page, name: string) {
  await expect(page.getByText("Loading namespaces…", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Namespace(?:\s|$)/ }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as MockWindow).__unexpectedCreateCommands ?? [])).toEqual([]);
});

test("registry covers every supported create kind with no service placeholder", () => {
  expect(registry.map(row => row[1]).sort()).toEqual(Object.keys(resourceCreation).sort());
  expect(registry.filter(row => row[1] !== "nodes").map(row => row[1]).sort()).toEqual(resourceViews.flatMap(view => view.kind ? [view.kind] : []).sort());
});
for (const [section, kind, kubeKind, apiVersion, namespaced] of registry) {
  test(`${kind}: FAB opens the expected metadata-only scaffold`, async ({ page }) => {
    await fixture(page, section); await openEditor(page);
    await expect(editor(page)).toHaveText(`apiVersion: ${apiVersion}\nkind: ${kubeKind}\nmetadata:\n  name: ""\n`);
    await expect(dialog(page)).toContainText(`Kind: ${kubeKind} (${apiVersion})`);
    await expect(dialog(page)).toContainText(namespaced ? "From manifest; default if omitted" : "Cluster-scoped");
    await expect(dialog(page).getByLabel("Creation target")).toContainText("Cluster: Development");
    expect(await calls(page)).toEqual([]);
    await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await calls(page, "cluster_resource_create_cancel")).toEqual([]);
  });
}

test("dry-run precedes explicit confirm; IPC preserves exact UTF-8 YAML and scoped identity; success refreshes", async ({ page }) => {
  await fixture(page); await namespace(page, "team-a"); await openEditor(page);
  await expect(editor(page)).toHaveText(/namespace: team-a\n$/);
  const reads = (await calls(page, "cluster_resources")).filter(c => c.request.kind === "configMaps").length;
  await validate(page);
  await expect(dialog(page)).toContainText("Server dry-run passed");
  await expect(editor(page)).toHaveCount(0);
  await expect(dialog(page)).toContainText("Name: sample");
  await expect(dialog(page)).toContainText("Context: dev");
  const dry = (await calls(page))[0].request;
  expect(dry).toEqual({ clusterId: "one", sessionId: expect.stringMatching(/^lease-/), kind: "configMaps", readId: expect.any(Number), namespace: "team-a", yaml: manifest, dryRun: true });
  expect(Number.isSafeInteger(dry.readId)).toBe(true); expect(dry.readId).toBeGreaterThan(0);
  expect(await calls(page)).toHaveLength(1);
  await dialog(page).getByRole("button", { name: "Create ConfigMap", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const post = (await calls(page))[1].request;
  expect(post).toEqual({ ...dry, readId: expect.any(Number), dryRun: false });
  expect(post.readId).toBeGreaterThan(dry.readId as number);
  expect([...new TextEncoder().encode(String(post.yaml))]).toEqual([...new TextEncoder().encode(manifest)]);
  await expect.poll(async () => (await calls(page, "cluster_resources")).filter(c => c.request.kind === "configMaps").length).toBe(reads + 1);
  await expect(page.getByRole("status").filter({ hasText: "ConfigMap created" })).toBeVisible();
});

test("Edit YAML invalidates approval and requires a fresh dry-run even before further editing", async ({ page }) => {
  await fixture(page); await openEditor(page); await validate(page);
  await dialog(page).getByRole("button", { name: "Edit YAML", exact: true }).click();
  await expect(editor(page)).toHaveText(manifest);
  await expect(dialog(page).getByRole("button", { name: "Create ConfigMap", exact: true })).toHaveCount(0);
  const changed = manifest.replace("héllo 🌨", "changed");
  await validate(page, changed);
  await expect(dialog(page)).toContainText("Server dry-run passed");
  const requests = await calls(page);
  expect(requests.map(c => c.request.dryRun)).toEqual([true, true]);
  expect(requests[1].request.yaml).toBe(changed);
  expect(requests[1].request.readId).toBeGreaterThan(requests[0].request.readId as number);
});

for (const [failure, message] of [
  ["invalidInput", "manifest was rejected"], ["permissionDenied", "RBAC create permissions"],
  ["resourceUnavailable", "API is not available"], ["conflict", "does not overwrite"],
  ["network", "could not be reached"], ["timeout", "timed out"], ["raw diagnostic synthetic-secret-9x", "operation failed"],
]) test(`dry-run ${failure}: retain YAML, safe actionable error, never POST`, async ({ page }) => {
  await fixture(page); await controls(page, { failure }); await openEditor(page); await validate(page);
  await expect(dialog(page).getByRole("alert")).toContainText(message);
  await expect(dialog(page).getByRole("alert")).not.toContainText("synthetic-secret-9x");
  await expect(editor(page)).toHaveText(manifest);
  expect((await calls(page)).map(c => c.request.dryRun)).toEqual([true]);
  await controls(page, { failure: "" });
  await dialog(page).getByRole("button", { name: "Validate YAML", exact: true }).click();
  await expect(dialog(page)).toContainText("Server dry-run passed");
});

for (const malformed of ["null", "array", "clusterId", "sessionId", "kind", "namespace", "missingNamespace", "created", "name", "missingName"]) {
  test(`rejects malformed dry-run ${malformed} without losing YAML or enabling POST`, async ({ page }) => {
    await fixture(page); await namespace(page, "team-a"); await controls(page, { malformed }); await openEditor(page); await validate(page);
    await expect(dialog(page).getByRole("alert")).toContainText("unsupported response");
    await expect(editor(page)).toHaveText(manifest);
    expect((await calls(page)).map(c => c.request.dryRun)).toEqual([true]);
  });
}

test("empty and whitespace manifests cannot validate or invoke IPC", async ({ page }) => {
  await fixture(page); await openEditor(page); await editor(page).fill("   \n");
  await expect(dialog(page).getByRole("button", { name: "Validate YAML", exact: true })).toBeDisabled();
  expect(await calls(page)).toEqual([]);
});
test("UTF-8 byte limit rejects before IPC and preserves the oversized editor contents", async ({ page }) => {
  await fixture(page); await openEditor(page);
  const yaml = manifest + "#" + "é".repeat(132000);
  await validate(page, yaml);
  await expect(dialog(page).getByRole("alert")).toContainText("256 KiB");
  await expect(editor(page)).toHaveText(yaml);
  expect(await calls(page)).toEqual([]);
});

for (const phase of ["dry-run", "post"] as const) test(`duplicate ${phase} activation is guarded while pending`, async ({ page }) => {
  await fixture(page); await openEditor(page);
  if (phase === "post") { await validate(page); await expect(dialog(page)).toContainText("Server dry-run passed"); }
  else await editor(page).fill(manifest);
  await controls(page, { hold: true });
  const button = dialog(page).getByRole("button", { name: phase === "post" ? "Create ConfigMap" : "Validate YAML", exact: true });
  await button.evaluate(node => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); node.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await expect.poll(async () => (await calls(page)).length).toBe(phase === "post" ? 2 : 1);
  if (phase === "dry-run") await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
  await release(page);
  if (phase === "post") await expect(dialog(page)).toHaveCount(0);
  else await expect(dialog(page)).toContainText("Server dry-run passed");
  expect(await calls(page)).toHaveLength(phase === "post" ? 2 : 1);
});

for (const disposal of ["cancel", "escape", "route", "session", "namespace"] as const) test(`${disposal} disposes a pending dry-run with exact cancellation; late success cannot mutate`, async ({ page }) => {
  await fixture(page); await openEditor(page); await controls(page, { hold: true }); await validate(page);
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const dry = (await calls(page))[0].request;
  if (disposal === "cancel") await dialog(page).getByRole("button", { name: "Cancel request", exact: true }).click();
  if (disposal === "escape") await page.keyboard.press("Escape");
  if (disposal === "route") await navigate(page, "services");
  if (disposal === "session") await page.evaluate(() => { location.hash = "/catalog"; });
  if (disposal === "namespace") {
    // Synthetic events exercise owner disposal while the modal makes background controls inert to a pointer.
    await page.getByRole("button", { name: /^Namespace(?:\s|$)/, includeHidden: true }).evaluate(node => (node as HTMLButtonElement).click());
    await page.getByRole("option", { name: "team-b", exact: true, includeHidden: true }).dispatchEvent("click");
  }
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page, "cluster_resource_create_cancel")).map(c => c.request)).toEqual([cancelScope(dry)]);
  await release(page);
  if (disposal === "session") { await navigate(page, "config-maps"); await expect(page.getByRole("button", { name: "Create ConfigMap", exact: true })).toBeVisible(); }
  await openEditor(page);
  if (disposal === "session") {
    const opened = await calls(page, "cluster_session_open");
    expect(opened.length).toBeGreaterThan(1);
    const connected = (await calls(page, "cluster_connect")).at(-1)!.request;
    expect(connected.sessionId).not.toBe(dry.sessionId);
  }
  await expect(editor(page)).not.toHaveText(manifest);
  await expect(dialog(page)).not.toContainText("Server dry-run passed");
  expect((await calls(page)).map(c => c.request.dryRun)).toEqual([true]);
  expect(await calls(page, "cluster_resource_create_cancel")).toHaveLength(1);
});

test("cancel after POST warns of uncertainty, cancels exactly that POST, and ignores late success", async ({ page }) => {
  await fixture(page); await openEditor(page); await validate(page);
  await expect(dialog(page)).toContainText("Server dry-run passed");
  const reads = (await calls(page, "cluster_resources")).length;
  await controls(page, { hold: true });
  await dialog(page).getByRole("button", { name: "Create ConfigMap", exact: true }).click();
  await expect(dialog(page)).toContainText(uncertainty);
  const post = (await calls(page))[1].request;
  await dialog(page).getByRole("button", { name: "Cancel request", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: uncertainty })).toBeVisible();
  await expect.poll(async () => (await calls(page, "cluster_resource_create_cancel")).map(c => c.request)).toEqual([cancelScope(post)]);
  await release(page); await openEditor(page);
  await expect(editor(page)).not.toHaveText(manifest);
  expect(await calls(page, "cluster_resources")).toHaveLength(reads);
  expect((await calls(page)).map(c => c.request.dryRun)).toEqual([true, false]);
});

for (const failure of ["conflict", "network", "identity"] as const) test(`POST ${failure} retains YAML, removes approval and never assumes success`, async ({ page }) => {
  await fixture(page); await openEditor(page); await validate(page); await expect(dialog(page)).toContainText("Server dry-run passed");
  const reads = await calls(page, "cluster_resources");
  await controls(page, failure === "identity" ? { postName: "different" } : { postFailure: failure });
  await dialog(page).getByRole("button", { name: "Create ConfigMap", exact: true }).click();
  await expect(editor(page)).toHaveText(manifest);
  await expect(dialog(page).getByRole("alert")).toContainText(failure === "conflict" ? "already exists" : failure === "identity" ? "unsupported response" : "could not be reached");
  await expect(dialog(page)).toContainText(uncertainty);
  expect(await calls(page, "cluster_resources")).toEqual(reads);
  await expect(dialog(page).getByRole("button", { name: "Validate YAML", exact: true })).toBeVisible();
});

test("Secret values are hidden from confirmation, statuses, console, events, storage and non-create IPC", async ({ page }) => {
  const logs: string[] = []; page.on("console", message => logs.push(message.text()));
  await fixture(page, "secrets"); await openEditor(page);
  const marker = "synthetic-secret-9x";
  const yaml = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: sample\nstringData:\n  token: ${marker}\n`;
  await validate(page, yaml); await expect(dialog(page)).toContainText("Server dry-run passed");
  await expect(page.locator("body")).not.toContainText(marker);
  await expect(editor(page)).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Create Secret", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(logs.join("\n")).not.toContain(marker);
  const retained = await page.evaluate(() => ({ calls: (window as MockWindow).__createCalls.filter(c => c.command !== "cluster_resource_create"),
    events: (window as MockWindow).__createEvents, local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }));
  expect(JSON.stringify(retained)).not.toContain(marker);
  expect((await calls(page)).map(c => c.request.yaml)).toEqual([yaml, yaml]);
});

for (const width of [1440, 390]) test(`FAB remains visible and clickable at ${width}px with Pod dock`, async ({ page }) => {
  await fixture(page, "pods");
  await page.getByRole("table", { name: "Pods", exact: true }).getByRole("button", { name: "api-pod", exact: true }).click();
  const details = page.getByRole("region", { name: "Resource details", exact: true });
  await details.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Pod dock", exact: true })).toBeVisible();
  await page.setViewportSize({ width, height: 900 });
  const fab = page.getByRole("button", { name: "Create Pod", exact: true });
  await expect(fab).toBeInViewport();
  const bounds = await fab.boundingBox(); expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await fab.click(); await expect(editor(page)).toBeVisible();
});
