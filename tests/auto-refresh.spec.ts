import { expect, test, type Page } from "@playwright/test";

type Harness = { starts: number; active: number; paused: boolean; scope: string; finish: (error?: string) => void; render: () => void; unmount: () => void };
type TestWindow = Window & { polling: Harness };
async function mount(page: Page, interval = 10_000) {
  await page.goto("/");
  await page.clock.install();
  await page.evaluate(async interval => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const hookPath = "/src/app/cluster/useAutoRefresh.ts";
    const reactModule = await import(/* @vite-ignore */ reactPath);
    const React = reactModule.default ?? reactModule;
    const domModule = await import(/* @vite-ignore */ domPath);
    const { createRoot } = domModule.default ?? domModule;
    const { useAutoRefresh } = await import(/* @vite-ignore */ hookPath);
    const element = document.createElement("section"); document.body.append(element);
    const root = createRoot(element);
    const harness: Harness = { starts: 0, active: 0, paused: false, scope: "one", finish: () => {}, render: () => root.render(React.createElement(Probe)), unmount: () => root.unmount() };
    function Probe() {
      const [busy, setBusy] = React.useState(false);
      const auto = useAutoRefresh({ scope: harness.scope, interval, busy, paused: harness.paused,
        refresh: () => { harness.starts++; harness.active++; setBusy(true); } });
      harness.finish = (reason?: string) => { harness.active--; auto.complete(reason); setBusy(false); };
      return React.createElement("output", { id: "polling-mounted" }, "ready");
    }
    (window as TestWindow).polling = harness; harness.render();
  }, interval);
  await expect(page.locator("#polling-mounted")).toHaveText("ready");
  await page.evaluate(() => {
    document.querySelector("#astryx-app-shell-main")?.closest("#root")?.remove();
  });
}
const starts = (page: Page) => page.evaluate(() => (window as TestWindow).polling.starts);

test("waits after completion, never overlaps, and tears down timers", async ({ page }) => {
  await mount(page);
  await page.clock.fastForward(10_000); await expect.poll(() => starts(page)).toBe(1);
  await page.clock.fastForward(60_000); expect(await starts(page)).toBe(1);
  await page.evaluate(() => (window as TestWindow).polling.finish());
  await page.clock.fastForward(9_000); expect(await starts(page)).toBe(1);
  await page.clock.fastForward(1_000); await expect.poll(() => starts(page)).toBe(2);
  await page.evaluate(() => (window as TestWindow).polling.unmount());
  await page.clock.fastForward(60_000); expect(await starts(page)).toBe(2);
});

test("backs off transient failures, stops terminal failures, and resets for a new scope", async ({ page }) => {
  await mount(page);
  await page.clock.fastForward(10_000); await expect.poll(() => starts(page)).toBe(1);
  await page.evaluate(() => (window as TestWindow).polling.finish("network"));
  await page.clock.fastForward(10_000); expect(await starts(page)).toBe(1);
  await page.clock.fastForward(10_000); await expect.poll(() => starts(page)).toBe(2);
  await page.evaluate(() => (window as TestWindow).polling.finish("staleSession"));
  await page.clock.fastForward(120_000); expect(await starts(page)).toBe(2);
  await page.evaluate(() => { const h = (window as TestWindow).polling; h.scope = "two"; h.render(); });
  await page.clock.fastForward(10_000); await expect.poll(() => starts(page)).toBe(3);
});

test("pauses during editing and dialogs, resumes on focus without a storm", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { const input = document.createElement("input"); input.id = "editing"; document.body.append(input); input.focus(); });
  await page.clock.fastForward(30_000); expect(await starts(page)).toBe(0);
  await page.evaluate(() => { document.querySelector("#editing")!.remove(); const dialog = document.createElement("section"); dialog.setAttribute("role", "dialog"); dialog.id = "confirmation"; document.body.append(dialog); });
  await page.clock.fastForward(30_000); expect(await starts(page)).toBe(0);
  await page.evaluate(() => { document.querySelector("#confirmation")!.remove(); for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => starts(page)).toBe(1);
});

test("pauses hidden/offline views and refreshes immediately on return", async ({ page }) => {
  await mount(page, 30_000);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); });
  await page.clock.fastForward(90_000); expect(await starts(page)).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => starts(page)).toBe(1);
});
