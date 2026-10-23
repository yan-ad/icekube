/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { CoreV1Api, KubeConfig, ResponseContext, wrapHttpLibrary } from "@kubernetes/client-node";
import { fetch } from "undici";
import { validateKubeConfigDocument } from "../../../../packages/core/src/common/kube-config-document";
import { Pod } from "../../../../packages/kube-object/src/specifics/pod";
import { parsePodsRequest, parsePodsSnapshot } from "../../common/tauri/pods-protocol";
import { discoverKubeconfigSelections } from "./kubeconfig-discovery";

import type { RequestContext, V1Pod } from "@kubernetes/client-node";

import type { PodSummary, PodsError, PodsRequest, PodsSnapshot } from "../../common/tauri/pods-protocol";

export interface PodsSelection extends PodsRequest {
  canonicalPath: string;
  contextName: string;
}
class SafeError extends Error {
  constructor(readonly code: PodsError) {
    super(code);
  }
}
const fail = (request: PodsRequest, error: PodsError): PodsSnapshot => ({
  protocolVersion: 1,
  ...request,
  pods: [],
  namespaces: [],
  truncated: false,
  warnings: [],
  error,
});

// Sort object keys recursively; array ordering and all selected raw configuration are significant.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

async function loadSelectedConfig(
  selection: PodsSelection,
  authorize: (fingerprint: string) => void,
): Promise<KubeConfig> {
  if (
    createHash("md5").update(`${selection.canonicalPath}:${selection.contextName}`).digest("hex") !==
    selection.clusterId
  ) {
    throw new SafeError("CONFIG_UNAVAILABLE");
  }
  const handle = await open(selection.canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let raw: string;
  try {
    const stats = await handle.stat();
    const limit = 32 * 1024 * 1024;
    if (!stats.isFile() || stats.size > limit) throw new SafeError("CONFIG_UNAVAILABLE");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new SafeError("CONFIG_UNAVAILABLE");
    raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
  const { document } = validateKubeConfigDocument(raw);
  const context = document.contexts?.find((c) => c.name === selection.contextName);
  const cluster = document.clusters?.find((c) => c.name === context?.context?.cluster);
  const user = document.users?.find((u) => u.name === context?.context?.user);
  if (!context?.context || !cluster || !user) throw new SafeError("CONFIG_UNAVAILABLE");
  // Authorize the actual bounded read, not discovery's earlier snapshot. No credential
  // files, newUsers(), exec plugins or network may be touched before this check.
  authorize(createHash("sha256").update(canonicalJson({ context, cluster, user })).digest("hex"));
  // Never pass all users to newUsers(): it eagerly opens every token-file.
  const selectedUser = structuredClone(user) as typeof user & { user?: Record<string, unknown> };
  const root = path.dirname(selection.canonicalPath);
  if (typeof selectedUser.user?.["token-file"] === "string") {
    selectedUser.user["token-file"] = path.resolve(root, selectedUser.user["token-file"]);
  }
  const kc = new KubeConfig();
  kc.loadFromString(
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [cluster],
      users: [selectedUser],
      contexts: [context],
      "current-context": selection.contextName,
    }),
  );
  kc.makePathsAbsolute(root);
  return kc;
}

/** Project only table fields. The raw spec, env, annotations and credentials never leave this worker. */
export function summarizePod(item: V1Pod): PodSummary {
  // The existing model consumes wire dates, whereas the generated API converts them to Date.
  const data = JSON.parse(JSON.stringify(item));
  if (
    !data?.metadata?.uid ||
    !data.metadata.name ||
    !data.metadata.namespace ||
    !Array.isArray(data.spec?.containers)
  ) {
    throw new SafeError("INVALID_RESPONSE");
  }
  // The desktop model requires the legacy selfLink, absent from modern API responses.
  data.metadata.selfLink = `/api/v1/namespaces/${encodeURIComponent(data.metadata.namespace)}/pods/${encodeURIComponent(data.metadata.name)}`;
  const pod = new Pod(data);
  const statuses = new Map(pod.getContainerStatuses().map((status) => [status.name, status]));
  const containers: PodSummary["containers"] = [
    ...pod.getContainers().map((container) => ({ container, init: false })),
    ...pod.getInitContainers().map((container) => ({ container, init: true })),
  ].map(({ container, init }) => {
    const status = statuses.get(container.name);
    const state = status?.state;
    return {
      name: container.name,
      init,
      ready: status?.ready === true,
      state: state?.running ? "running" : state?.waiting ? "waiting" : state?.terminated ? "terminated" : "unknown",
    };
  });
  const owner = pod.metadata.ownerReferences?.find((owner) => owner.controller) ?? pod.metadata.ownerReferences?.[0];
  return {
    uid: pod.metadata.uid!,
    name: pod.metadata.name!,
    namespace: pod.metadata.namespace!,
    nodeName: pod.getNodeName() || null,
    createdAt: pod.metadata.creationTimestamp || null,
    phase: pod.getStatusPhase() || "Unknown",
    status: pod.getStatusMessage(),
    readyContainers: containers.filter((c) => !c.init && c.ready).length,
    totalContainers: pod.getContainers().length,
    restartCount: pod.getRestartsCount(),
    containers,
    owner: owner ? { kind: owner.kind, name: owner.name } : null,
    cpu: null,
    memory: null,
  };
}

/** Runs only in the disposable worker; plugin auth is authorized by the explicit list request. */
export async function readPodsSelection(
  selection: PodsSelection,
  deadlineMs = 12_000,
  authorize: (fingerprint: string) => void = () => {},
): Promise<PodsSnapshot> {
  const request = parsePodsRequest({ clusterId: selection.clusterId, namespace: selection.namespace });
  let kc: KubeConfig;
  try {
    kc = await loadSelectedConfig(selection, authorize);
  } catch {
    return fail(request, "CONFIG_UNAVAILABLE");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let responseBytes = 0;
  try {
    const api = kc.makeApiClient(CoreV1Api);
    const httpApi = wrapHttpLibrary({
      async send(context: RequestContext) {
        if (context.getHttpMethod() !== "GET") throw new SafeError("UNAVAILABLE");
        const response = await fetch(context.getUrl(), {
          method: "GET",
          headers: context.getHeaders(),
          dispatcher: context.getDispatcher(),
          signal: controller.signal,
          redirect: "error",
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name] = value;
        });
        const chunks: Buffer[] = [];
        if (response.body) {
          for await (const chunk of response.body) {
            responseBytes += chunk.byteLength;
            if (responseBytes > 8 * 1024 * 1024) {
              throw new SafeError("RESPONSE_TOO_LARGE");
            }
            chunks.push(Buffer.from(chunk));
          }
        }
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf8");
        if (response.status >= 200 && response.status < 300) {
          let value: unknown;
          try {
            value = JSON.parse(text);
          } catch {
            throw new SafeError("INVALID_RESPONSE");
          }
          if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items))
            throw new SafeError("INVALID_RESPONSE");
        }
        return new ResponseContext(response.status, headers, {
          text: async () => text,
          binary: async () => buffer,
          stream: () => null,
        });
      },
    });
    const pods: PodSummary[] = [];
    const seen = new Set<string>();
    let continuation: string | undefined;
    let truncated = false;
    let pages = 0;
    const withinDeadline = async <T>(operation: Promise<T>): Promise<T> => {
      let abort: () => void = () => {};
      const expired = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new SafeError("TIMEOUT"));
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) abort();
      });
      try {
        return await Promise.race([operation, expired]);
      } finally {
        controller.signal.removeEventListener("abort", abort);
      }
    };
    do {
      pages++;
      if (controller.signal.aborted) throw new SafeError("TIMEOUT");
      const params = { limit: 200, _continue: continuation, timeoutSeconds: 12 };
      const page =
        request.namespace === null
          ? await withinDeadline(api.listPodForAllNamespaces(params, { httpApi }))
          : await withinDeadline(api.listNamespacedPod({ ...params, namespace: request.namespace }, { httpApi }));
      if (!Array.isArray(page.items) || page.items.length > 1000) throw new SafeError("INVALID_RESPONSE");
      for (const item of page.items) {
        const summary = summarizePod(item);
        if (request.namespace !== null && summary.namespace !== request.namespace)
          throw new SafeError("INVALID_RESPONSE");
        if (seen.has(summary.uid)) throw new SafeError("INVALID_RESPONSE");
        seen.add(summary.uid);
        if (pods.length === 1000) {
          truncated = true;
          break;
        }
        pods.push(summary);
      }
      continuation = page.metadata?._continue;
      if (continuation && (typeof continuation !== "string" || continuation.length > 16384))
        throw new SafeError("INVALID_RESPONSE");
      if (pods.length >= 1000 || pages >= 5) {
        truncated ||= !!continuation;
        break;
      }
    } while (continuation);
    const snapshot: PodsSnapshot = {
      protocolVersion: 1,
      ...request,
      pods,
      namespaces: [...new Set(pods.map((p) => p.namespace))].sort(),
      truncated,
      warnings: ["Metrics unavailable", "Namespace list unavailable", ...(truncated ? ["Pod list truncated"] : [])],
      error: null,
    };
    // Include the framing newline in the worker transport budget.
    if (Buffer.byteLength(JSON.stringify(snapshot)) + 1 > 1024 * 1024) throw new SafeError("RESPONSE_TOO_LARGE");
    return parsePodsSnapshot(snapshot, request);
  } catch (error) {
    if (error instanceof SafeError) return fail(request, error.code);
    if (controller.signal.aborted) return fail(request, "TIMEOUT");
    const e = error as { code?: number | string; cause?: { code?: string }; name?: string };
    if (e.code === 401) return fail(request, "AUTH_FAILED");
    if (e.code === 403) return fail(request, "FORBIDDEN");
    const code = String(e.cause?.code ?? e.code ?? "");
    if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return fail(request, "TLS_ERROR");
    if (error instanceof SyntaxError || (e.name === "TypeError" && !e.cause)) return fail(request, "INVALID_RESPONSE");
    return fail(request, "UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

interface WorkerRequest extends PodsRequest {
  roots: string[];
  homeDirectory: string;
  expectedFingerprint: string | null;
}
interface WorkerResult {
  snapshot: PodsSnapshot;
  authorizationFingerprint: string | null;
}

/** Internal-only transport. Roots come exclusively from createPodsReader's trusted options. */
export async function readWorkerRequest(input: unknown): Promise<WorkerResult> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !== "clusterId,expectedFingerprint,homeDirectory,namespace,roots"
  )
    throw new Error();
  const value = input as WorkerRequest;
  const request = parsePodsRequest({ clusterId: value.clusterId, namespace: value.namespace });
  if (
    !Array.isArray(value.roots) ||
    value.roots.length > 128 ||
    !value.roots.every((root) => typeof root === "string" && root.length <= 4096 && path.isAbsolute(root)) ||
    typeof value.homeDirectory !== "string" ||
    value.homeDirectory.length > 4096 ||
    !path.isAbsolute(value.homeDirectory) ||
    !(
      value.expectedFingerprint === null ||
      (typeof value.expectedFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.expectedFingerprint))
    ) ||
    Buffer.byteLength(JSON.stringify(input)) > 16 * 1024
  )
    throw new Error();
  let authorizationFingerprint = value.expectedFingerprint;
  try {
    const { selections } = await discoverKubeconfigSelections(value);
    const selection = selections.get(request.clusterId);
    if (!selection) return { snapshot: fail(request, "CLUSTER_NOT_FOUND"), authorizationFingerprint };
    const snapshot = await readPodsSelection({ ...selection, ...request }, 12_000, (fingerprint) => {
      if (value.expectedFingerprint !== null && fingerprint !== value.expectedFingerprint)
        throw new SafeError("CONFIG_UNAVAILABLE");
      authorizationFingerprint = fingerprint;
    });
    return { snapshot, authorizationFingerprint };
  } catch {
    return { snapshot: fail(request, "CONFIG_UNAVAILABLE"), authorizationFingerprint };
  }
}

export async function runPodsWorker(): Promise<void> {
  // Auth-provider libraries can log token-bearing diagnostics. This process has
  // exactly one stdout message; drop console diagnostics rather than forwarding
  // arbitrary library output (including stderr) to the backend.
  for (const method of ["log", "info", "debug", "warn", "error", "trace", "dir", "table"] as const) {
    console[method] = () => {};
  }
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 16 * 1024) {
      process.exitCode = 1;
      return;
    }
    chunks.push(Buffer.from(chunk));
  }
  try {
    const result = await readWorkerRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (Buffer.byteLength(JSON.stringify(result)) + 1 > 1024 * 1024) {
      result.snapshot = fail(result.snapshot, "RESPONSE_TOO_LARGE");
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  (path.resolve(process.argv[1]) === process.env.FREELENS_TAURI_PODS_WORKER ||
    /pods-worker\.[cm]?js$/.test(process.argv[1]))
) {
  void runPodsWorker();
}
