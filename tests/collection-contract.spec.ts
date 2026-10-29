import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { CollectionRequest } from "../src/app/cluster/detailCollectionsApi";

test("all seven Rust collection projections satisfy the closed renderer contract", async ({ page }) => {
  test.setTimeout(180_000);
  const output = execFileSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "export_frontend_collection_contract", "--", "--nocapture"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 150_000,
  });
  const line = output.split("\n").find(line => line.startsWith("COLLECTION_CONTRACT_JSON:"));
  expect(line, "fixture must use Rust project_item and serde serialization").toBeTruthy();
  const cases: { request: CollectionRequest; response: unknown }[] = JSON.parse(line!.slice("COLLECTION_CONTRACT_JSON:".length));
  expect(cases.map(value => value.request.collection)).toEqual(["pods", "replicaSets", "jobs", "endpointSlices", "events", "resourceQuotas", "limitRanges"]);
  await page.goto("/");
  const failures = await page.evaluate(async cases => {
    const { parseResourceCollection } = await import("/src/app/cluster/detailCollectionsApi.ts" as string);
    const failures: { kind: string; mutation: string; error?: unknown }[] = [];
    for (const { request, response } of cases) {
      const check = (value: unknown, mutation: string, valid: boolean) => {
        try { parseResourceCollection(value, request); if (!valid) failures.push({ kind: request.collection, mutation }); }
        catch (error) { if (valid || error !== "invalidResponse") failures.push({ kind: request.collection, mutation, error }); }
      };
      check(response, "real Rust projection", true);
      for (const [mutation, mutate] of [
        ["unknown top-level", (v: any) => { v.spec = { private: "PRIVATE" }; }],
        ["cross-session", (v: any) => { v.sessionId = "other-session"; }],
        ["cross-read", (v: any) => { v.readId++; }],
        ["spoofed parent UID", (v: any) => { v.reference.uid = "replacement"; }],
        ["missing child UID", (v: any) => { v.items[0].reference.uid = null; }],
        ["cross-namespace", (v: any) => { v.items[0].reference.namespace = "other"; }],
        ["unknown column", (v: any) => { v.items[0].columns.private = "PRIVATE"; }],
        ["raw item", (v: any) => { v.items[0].spec = {}; }],
        ["duplicate identity", (v: any) => { v.items.push(structuredClone(v.items[0])); }],
        ["same name replacement UID", (v: any) => { v.items.push({ ...structuredClone(v.items[0]), reference: { ...v.items[0].reference, uid: "replacement" } }); }],
        ["denied with rows", (v: any) => { v.state = "denied"; }],
        ["control character", (v: any) => { v.items[0].status = "bad\nvalue"; }],
      ] as [string, (value: any) => void][]) {
        const value = structuredClone(response); mutate(value); check(value, mutation, false);
      }
    }
    return failures;
  }, cases);
  expect(failures).toEqual([]);
});
