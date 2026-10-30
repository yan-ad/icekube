import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, createContext, useContext } from "react";

const dom = new Window({ url: "http://localhost:1420" });
for (const key of ["window", "document", "navigator", "CSS", "HTMLElement", "HTMLDialogElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  const value = key === "window" ? dom : (dom as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(dom) : value });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, isTauri: true });
const errors: unknown[] = [];
dom.addEventListener("error", event => { errors.push(event.error); event.preventDefault(); });
const calls: { command: string; args: unknown }[] = [];
let resolvePicker: (path: string | null) => void = () => {};
Object.assign(dom, { isTauri: true, __TAURI_INTERNALS__: {
  invoke: (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === "catalog_choose_kubeconfig") return new Promise<string | null>(resolve => { resolvePicker = resolve; });
    return Promise.resolve(null);
  },
} });
const initial = { busy: false, available: true, error: null as string | null, snapshot: { clusters: [] }, run: async (_command: string, _args: unknown) => true };
const CatalogContext = createContext(initial);
mock.module("../../src/app/catalog/CatalogProvider", () => ({ useCatalog: () => useContext(CatalogContext) }));
const { createRoot } = await import("react-dom/client");
const { CatalogForms } = await import("../../src/app/catalog/CatalogForms");
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; dom.document.body.innerHTML = ""; errors.length = 0; calls.length = 0; });
function button(label: string) {
  const result = [...dom.document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}; DOM: ${dom.document.body.innerHTML}`);
  return result;
}
const click = async (label: string) => { await act(async () => button(label).click()); };

test("import dialog keeps hook order across help, pending picker, cancel and reopen", async () => {
  const host = dom.document.createElement("main"); dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  const render = async (state = initial) => { await act(async () => root!.render(<React.StrictMode><CatalogContext value={state}><CatalogForms /></CatalogContext></React.StrictMode>)); };
  await render();
  await click("Add config");
  await click("Need help with your platform?");
  await click("Need help with your platform?");
  await click("Choose File");
  await act(async () => resolvePicker("/fixtures/config"));
  expect(dom.document.querySelector("input")?.value).toBe("/fixtures/config");
  await render({ ...initial, busy: true });
  await render({ ...initial, error: "Synthetic import error" });
  await click("Cancel");
  await click("Add config");
  await click("Choose File");
  await click("Cancel");
  await click("Add config");
  await act(async () => resolvePicker("/fixtures/stale"));
  expect(dom.document.querySelector("input")?.value).toBe("");
  expect(errors).toEqual([]);
});
