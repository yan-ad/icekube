/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readPodsSelection } from "./pods-worker";
import type { TLSSocket } from "node:tls";

import type { PodsSnapshot } from "../../common/tauri/pods-protocol";
import type { PodsSelection } from "./pods-worker";

const token = "synthetic-tls-token-never-in-snapshot";
const openssl = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
let directory: string;
let ca: Buffer;
let serverCert: Buffer;
let serverKey: Buffer;

beforeAll(async () => {
  // Only disposable synthetic credentials are generated/read, outside the repository.
  // OpenSSL is available on the supported macOS/Linux development hosts. Capture
  // its output rather than logging key-generation diagnostics into the test run.
  directory = await realpath(await mkdtemp(path.join(tmpdir(), "freelens-pods-tls-")));
  const run = (...args: string[]) => openssl("openssl", args, { cwd: directory, timeout: 15_000 });
  await writeFile(
    path.join(directory, "ca.cnf"),
    [
      "[req]",
      "distinguished_name=dn",
      "[dn]",
      "[ca]",
      "basicConstraints=critical,CA:TRUE",
      "keyUsage=critical,keyCertSign,cRLSign",
      "subjectKeyIdentifier=hash",
      "",
    ].join("\n"),
  );
  await run(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "2",
    "-subj",
    "/CN=Freelens Synthetic Test CA",
    "-config",
    "ca.cnf",
    "-extensions",
    "ca",
    "-keyout",
    "ca-private.bin",
    "-out",
    "ca.crt",
  );
  for (const role of ["server", "client"] as const) {
    await writeFile(
      path.join(directory, `${role}.cnf`),
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        `extendedKeyUsage=${role === "server" ? "serverAuth" : "clientAuth"}`,
        ...(role === "server" ? ["subjectAltName=DNS:localhost"] : []),
        "",
      ].join("\n"),
    );
    await run(
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-config",
      "ca.cnf",
      "-subj",
      `/CN=${role === "server" ? "localhost" : "synthetic-client"}`,
      "-keyout",
      `${role}-private.bin`,
      "-out",
      `${role}.csr`,
    );
    await run(
      "x509",
      "-req",
      "-in",
      `${role}.csr`,
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca-private.bin",
      "-set_serial",
      role === "server" ? "2" : "3",
      "-days",
      "2",
      "-sha256",
      "-extfile",
      `${role}.cnf`,
      "-out",
      `${role}.crt`,
    );
  }
  [ca, serverCert, serverKey] = await Promise.all([
    readFile(path.join(directory, "ca.crt")),
    readFile(path.join(directory, "server.crt")),
    readFile(path.join(directory, "server-private.bin")),
  ]);
}, 60_000);

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function fixture(clusterOptions: Record<string, unknown> = {}, mutualTLS = false) {
  const requests: { url: string; authorization?: string; clientAuthorized: boolean; clientName?: string }[] = [];
  const sockets = new Set<TLSSocket>();
  const server = createServer(
    { key: serverKey, cert: serverCert, ca, requestCert: mutualTLS, rejectUnauthorized: mutualTLS },
    (req, res) => {
      const socket = req.socket as TLSSocket;
      const peer = socket.getPeerCertificate();
      requests.push({
        url: req.url ?? "",
        authorization: req.headers.authorization,
        clientAuthorized: socket.authorized,
        clientName: typeof peer?.subject?.CN === "string" ? peer.subject.CN : undefined,
      });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          apiVersion: "v1",
          kind: "PodList",
          metadata: {},
          items: [
            {
              apiVersion: "v1",
              kind: "Pod",
              metadata: { uid: "tls-pod", name: "tls-pod", namespace: "default" },
              spec: { containers: [{ name: "app", env: [{ name: "TOKEN", value: token }] }] },
              status: { phase: "Running" },
            },
          ],
        }),
      );
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket as TLSSocket);
    socket.once("close", () => sockets.delete(socket as TLSSocket));
  });
  // Rejected handshakes are expected inputs, not server-side test failures.
  server.on("tlsClientError", () => {});
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic HTTPS server did not bind");
  const canonicalPath = path.join(directory, `config-${address.port}`);
  const cluster = { server: `https://127.0.0.1:${address.port}`, ...clusterOptions };
  const user: Record<string, unknown> = { token };
  const config = {
    apiVersion: "v1",
    kind: "Config",
    "current-context": "selected",
    clusters: [{ name: "cluster", cluster }],
    users: [
      { name: "selected-user", user },
      { name: "unused-user", user: { "token-file": "/nonexistent/never-read" } },
    ],
    contexts: [{ name: "selected", context: { cluster: "cluster", user: "selected-user" } }],
  };
  const save = () => writeFile(canonicalPath, JSON.stringify(config), { mode: 0o600 });
  await save();
  const selection: PodsSelection = {
    canonicalPath,
    contextName: "selected",
    namespace: null,
    clusterId: createHash("md5").update(`${canonicalPath}:selected`).digest("hex"),
  };
  return { selection, requests, cluster, user, save };
}

function expectSanitized(snapshot: PodsSnapshot) {
  const serialized = JSON.stringify(snapshot);
  expect(serialized).not.toContain(token);
  expect(serialized).not.toContain(directory);
  expect(serialized).not.toMatch(/BEGIN (?:CERTIFICATE|.*PRIVATE KEY)|authorization|canonicalPath|127\.0\.0\.1/);
}

function expectSuccess(snapshot: PodsSnapshot) {
  expect(snapshot.error).toBeNull();
  expect(snapshot.pods.map((pod) => pod.uid)).toEqual(["tls-pod"]);
  expectSanitized(snapshot);
}

describe("Pods custom transport with synthetic HTTPS", () => {
  it("rejects an untrusted server by default without sending the bearer token", async () => {
    const { selection, requests } = await fixture({ "tls-server-name": "localhost" });
    const snapshot = await readPodsSelection(selection);
    expect(snapshot.error).toBe("TLS_ERROR");
    expect(snapshot.pods).toEqual([]);
    expect(requests).toEqual([]);
    expectSanitized(snapshot);
  });

  it("uses the selected relative CA path and TLS server name for an IP URL", async () => {
    const { selection, requests } = await fixture({
      "certificate-authority": "ca.crt",
      "tls-server-name": "localhost",
    });
    expectSuccess(await readPodsSelection(selection));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/^\/api\/v1\/pods\?/);
    expect(requests[0].authorization).toBe(`Bearer ${token}`);
  });

  it("honors explicit insecure-skip-tls-verify on HTTPS without requiring a CA", async () => {
    // The leaf also lacks an IP SAN: both trust and hostname validation require
    // explicit opt-in here. The request still travels over a real TLS socket.
    const { selection, requests } = await fixture({ "insecure-skip-tls-verify": true });
    expectSuccess(await readPodsSelection(selection));
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe(`Bearer ${token}`);
  });

  it("rejects the wrong TLS server name even with the selected CA", async () => {
    const { selection, requests } = await fixture({
      "certificate-authority": "ca.crt",
      "tls-server-name": "wrong.invalid",
    });
    const snapshot = await readPodsSelection(selection);
    expect(snapshot.error).toBe("TLS_ERROR");
    expect(requests).toEqual([]);
    expectSanitized(snapshot);
  });

  it("presents the selected client certificate and key to a server requiring mTLS", async () => {
    const { selection, requests, user, save } = await fixture(
      {
        "certificate-authority": "ca.crt",
        "tls-server-name": "localhost",
      },
      true,
    );
    // Negative control: a trusted server must still reject a token-only client.
    const denied = await readPodsSelection(selection);
    expect(denied.error).not.toBeNull();
    expect(requests).toEqual([]);
    expectSanitized(denied);
    user["client-certificate"] = "client.crt";
    user["client-key"] = "client-private.bin";
    await save();
    expectSuccess(await readPodsSelection(selection));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ clientAuthorized: true, clientName: "synthetic-client" });
  });
});
