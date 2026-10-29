import { expect, test } from "@playwright/test";
import { parseDetailMetadata } from "../src/app/cluster/detailMetadata";

const metadata = () => ({ labels: [{ key: "app", value: "api" }], annotations: [{ key: "example/note", value: "" }], finalizers: ["example/cleanup"], managedFields: [{ manager: "controller", operation: "Update", apiVersion: "v1", time: null, subresource: null, fields: '[["spec","containers","[keyed item]","image"]]' }], deletionTimestamp: null, partial: true });

test("keeps public Helm metadata but rejects credential syntax in every text field", () => {
  const publicMetadata = { ...metadata(), labels: [{ key: "app", value: "my-app" }], annotations: [{ key: "meta.helm.sh/release-name", value: "my-app" }] };
  expect(parseDetailMetadata(publicMetadata, "pods")).toEqual(publicMetadata);
  for (const value of ["Bearer abc", "Authorization: Basic abc", "password = abc", '{"client_secret":"abc"}', "-----BEGIN RSA PRIVATE KEY-----abc"]) {
    invalid({ ...metadata(), labels: [{ key: "app", value }] });
    invalid({ ...metadata(), annotations: [{ key: "example/note", value }] });
    invalid({ ...metadata(), finalizers: [value] });
    invalid({ ...metadata(), managedFields: [{ ...metadata().managedFields[0], manager: value }] });
  }
  invalid({ ...metadata(), labels: [{ key: "example/secret", value: "hidden" }] });
  for (const fields of ['[["metadata","labels","example/secret"]]', '[["metadata","annotations","example/password"]]', '[["spec","k:{\\"value\\":\\"hidden\\"}"]]', '[["spec","v:hidden"]]']) {
    invalid({ ...metadata(), managedFields: [{ ...metadata().managedFields[0], fields }] });
  }
});

test("validates timestamp calendar, precision and explicit RFC3339 offsets", () => {
  for (const time of ["2024-02-29T23:59:59.123456789+23:59", "2026-10-29t12:00:00z", "0000-01-01T00:00:00Z"]) {
    expect(parseDetailMetadata({ ...metadata(), deletionTimestamp: time, managedFields: [{ ...metadata().managedFields[0], time }] }, "pods")?.deletionTimestamp).toBe(time);
  }
  for (const time of ["", "tomorrow", "2023-02-29T00:00:00Z", "2024-01-01 00:00:00Z", "2024-01-01T24:00:00Z", "2024-01-01T00:00:60Z", "2024-01-01T00:00:00+24:00", "2024-01-01T00:00:00.1234567890Z", "2024-01-01T00:00:00Z[UTC]"]) {
    invalid({ ...metadata(), deletionTimestamp: time });
    invalid({ ...metadata(), managedFields: [{ ...metadata().managedFields[0], time }] });
  }
});

test("uses UTF-8 JSON wire bytes without ASCII escaping and rejects lone surrogates", () => {
  for (const value of ["é".repeat(512), "😀".repeat(256), "\"\\".repeat(512), "\u2028".repeat(341)]) {
    const projected = { ...metadata(), labels: [{ key: "app", value }] };
    expect(parseDetailMetadata(projected, "pods")).toEqual(projected);
  }
  invalid({ ...metadata(), labels: [{ key: "app", value: "\ud800" }] });
});
function invalid(value: unknown) { expect(() => parseDetailMetadata(value, "pods")).toThrow("invalidResponse"); }

test("shared metadata accepts bounded projection and legacy absence", () => {
  expect(parseDetailMetadata(undefined, "pods")).toBeUndefined();
  expect(parseDetailMetadata(metadata(), "pods")).toEqual(metadata());
  for (const kind of ["secrets", "configMaps"] as const) {
    expect(parseDetailMetadata(null, kind)).toBeUndefined();
    expect(parseDetailMetadata(undefined, kind)).toBeUndefined();
    expect(() => parseDetailMetadata(metadata(), kind)).toThrow("invalidResponse");
  }
});

test("rejects unknown keys, controls, bidi and sensitive annotation names", () => {
  invalid(null);
  invalid({ ...metadata(), arbitrary: "no" });
  invalid({ ...metadata(), labels: [{ key: "app", value: "\u0000" }] });
  invalid({ ...metadata(), labels: [{ key: "app", value: "\u061c" }] });
  invalid({ ...metadata(), labels: [{ key: "app", value: "é".repeat(513) }] });
  for (const key of ["example/Token", "example/private-key", "example/config", "kubectl.kubernetes.io/last-applied-configuration", "example/authorization", "example/credential", "example/password", "example/secret"]) {
    invalid({ ...metadata(), annotations: [{ key, value: "no" }] });
  }
  invalid({ ...metadata(), managedFields: [{ ...metadata().managedFields[0], raw: {} }] });
});

test("rejects collection and complete serialized byte budget overflow", () => {
  invalid({ ...metadata(), labels: Array.from({ length: 33 }, (_, i) => ({ key: `${i}`, value: "a" })) });
  invalid({ ...metadata(), annotations: Array.from({ length: 33 }, (_, i) => ({ key: `${i}`, value: "a" })) });
  invalid({ ...metadata(), finalizers: Array(17).fill("cleanup") });
  invalid({ ...metadata(), managedFields: Array(9).fill(metadata().managedFields[0]) });
  invalid({ ...metadata(), labels: Array.from({ length: 32 }, (_, i) => ({ key: `${i}`, value: "a".repeat(1024) })) });
});

test("accepts only bounded ownership path JSON, never raw fieldsV1 or keyed identities", () => {
  for (const fields of ['{"f:spec":{}}', '[["k:{secret:never}"]]', '[["v:never"]]', '[["spec",42]]', '[["spec\\u202e"]]', JSON.stringify([Array(13).fill("nested")]), JSON.stringify(Array.from({ length: 256 }, (_, i) => [`field${i}`]))]) {
    invalid({ ...metadata(), managedFields: [{ ...metadata().managedFields[0], fields }] });
  }
  const paths = JSON.stringify(Array.from({ length: 40 }, (_, i) => [`field${i}`, "a".repeat(60)]));
  expect(paths.length).toBeGreaterThan(1024);
  expect(parseDetailMetadata({ ...metadata(), managedFields: [{ ...metadata().managedFields[0], fields: paths }] }, "pods")?.managedFields[0].fields).toEqual(paths);
});
