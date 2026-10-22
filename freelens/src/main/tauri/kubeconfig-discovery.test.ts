/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverKubeconfigContexts } from "./kubeconfig-discovery";

vi.mock("node:fs/promises", { spy: true });

// All filesystem fixtures live under system tmp, never the user's real kube directory.
const document = (name = "example") =>
  JSON.stringify({
    clusters: [{ name: "cluster", cluster: { server: "https://invalid.example" } }],
    users: [
      {
        name: "user",
        user: {
          token: "synthetic-token",
          tokenFile: "/must-not-read-token",
          "client-certificate": "/must-not-read-certificate",
          "client-key": "/must-not-read-key",
          exec: { command: "/must-not-execute", args: ["synthetic-argument"] },
        },
      },
    ],
    contexts: [{ name, context: { cluster: "cluster", user: "user" } }],
  });

let home: string;
let directory: string;
const scan = (roots: string[] = [directory]) => discoverKubeconfigContexts({ roots, homeDirectory: home });
const put = (name: string, content = document()) => fs.writeFile(path.join(directory, name), content);

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "freelens-discovery-")));
  directory = path.join(home, ".kube");
  await fs.mkdir(directory);
});
afterEach(async () => {
  vi.clearAllMocks();
  await fs.rm(home, { force: true, recursive: true });
});

describe("read-only kubeconfig discovery", () => {
  it("projects only Catalog metadata, stable IDs and home-relative labels without auth IO", async () => {
    await put("config");
    const opened = vi.spyOn(fs, "open");
    const readFile = vi.spyOn(fs, "readFile");
    const file = path.join(directory, "config");
    const result = await scan();
    expect(result).toEqual({
      warnings: [],
      entities: [
        {
          id: createHash("md5").update(`${file}:example`).digest("hex"),
          name: "example",
          kind: "KubernetesCluster",
          group: "entity.k8slens.dev",
          source: "local",
          status: "disconnected",
          labels: { file: "~/.kube/config" },
          icon: null,
          action: null,
        },
      ],
    });
    expect(opened.mock.calls.map(([name]) => name)).toEqual([await fs.realpath(file)]);
    expect(readFile).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/synthetic|invalid.example|must-not/);
  });

  it("salvages valid entries with the shared structural validation and ignores dangling references", async () => {
    const config = JSON.parse(document());
    config.clusters.push({ name: "bad", cluster: {} });
    config.users.push({ name: "" });
    config.contexts.push(
      { name: "" },
      { name: "missing-structure" },
      { name: "dangling", context: { cluster: "bad", user: "user" } },
    );
    await put("config", JSON.stringify(config));
    const result = await scan();
    expect(result.entities.map((entity) => entity.name)).toEqual(["example"]);
    expect(result.warnings).toEqual(
      expect.arrayContaining(["KUBECONFIG_INVALID_DOCUMENT", "KUBECONFIG_INVALID_CONTEXT"]),
    );
  });

  it("deduplicates contexts per file and repeated/overlapping roots and symlink aliases", async () => {
    const config = JSON.parse(document());
    config.contexts.push(...config.contexts);
    await put("config", JSON.stringify(config));
    await fs.symlink(path.join(directory, "config"), path.join(directory, "alias"));
    const result = await scan([path.join(directory, "config"), directory, directory]);
    expect(result.entities).toHaveLength(1);
  });

  it("rescans edits and removals; malformed files do not prevent recovery or leak parser messages", async () => {
    await put("config", "contexts: [\nsynthetic-secret");
    await put("valid", document("second"));
    let result = await scan();
    expect(result.entities.map((entity) => entity.name)).toEqual(["second"]);
    expect(result.warnings).toEqual(["KUBECONFIG_READ_OR_PARSE_FAILED"]);
    await put("config", document("changed"));
    await fs.rm(path.join(directory, "valid"));
    result = await scan();
    expect(result.entities.map((entity) => entity.name)).toEqual(["changed"]);
    await fs.rm(path.join(directory, "config"));
    expect((await scan()).entities).toEqual([]);
  });

  it("rejects sensitive names and sensitive symlink targets before opening, and never recurses", async () => {
    // Sensitive fixtures are empty; never contain or read credential content.
    for (const name of [
      ".env",
      ".env.local",
      ".envrc",
      ".npmrc",
      "cert.pem",
      "a.key",
      "a.p12",
      "a.pfx",
      "a.jks",
      "a.keystore",
    ]) {
      await put(name, "");
    }
    await fs.symlink(path.join(directory, "cert.pem"), path.join(directory, "innocent"));
    await fs.mkdir(path.join(directory, "nested"));
    await fs.writeFile(path.join(directory, "nested", "config"), document());
    await fs.symlink(path.join(directory, "nested"), path.join(directory, "linked-dir"));
    const opened = vi.spyOn(fs, "open");
    const result = await scan([directory, path.join(directory, ".env"), path.join(directory, "linked-dir")]);
    expect(result.entities).toEqual([]);
    expect(opened).not.toHaveBeenCalled();
    expect(result.warnings).toContain("KUBECONFIG_SENSITIVE_FILE");
  });

  it("uses folder ignores only for folder sync and accepts extensionless explicit kubeconfigs", async () => {
    await put("backup.bak");
    await put("kubectx");
    expect((await scan()).entities).toHaveLength(0);
    expect((await scan([path.join(directory, "backup.bak")])).entities).toHaveLength(1);
  });

  it("rejects relative/missing roots and special files without blocking later valid roots", async () => {
    await put("config");
    const result = await scan(["relative", path.join(home, "absent"), path.join(directory, "config")]);
    expect(result.entities).toHaveLength(1);
    expect(result.warnings).toEqual(["KUBECONFIG_INVALID_PATH", "KUBECONFIG_ROOT_UNAVAILABLE"]);
    // A platform-independent special-file stand-in: symlink to a directory is not regular.
    await fs.symlink(directory, path.join(home, "dir-link"));
    expect((await scan([path.join(home, "dir-link")])).warnings).toContain("KUBECONFIG_NOT_REGULAR");
  });

  it("enforces folder size, explicit size and aggregate byte limits before reading oversized files", async () => {
    await put("large", `${document()}${" ".repeat(2 * 1024 * 1024)}`);
    const opened = vi.spyOn(fs, "open");
    expect((await scan()).warnings).toContain("KUBECONFIG_FILE_TOO_LARGE");
    expect(opened).not.toHaveBeenCalled();
    expect((await scan([path.join(directory, "large")])).entities).toHaveLength(1);
    await fs.truncate(path.join(directory, "large"), 17 * 1024 * 1024);
    expect((await scan([path.join(directory, "large")])).warnings).toContain("KUBECONFIG_BYTE_LIMIT");
    await fs.truncate(path.join(directory, "large"), 33 * 1024 * 1024);
    expect((await scan([path.join(directory, "large")])).warnings).toContain("KUBECONFIG_FILE_TOO_LARGE");
  });

  it("bounds actual reads when a file grows after stat and closes the handle", async () => {
    await put("config");
    const realOpen = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const handle = await realOpen.open(path.join(directory, "config"), "r");
    const close = vi.spyOn(handle, "close");
    const read = vi.spyOn(handle, "read").mockImplementation(async (...args: unknown[]) => {
      const [buffer, offset, length] = args as [Buffer, number, number];
      buffer.fill(32, offset, offset + length);
      return { bytesRead: length, buffer };
    });
    vi.mocked(fs.open).mockResolvedValueOnce(handle);
    const result = await scan();
    expect(result.entities).toEqual([]);
    expect(result.warnings).toContain("KUBECONFIG_FILE_TOO_LARGE");
    expect(read).toHaveBeenCalledTimes(1);
    expect((read.mock.calls[0] as unknown[])[2]).toBe(2 * 1024 * 1024 + 1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("limits aggregate bytes across explicit files and can still process a smaller later file", async () => {
    await put("first", `${document("first")}${" ".repeat(9 * 1024 * 1024)}`);
    await put("second", `${document("second")}${" ".repeat(9 * 1024 * 1024)}`);
    await put("small", document("small"));
    const result = await scan(["first", "second", "small"].map((name) => path.join(directory, name)));
    expect(result.entities.map((entity) => entity.name)).toEqual(["first", "small"]);
    expect(result.warnings).toContain("KUBECONFIG_BYTE_LIMIT");
  });

  it("caps files at 128 and entities at 1000", async () => {
    for (let i = 0; i < 130; i++) await put(`config-${i}`);
    const result = await scan();
    expect(result.entities).toHaveLength(128);
    expect(result.warnings).toContain("KUBECONFIG_FILE_LIMIT");
    const config = JSON.parse(document());
    config.contexts = Array.from({ length: 1002 }, (_, index) => ({
      name: `context-${index}`,
      context: { cluster: "cluster", user: "user" },
    }));
    await put("many", JSON.stringify(config));
    const many = await scan([path.join(directory, "many")]);
    expect(many.entities).toHaveLength(1000);
    expect(many.warnings).toContain("KUBECONFIG_ENTITY_LIMIT");
  });
  it("uses canonical identity and labels regardless of symlink root order", async () => {
    await put("config");
    const actual = path.join(directory, "config");
    const alias = path.join(directory, "alias");
    await fs.symlink(actual, alias);
    const first = await scan([alias, actual]);
    expect(first).toEqual(await scan([actual, alias]));
    expect(first.entities[0].id).toBe(createHash("md5").update(`${actual}:example`).digest("hex"));
    expect(first.entities[0].labels.file).toBe("~/.kube/config");
  });

  it("checks folder ignore rules on resolved targets without opening them", async () => {
    const target = path.join(home, "backup.bak");
    await fs.writeFile(target, document());
    await fs.symlink(target, path.join(directory, "innocent"));
    const opened = vi.spyOn(fs, "open");
    expect((await scan()).entities).toEqual([]);
    expect(opened).not.toHaveBeenCalled();
    expect((await scan([target])).entities).toHaveLength(1);
  });

  it("skips overlong raw metadata without truncating or losing later valid contexts", async () => {
    const config = JSON.parse(document());
    config.contexts = [4097, 4096].map((length) => ({
      name: "x".repeat(length),
      context: { cluster: "cluster", user: "user" },
    }));
    config.contexts.push({ name: "later", context: { cluster: "cluster", user: "user" } });
    await put("config", JSON.stringify(config));
    const result = await scan();
    expect(result.entities.map(({ name }) => name)).toEqual(["x".repeat(4096), "later"]);
    expect(result.warnings).toContain("KUBECONFIG_METADATA_TOO_LONG");
  });

  it("budgets serialized UTF-8 metadata in whole entities and keeps smaller later entries", async () => {
    const config = JSON.parse(document());
    config.contexts = Array.from({ length: 100 }, (_, index) => ({
      name: `${index}-${"界".repeat(4000)}`,
      context: { cluster: "cluster", user: "user" },
    }));
    config.contexts.push({ name: "later", context: { cluster: "cluster", user: "user" } });
    await put("config", JSON.stringify(config));
    const result = await scan();
    expect(result.entities.length).toBeLessThan(100);
    expect(result.entities.at(-1)?.name).toBe("later");
    expect(result.warnings).toContain("KUBECONFIG_METADATA_BYTE_LIMIT");
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(901 * 1024);
  });

  it("composes an explicit entity limit and reports the reserved capacity", async () => {
    const config = JSON.parse(document());
    config.contexts = Array.from({ length: 1002 }, (_, index) => ({
      name: `context-${index}`,
      context: { cluster: "cluster", user: "user" },
    }));
    await put("config", JSON.stringify(config));
    const result = await discoverKubeconfigContexts({ roots: [directory], homeDirectory: home, maxEntities: 997 });
    expect(result.entities).toHaveLength(997);
    expect(result.warnings).toContain("KUBECONFIG_ENTITY_LIMIT");
    await expect(discoverKubeconfigContexts({ roots: [], homeDirectory: home, maxEntities: 1001 })).rejects.toThrow(
      "Invalid catalog discovery entity limit",
    );
  });

  it("bounds root attempts and directory entries even when every entry is ignored", async () => {
    const result = await scan(Array.from({ length: 129 }, () => "relative"));
    expect(result.warnings).toContain("KUBECONFIG_ROOT_LIMIT");
    for (let index = 0; index < 4097; index++) await put(`${index}.bak`, "");
    const opened = vi.spyOn(fs, "open");
    expect((await scan()).warnings).toContain("KUBECONFIG_DIRECTORY_ENTRY_LIMIT");
    expect(opened).not.toHaveBeenCalled();
  });
});
