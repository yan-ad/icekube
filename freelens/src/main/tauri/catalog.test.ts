/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createBuiltInCatalog } from "./catalog";

it("reserves the three built-ins in a full discovery snapshot and recovers on the next scan", async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), "freelens-catalog-")));
  try {
    const config = path.join(home, "config");
    const document = {
      clusters: [{ name: "cluster", cluster: { server: "https://fixture.invalid" } }],
      users: [{ name: "user", user: {} }],
      contexts: Array.from({ length: 1001 }, (_, index) => ({
        name: `context-${index}`,
        context: { cluster: "cluster", user: "user" },
      })),
    };
    await writeFile(config, JSON.stringify(document));
    const snapshot = createBuiltInCatalog({ roots: [config], homeDirectory: home });
    const full = await snapshot();
    expect(full.entities).toHaveLength(1000);
    expect(full.entities.filter(({ kind }) => kind === "General")).toHaveLength(3);
    expect(full.entities.filter(({ kind }) => kind === "KubernetesCluster")).toHaveLength(997);
    expect(full.warnings).toContain("KUBECONFIG_ENTITY_LIMIT");
    expect(Buffer.byteLength(JSON.stringify({ id: 2, result: full }))).toBeLessThan(1024 * 1024);
    document.contexts = document.contexts.slice(0, 1);
    await writeFile(config, JSON.stringify(document));
    expect((await snapshot()).entities).toHaveLength(4);
    expect((await snapshot()).warnings).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
