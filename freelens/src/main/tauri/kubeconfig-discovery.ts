/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { validateKubeConfigDocument } from "../../../../packages/core/src/common/kube-config-document";
import { matchIgnoredKubeconfigFileName } from "../../../../packages/core/src/common/kubeconfig-file-ignore";

export interface DiscoveredCatalogEntity {
  id: string;
  name: string;
  kind: "KubernetesCluster";
  group: "entity.k8slens.dev";
  source: "local";
  labels: Record<string, string>;
  status: "disconnected";
  icon: null;
  action: null;
}

const directoryFileLimit = 2 * 1024 * 1024;
const explicitFileLimit = 32 * 1024 * 1024;
const totalByteLimit = 16 * 1024 * 1024;
const fileLimit = 128;
const entityLimit = 1000;
const rootLimit = 128;
const directoryEntryLimit = 4096;
// Leave space for built-ins, categories, warnings and the response envelope.
const metadataByteLimit = 896 * 1024;
const textLimit = 4096;

// Apply even to explicitly selected files, and again to resolved symlink targets.
const isSensitive = (filePath: string): boolean =>
  /^(?:\.env.*|\.npmrc|\.envrc)$|\.(?:key|pem|p12|pfx|jks|keystore)$/i.test(path.basename(filePath));

/** Catalog metadata only. Never instantiate KubeConfig or resolve credentials, exec, or servers.
 * Each call is a fresh snapshot; warnings are fixed codes, never paths or parser exceptions.
 */
export async function discoverKubeconfigSelections({
  roots,
  homeDirectory,
  maxEntities = entityLimit,
}: {
  roots: readonly string[];
  homeDirectory: string;
  maxEntities?: number;
}): Promise<{
  entities: DiscoveredCatalogEntity[];
  warnings: string[];
  selections: Map<string, { canonicalPath: string; contextName: string }>;
}> {
  if (!Number.isInteger(maxEntities) || maxEntities < 0 || maxEntities > entityLimit) {
    throw new Error("Invalid catalog discovery entity limit");
  }
  const selections = new Map<string, { canonicalPath: string; contextName: string }>();
  const entities: DiscoveredCatalogEntity[] = [];
  const warnings = new Set<string>();
  const visitedFiles = new Set<string>();
  const visitedRoots = new Set<string>();
  let files = 0;
  let bytes = 0;
  let metadataBytes = 0;
  const exhausted = () => files >= fileLimit || bytes >= totalByteLimit || entities.length >= maxEntities;
  const warnLimits = () => {
    if (files >= fileLimit) warnings.add("KUBECONFIG_FILE_LIMIT");
    if (bytes >= totalByteLimit) warnings.add("KUBECONFIG_BYTE_LIMIT");
    if (entities.length >= maxEntities) warnings.add("KUBECONFIG_ENTITY_LIMIT");
  };

  const readCandidate = async (filePath: string, maxBytes: number, folderSync: boolean) => {
    if (exhausted()) return;
    if (isSensitive(filePath)) {
      warnings.add("KUBECONFIG_SENSITIVE_FILE");
      return;
    }
    if (folderSync && matchIgnoredKubeconfigFileName(path.basename(filePath))) return;

    try {
      const target = await realpath(filePath);
      if (isSensitive(target)) {
        warnings.add("KUBECONFIG_SENSITIVE_FILE");
        return;
      }
      if (folderSync && matchIgnoredKubeconfigFileName(path.basename(target))) return;
      if (visitedFiles.has(target)) return;
      visitedFiles.add(target);
      files++;
      const before = await lstat(target);
      if (!before.isFile()) {
        warnings.add("KUBECONFIG_NOT_REGULAR");
        return;
      }
      if (before.size > maxBytes) {
        warnings.add("KUBECONFIG_FILE_TOO_LARGE");
        return;
      }

      // No symlink following at open, no FIFO blocking, and verify the opened inode.
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let content: string;
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.dev !== before.dev || stats.ino !== before.ino) {
          warnings.add("KUBECONFIG_NOT_REGULAR");
          return;
        }
        const remaining = totalByteLimit - bytes;
        if (stats.size > maxBytes || stats.size > remaining) {
          warnings.add(stats.size > maxBytes ? "KUBECONFIG_FILE_TOO_LARGE" : "KUBECONFIG_BYTE_LIMIT");
          return;
        }
        // Bound actual reads, not just stat.size: the file may grow after stat.
        const buffer = Buffer.alloc(Math.min(maxBytes + 1, remaining));
        let length = 0;
        while (length < buffer.length) {
          const result = await handle.read(buffer, length, buffer.length - length, length);
          if (!result.bytesRead) break;
          length += result.bytesRead;
          bytes += result.bytesRead;
        }
        if (length > maxBytes || length === remaining) {
          warnings.add(length > maxBytes ? "KUBECONFIG_FILE_TOO_LARGE" : "KUBECONFIG_BYTE_LIMIT");
          return;
        }
        content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
      } finally {
        await handle.close();
      }

      const { document, error } = validateKubeConfigDocument(content);
      if (error) warnings.add("KUBECONFIG_INVALID_DOCUMENT");
      const clusters = new Set(document.clusters?.map((cluster) => cluster.name));
      const users = new Set(document.users?.map((user) => user.name));
      const contexts = new Set<string>();
      for (const context of document.contexts ?? []) {
        if (contexts.has(context.name)) continue;
        contexts.add(context.name);
        if (!context.context || !clusters.has(context.context.cluster) || !users.has(context.context.user)) {
          warnings.add("KUBECONFIG_INVALID_CONTEXT");
          continue;
        }
        const relative = path.relative(homeDirectory, target);
        const label =
          relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
            ? `~/${relative.split(path.sep).join("/")}`
            : target;
        if (context.name.length > textLimit || label.length > textLimit) {
          warnings.add("KUBECONFIG_METADATA_TOO_LONG");
          continue;
        }
        const entity: DiscoveredCatalogEntity = {
          id: createHash("md5").update(`${target}:${context.name}`).digest("hex"),
          name: context.name,
          kind: "KubernetesCluster",
          group: "entity.k8slens.dev",
          source: "local",
          labels: { file: label },
          status: "disconnected",
          icon: null,
          action: null,
        };
        const entityBytes = Buffer.byteLength(JSON.stringify(entity), "utf8") + 1;
        if (metadataBytes + entityBytes > metadataByteLimit) {
          warnings.add("KUBECONFIG_METADATA_BYTE_LIMIT");
          continue;
        }
        metadataBytes += entityBytes;
        entities.push(entity);
        selections.set(entity.id, { canonicalPath: target, contextName: context.name });
        if (entities.length >= maxEntities) break;
      }
    } catch {
      // YAML/Joi errors may contain credentials; never expose error.message.
      warnings.add("KUBECONFIG_READ_OR_PARSE_FAILED");
    }
  };

  if (roots.length > rootLimit) warnings.add("KUBECONFIG_ROOT_LIMIT");
  for (const root of roots.slice(0, rootLimit)) {
    if (exhausted()) break;
    if (!root || root.length > textLimit || !path.isAbsolute(root)) {
      warnings.add("KUBECONFIG_INVALID_PATH");
      continue;
    }
    const filePath = path.normalize(root);
    if (visitedRoots.has(filePath)) continue;
    visitedRoots.add(filePath);
    if (isSensitive(filePath)) {
      warnings.add("KUBECONFIG_SENSITIVE_FILE");
      continue;
    }
    try {
      const stats = await lstat(filePath);
      if (stats.isDirectory()) {
        // Deliberately no recursion or following symlinked directories.
        const directory = await opendir(filePath);
        let entries = 0;
        for await (const child of directory) {
          if (entries++ >= directoryEntryLimit) {
            warnings.add("KUBECONFIG_DIRECTORY_ENTRY_LIMIT");
            break;
          }
          if (exhausted()) break;
          if (child.isFile() || child.isSymbolicLink()) {
            await readCandidate(path.join(filePath, child.name), directoryFileLimit, true);
          }
        }
      } else {
        await readCandidate(filePath, explicitFileLimit, false);
      }
    } catch {
      warnings.add("KUBECONFIG_ROOT_UNAVAILABLE");
    }
  }
  warnLimits();
  return { entities, warnings: [...warnings], selections };
}

/** Public catalog projection deliberately excludes the private worker selections. */
export async function discoverKubeconfigContexts(options: {
  roots: readonly string[];
  homeDirectory: string;
  maxEntities?: number;
}): Promise<{ entities: DiscoveredCatalogEntity[]; warnings: string[] }> {
  const { entities, warnings } = await discoverKubeconfigSelections(options);
  return { entities, warnings };
}
