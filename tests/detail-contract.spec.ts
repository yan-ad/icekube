import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("Rust detail projections for every resource kind satisfy the renderer contract", async ({ page }) => {
  test.setTimeout(180_000);
  const output = execFileSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "export_frontend_detail_contract", "--", "--nocapture"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 150_000,
  });
  const line = output.split("\n").find(line => line.startsWith("DETAIL_CONTRACT_JSON:"));
  expect(line, "the backend must generate the fixture through its real projector and serde serializer").toBeTruthy();
  const cases = JSON.parse(line!.slice("DETAIL_CONTRACT_JSON:".length));
  expect(cases).toHaveLength(41);
  await page.goto("/");
  const failures = await page.evaluate(async cases => {
    const path = "/src/app/cluster/detailApi.ts";
    const { parseResourceDetail } = await import(/* @vite-ignore */ path);
    const failures = [];
    for (const { request, response } of cases) {
      try { parseResourceDetail(response, request); }
      catch (error) { failures.push({ kind: request.reference.kind, error, response }); }
      for (const mutate of [
        (v: any) => { v.item.spec = { credential: "PRIVATE" }; },
        (v: any) => { v.reference.uid = "different-uid"; },
        (v: any) => { v.sessionId = "different-session"; },
        (v: any) => { v.related.arbitrary = v.reference; },
        (v: any) => { v.sections = Array.from({ length: 13 }, () => ({ title: "Section", facts: [] })); },
        (v: any) => { v.sections = [{ title: "Section", facts: Array.from({ length: 33 }, () => ({ label: "Label", value: "Value" })) }]; },
        (v: any) => { if (["secrets", "configMaps"].includes(request.reference.kind)) v.item.columns = { password: "PRIVATE" }; else v.item.columns = { ...v.item.columns, private: { password: "PRIVATE" } }; },
        (v: any) => { v.sections = [{ title: "Unsafe", facts: [{ label: "Value", value: "bad\nvalue" }] }]; },
      ]) {
        const invalid = structuredClone(response);
        mutate(invalid);
        try { parseResourceDetail(invalid, request); failures.push({ kind: request.reference.kind, error: "accepted malformed response", response: invalid }); }
        catch (error) { if (error !== "invalidResponse") failures.push({ kind: request.reference.kind, error, response: invalid }); }
      }
    }
    return failures;
  }, cases);
  expect(failures).toEqual([]);
});
