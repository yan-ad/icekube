/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";

const script = process.env.FREELENS_TAURI_BACKEND;
const profile = process.env.FREELENS_TAURI_PROFILE;

assert.ok(
  script && profile && process.env.FREELENS_TAURI_KUBECONFIG_ROOTS,
  "Run through pnpm test:tauri so the backend is built and isolated",
);

const exchange = async (input, env = {}) => {
  const child = spawn(process.execPath, [script], {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
    env: { ...process.env, ...env },
  });
  const output = [];
  const errors = [];

  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const closed = once(child, "close");

  child.stdin.end(input);

  const [code, signal] = await closed;

  assert.equal(signal, null);
  assert.equal(code, 0, Buffer.concat(errors).toString());
  assert.equal(Buffer.concat(errors).toString(), "");

  assert.equal(existsSync(join(dirname(profile), "exec-must-not-run")), false);

  return {
    wire: Buffer.concat(output).toString(),
    pid: child.pid,
    responses: Buffer.concat(output)
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
};

const line = (request) => `${JSON.stringify(request)}\n`;
const initialize = { id: 1, method: "initialize", appData: profile };

test("lists real fixture Pods through the supervised worker without exposing credentials", {
  timeout: 20_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "freelens-pods-protocol-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  let deny = false;
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      authorized: request.headers.authorization === "Bearer fixture-auth-secret",
    });
    response.setHeader("content-type", "application/json");
    if (deny) {
      response.writeHead(403).end(JSON.stringify({ message: "fixture-auth-secret" }));
      return;
    }
    const next = new URL(request.url, "http://localhost").searchParams.get("continue");
    response.end(
      JSON.stringify({
        apiVersion: "v1",
        kind: "PodList",
        metadata: { continue: next ? "" : "page-two" },
        items: [
          {
            apiVersion: "v1",
            kind: "Pod",
            metadata: {
              uid: next ? "second-pod" : "first-pod",
              name: next ? "second-pod" : "first-pod",
              namespace: "team",
              creationTimestamp: "2026-01-01T00:00:00Z",
            },
            spec: {
              containers: [
                { name: "app", image: "private-image", env: [{ name: "SECRET", value: "fixture-auth-secret" }] },
              ],
            },
            status: {
              phase: "Running",
              containerStatuses: [{ name: "app", ready: true, restartCount: 1, state: { running: {} } }],
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const config = join(await realpath(directory), "config");
  await writeFile(
    config,
    JSON.stringify({
      clusters: [
        {
          name: "fixture",
          cluster: { server: `http://127.0.0.1:${server.address().port}`, "insecure-skip-tls-verify": true },
        },
      ],
      users: [{ name: "fixture", user: { token: "fixture-auth-secret" } }],
      contexts: [{ name: "fixture", context: { cluster: "fixture", user: "fixture" } }],
    }),
    { mode: 0o600 },
  );
  const clusterId = createHash("md5").update(`${config}:fixture`).digest("hex");
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, FREELENS_TAURI_KUBECONFIG_ROOTS: JSON.stringify([config]) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  const responses = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let id = 0;
  const request = async (method, fields = {}) => {
    child.stdin.write(line({ id: ++id, method, ...fields }));
    const received = await responses.next();
    assert.equal(received.done, false);
    assert.doesNotMatch(received.value, /fixture-auth-secret|private-image|canonicalPath|authorization|SECRET/);
    const result = JSON.parse(received.value);
    assert.equal(result.id, id);
    return result;
  };
  await request("initialize", { appData: join(directory, "profile") });
  const initial = await request("pods.list", { clusterId, namespace: null });
  assert.equal(initial.result.error, null);
  assert.deepEqual(
    initial.result.pods.map((pod) => pod.name),
    ["first-pod", "second-pod"],
  );
  assert.equal(initial.result.pods[0].restartCount, 1);
  assert.equal(initial.result.pods[0].cpu, null);
  assert.deepEqual(initial.result.namespaces, ["team"]);
  assert.ok(
    requests.every((entry) => entry.method === "GET" && entry.authorized && entry.path.startsWith("/api/v1/pods?")),
  );
  const scoped = await request("pods.list", { clusterId, namespace: "team" });
  assert.equal(scoped.result.error, null);
  assert.ok(requests.slice(2).every((entry) => entry.path.startsWith("/api/v1/namespaces/team/pods?")));
  const before = requests.length;
  const invalid = await request("pods.list", { clusterId, namespace: "team", url: "https://untrusted.invalid" });
  assert.match(invalid.error, /unsupported keys/);
  assert.equal(requests.length, before);
  deny = true;
  assert.equal((await request("pods.list", { clusterId, namespace: null })).result.error, "FORBIDDEN");
  deny = false;
  assert.equal((await request("pods.list", { clusterId, namespace: null })).result.error, null);
  const closed = once(child, "close");
  child.stdin.end();
  assert.deepEqual(await closed, [0, null]);
  assert.equal(stderr, "");
});

test("boots real Node with the existing lifecycle and profile policy, then exits at EOF", async () => {
  const { pid, responses } = await exchange(line(initialize) + line({ id: 2, method: "status" }));
  const expected = {
    protocolVersion: 1,
    runtime: "node",
    nodeVersion: process.versions.node,
    processId: pid,
    userData: join(profile, "Freelens"),
    sessionData: join(profile, "Freelens"),
    phases: ["before-anything", "before-host-ready", "host-ready", "application-started"],
  };

  assert.deepEqual(responses, [
    { id: 1, result: expected },
    { id: 2, result: expected },
  ]);
  assert.equal(existsSync(profile), false, "bootstrap must not touch profile data");
  assert.throws(() => process.kill(pid, 0));
});

test("rejects premature status and repeated initialization without losing request ordering", async () => {
  const { responses } = await exchange(
    line({ id: 9, method: "status" }) +
      line(initialize) +
      line({ ...initialize, id: 3 }) +
      line({ id: 4, method: "status" }),
  );

  assert.deepEqual(
    responses.map(({ id }) => id),
    [9, 1, 3, 4],
  );
  assert.match(responses[0].error, /not been initialized/);
  assert.match(responses[2].error, /already been initialized/);
  assert.deepEqual(responses[1].result, responses[3].result);
});

test("rejects malformed requests and unauthorized fields, then accepts a valid request", async () => {
  const invalid = [
    "not json\n",
    "null\n",
    "[]\n",
    line({ id: 0, method: "status" }),
    line({ id: Number.MAX_SAFE_INTEGER + 1, method: "status" }),
    line({ id: 2, method: "execute", command: "anything" }),
    line({ ...initialize, appData: "relative" }),
    line({ ...initialize, appData: `${profile}\0` }),
    '{"id":3,"method":"status","__proto__":{"method":"initialize"}}\n',
  ];
  const { responses } = await exchange(invalid.join("") + line(initialize));

  assert.equal(responses.length, invalid.length + 1);
  for (const response of responses.slice(0, -1)) assert.equal(typeof response.error, "string");
  assert.equal(responses.at(-1).result.runtime, "node");
});

test("bounds oversized input and recovers at the next line", async () => {
  const { responses } = await exchange(`${"x".repeat(100_000)}\n${line(initialize)}`);

  assert.deepEqual(responses[0], { id: null, error: "Request exceeds the 16 KiB limit" });
  assert.equal(responses.length, 2);
  assert.equal(responses[1].result.runtime, "node");
});

test("accepts an unterminated final request and exits without a shutdown command", async () => {
  const { responses } = await exchange(JSON.stringify(initialize));

  assert.equal(responses.length, 1);
  assert.equal(responses[0].result.runtime, "node");
});

test("snapshots real built-ins and synthetic local discovery as plain data", async () => {
  const { responses } = await exchange(
    line({ id: 7, method: "catalog.snapshot" }) +
      line(initialize) +
      line({ id: 8, method: "catalog.snapshot", path: "/not-allowed" }) +
      line({ id: 9, method: "catalog.snapshot" }) +
      line({ id: 10, method: "catalog.snapshot" }),
  );
  assert.match(responses[0].error, /not been initialized/);
  assert.match(responses[2].error, /unsupported keys/);
  const snapshot = responses[3].result;
  assert.equal(snapshot.protocolVersion, 2);
  assert.equal(snapshot.scope, "local");
  assert.equal(snapshot.categories.length, 3);
  assert.deepEqual(
    new Set(snapshot.categories.map(({ kind }) => kind)),
    new Set(["General", "KubernetesCluster", "WebLink"]),
  );
  assert.deepEqual(
    new Set(snapshot.entities.filter(({ source }) => source === "app").map(({ id }) => id)),
    new Set(["welcome-page-entity", "catalog-entity", "preferences-entity"]),
  );
  const clusters = snapshot.entities.filter(({ kind }) => kind === "KubernetesCluster");
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].name, "fixture-cluster");
  assert.equal(clusters[0].status, "disconnected");
  assert.equal(clusters[0].source, "local");
  assert.equal(clusters[0].action, null);
  assert.deepEqual(snapshot.warnings, []);
  assert.deepEqual(responses[4], { id: 10, result: snapshot });
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /tauri-discovery-sentinel|fixture-user|fixture\.invalid|exec-must-not-run/,
  );
  assert.equal(existsSync(profile), false, "catalog composition must never read or create a profile");
});

const syntheticConfig = (name, marker) => `apiVersion: v1
kind: Config
clusters:
  - name: cluster
    cluster:
      server: https://private-endpoint.invalid
users:
  - name: private-user
    user:
      token: private-token-sentinel
      password: private-password-sentinel
      exec:
        command: ${JSON.stringify(process.execPath)}
        args: ${JSON.stringify(["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`])}
contexts:
  - name: ${name}
    context:
      cluster: cluster
      user: private-user
`;

test("discovery is read-only, refreshed, and never sends credentials or parser details over the protocol", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tauri-protocol-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, "config.yaml");
  const marker = join(root, "executed");
  const env = { FREELENS_TAURI_KUBECONFIG_ROOTS: JSON.stringify([root]), HOME: root };
  const request =
    line(initialize) + line({ id: 2, method: "catalog.snapshot" }) + line({ id: 3, method: "catalog.snapshot" });
  for (const name of ["first-context", "changed-context"]) {
    const content = syntheticConfig(name, marker);
    await writeFile(config, content, { mode: 0o600 });
    const { responses, wire } = await exchange(request, env);
    const snapshot = responses[1].result;
    assert.deepEqual(responses[2].result, snapshot);
    assert.deepEqual(
      snapshot.entities.filter(({ source }) => source === "local").map(({ name }) => name),
      [name],
    );
    assert.equal(snapshot.entities.find(({ source }) => source === "local").status, "disconnected");
    assert.doesNotMatch(
      wire,
      /private-token-sentinel|private-password-sentinel|private-user|private-endpoint|writeFileSync/,
    );
    assert.equal(existsSync(marker), false, "credential exec must never run");
    assert.equal(await readFile(config, "utf8"), content);
  }
  await writeFile(config, "token: private-token-sentinel\ninvalid: [\n");
  const { responses, wire } = await exchange(request, env);
  assert.equal(responses[1].result.entities.filter(({ source }) => source === "local").length, 0);
  assert.ok(responses[1].result.warnings.includes("KUBECONFIG_READ_OR_PARSE_FAILED"));
  assert.doesNotMatch(wire, /private-token-sentinel|YAMLException|unexpected end/);
});
