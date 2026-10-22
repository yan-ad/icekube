/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const script = process.env.FREELENS_TAURI_BACKEND;
const profile = process.env.FREELENS_TAURI_PROFILE;

assert.ok(script && profile, "Run through pnpm test:tauri so the backend is built and isolated");

const exchange = async (input) => {
  const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
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

  return {
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

test("snapshots only the real built-in catalog providers as plain data", async () => {
  const { responses } = await exchange(
    line({ id: 7, method: "catalog.snapshot" }) +
      line(initialize) +
      line({ id: 8, method: "catalog.snapshot", path: "/not-allowed" }) +
      line({ id: 9, method: "catalog.snapshot" }) +
      line({ id: 10, method: "catalog.snapshot" }),
  );
  assert.match(responses[0].error, /not been initialized/);
  assert.match(responses[2].error, /unsupported keys/);
  const expected = {
    protocolVersion: 1,
    scope: "built-in",
    categories: [
      {
        id: "entity.k8slens.dev/General",
        name: "General",
        kind: "General",
        group: "entity.k8slens.dev",
        icon: "settings",
      },
    ],
    entities: [
      {
        id: "welcome-page-entity",
        name: "Welcome Page",
        kind: "General",
        group: "entity.k8slens.dev",
        source: "app",
        status: "active",
        labels: {},
      },
      {
        id: "catalog-entity",
        name: "Catalog",
        kind: "General",
        group: "entity.k8slens.dev",
        source: "app",
        status: "active",
        labels: {},
      },
    ],
  };
  assert.deepEqual(responses[3], { id: 9, result: expected });
  assert.deepEqual(responses[4], { id: 10, result: expected });
  assert.equal(existsSync(profile), false, "catalog composition must never read or create a profile");
});
