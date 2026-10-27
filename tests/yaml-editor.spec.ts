import { test, expect, type Page } from "@playwright/test";

type Fixture = Window & {
  yamlFixture: {
    changes: { version: number; value: string }[];
    render: (props?: { value?: string; readOnly?: boolean; version?: number }) => void;
    unmount: () => void;
  };
};

const browserErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

async function fixture(page: Page, value = "apiVersion: v1\nkind: ConfigMap\n", readOnly = false) {
  if (process.env.YAML_EDITOR_CPU_THROTTLE) {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.YAML_EDITOR_CPU_THROTTLE) });
  }
  await page.route("**/yaml-editor-fixture", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html>
    <html><body><main id="fixture"></main><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = ReactDOM;
      const { YamlEditor } = await import('/src/app/components/YamlEditor.tsx');
      await import('/src/app/components/yaml-editor.css');
      const root = createRoot(document.getElementById('fixture'));
      let props = ${JSON.stringify({ value, readOnly, version: 1 }).replace(/</g, "\\u003c")};
      const changes = [];
      function render(next = {}) {
        props = { ...props, ...next };
        const version = props.version;
        root.render(React.createElement(React.StrictMode, null,
          React.createElement('button', null, 'Before editor'),
          React.createElement(YamlEditor, { label: 'Fixture YAML', value: props.value, isReadOnly: props.readOnly,
            onChange(value) { changes.push({ version, value }); render({ value }); } }),
          React.createElement('button', null, 'After editor')));
      }
      window.yamlFixture = { changes, render, unmount: () => root.unmount() };
      render();
    </script></body></html>` }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => expect(new URL(request.url()).hostname).toBe("127.0.0.1"));
  browserErrors.set(page, errors);
  await page.goto("/yaml-editor-fixture");
  await expect(editor(page)).toHaveAttribute("aria-readonly", String(readOnly));
  await expect(editor(page)).toHaveText(value);
}
const editor = (page: Page) => page.getByRole("textbox", { name: "Fixture YAML", exact: true });
const changes = (page: Page) => page.evaluate(() => (window as Fixture).yamlFixture.changes);
async function rerender(page: Page, props: Parameters<Fixture["yamlFixture"]["render"]>[0]) {
  await page.evaluate(props => (window as Fixture).yamlFixture.render(props), props);
  await page.waitForTimeout(50);
}
async function paste(page: Page, text: string) {
  await editor(page).evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    data.setData("text/html", '<img src="https://example.invalid/never" onerror="window.pasteExecuted=true">');
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}
async function caret(page: Page) {
  return editor(page).evaluate(element => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    return range.toString().length;
  });
}

test("real CodeJar highlights escaped source and exposes a named multiline editor", async ({ page }) => {
  const source = 'kind: ConfigMap\ndata:\n  html: "<img src=x onerror=alert(1)> & café"\n';
  await fixture(page, source);
  await expect(editor(page)).toHaveAttribute("contenteditable", "plaintext-only");
  await expect(editor(page)).toHaveAttribute("aria-multiline", "true");
  await expect(editor(page)).toHaveAccessibleDescription(/Tab moves/);
  await expect(editor(page).locator(".hljs-attr")).not.toHaveCount(0);
  await expect(editor(page).locator("img, script")).toHaveCount(0);
  expect(await changes(page)).toEqual([]);
});

for (const readOnly of [false, true]) {
  test(`queued Tab keyup cannot redirect Shift+Tab (${readOnly ? "read-only" : "editable"})`, async ({ page }) => {
    await fixture(page, "name: old\n", readOnly);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.getByRole("button", { name: "Before editor" }).focus();
    await page.keyboard.press("Tab");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "After editor" })).toBeFocused();
    await page.keyboard.down("Shift");
    // Force the timer between Shift and Tab rather than depending on CI scheduling.
    await page.clock.runFor(30);
    await expect(page.getByRole("button", { name: "After editor" })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.clock.runFor(350);
    await expect(page.getByRole("button", { name: "Before editor" })).toBeFocused();
    expect(await changes(page)).toEqual([]);
  });
}

test("queued edit highlighting and blurred value updates leave outside selection alone", async ({ page }) => {
  await fixture(page, "name: old");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "Before editor" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("End");
  await page.keyboard.press("x");
  await page.keyboard.press("Tab");
  await page.clock.runFor(350);
  await expect(page.getByRole("button", { name: "After editor" })).toBeFocused();
  await page.getByRole("button", { name: "After editor" }).evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await page.evaluate(() => (window as Fixture).yamlFixture.render({ value: "name: updated" }));
  await expect(editor(page)).toHaveText("name: updated");
  await expect(page.getByRole("button", { name: "After editor" })).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("After editor");
  expect(await changes(page)).toEqual([{ version: 1, value: "name: oldx" }]);
});

test("input-only edits publish exact text once, use the latest callback and retain the caret", async ({ page }) => {
  await fixture(page, "name: old\n");
  await rerender(page, { version: 2 });
  await expect(editor(page)).toHaveText("name: old\n");
  await editor(page).fill("name: café");
  await expect.poll(() => changes(page)).toEqual([{ version: 2, value: "name: café" }]);
  await editor(page).press("Home");
  await editor(page).press("ArrowRight");
  const position = await caret(page);
  await rerender(page, { version: 3 });
  expect(await caret(page)).toBe(position);
  await page.keyboard.insertText("x");
  await expect.poll(async () => (await changes(page)).at(-1)?.version).toBe(3);
  await editor(page).press("ArrowLeft");
  await page.waitForTimeout(80);
  expect(await changes(page)).toHaveLength(2);
});

test("multiline input keeps blank lines, trailing newlines and Enter indentation", async ({ page }) => {
  await fixture(page, "");
  const value = "metadata:\n  name: café\n\n";
  await editor(page).fill(value);
  await expect.poll(async () => (await changes(page)).at(-1)?.value).toBe(value);
  await editor(page).fill("  name: café");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await page.keyboard.insertText("other: value");
  await expect.poll(async () => (await changes(page)).at(-1)?.value).toBe("  name: café\n  other: value");
});

test("programmatic values do not feed back, and unchanged values and mode changes preserve selection", async ({ page }) => {
  await fixture(page, "kind: Pod\n");
  await editor(page).focus();
  await editor(page).press("Home");
  await editor(page).press("ArrowRight");
  const position = await caret(page);
  await rerender(page, { value: "kind: Job\n" });
  await expect(editor(page)).toHaveText("kind: Job\n");
  expect(await caret(page)).toBe(position);
  await rerender(page, { readOnly: true });
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  expect(await caret(page)).toBe(position);
  await rerender(page, { readOnly: false });
  await expect(editor(page)).toHaveAttribute("contenteditable", "plaintext-only");
  expect(await caret(page)).toBe(position);
  expect(await changes(page)).toEqual([]);
});

test("plain-text paste escapes HTML, normalizes CRLF and publishes once", async ({ page }) => {
  await fixture(page, "");
  await editor(page).focus();
  const text = 'data:\r\n  html: "<img src=x onerror=alert(1)>"\r\n';
  await paste(page, text);
  await expect(editor(page)).toHaveText(text.replaceAll("\r\n", "\n"));
  await expect(editor(page).locator("img, script")).toHaveCount(0);
  await expect.poll(() => changes(page)).toEqual([{ version: 1, value: text.replaceAll("\r\n", "\n") }]);
});

test("read-only YAML preserves serialization and rejects keyboard, paste, cut and undo", async ({ page }) => {
  const source = "kind: Pod\nmetadata:\n  name: café\n\n";
  await fixture(page, source, true);
  await editor(page).focus();
  await editor(page).press("ControlOrMeta+a");
  await page.keyboard.insertText("overwrite");
  await paste(page, "overwrite");
  await editor(page).evaluate(element => element.dispatchEvent(new ClipboardEvent("cut", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })));
  await editor(page).press("ControlOrMeta+z");
  await expect(editor(page)).toHaveText(source);
  expect(await changes(page)).toEqual([]);
  await rerender(page, { value: "kind: Job\n\n" });
  await expect(editor(page)).toHaveText("kind: Job\n\n");
  expect(await changes(page)).toEqual([]);
});

test("Tab and Shift+Tab leave the editor and Escape remains available to its parent", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Before editor" }).focus();
  await page.keyboard.press("Tab");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "After editor" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Before editor" })).toBeFocused();
  await editor(page).focus();
  const escaped = await editor(page).evaluate(element => {
    let reached = false;
    const listener = (event: KeyboardEvent) => { reached = event.key === "Escape" && !event.defaultPrevented; };
    document.addEventListener("keydown", listener);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.removeEventListener("keydown", listener);
    return reached;
  });
  expect(escaped).toBe(true);
  expect(await changes(page)).toEqual([]);
});

test("composition is not highlighted or published mid-IME, and commits once", async ({ page }) => {
  await fixture(page, "name: ");
  await editor(page).focus();
  await editor(page).press("End");
  await editor(page).evaluate(element => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    document.execCommand("insertText", false, "日本");
    element.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", isComposing: true, bubbles: true }));
  });
  await page.waitForTimeout(80);
  expect(await changes(page)).toEqual([]);
  await expect(editor(page)).toHaveText("name: 日本");
  await editor(page).dispatchEvent("compositionend", { data: "日本" });
  await expect.poll(() => changes(page)).toEqual([{ version: 1, value: "name: 日本" }]);
  await editor(page).dispatchEvent("keyup", { key: "Enter" });
  expect(await changes(page)).toHaveLength(1);
});

test("composition ending after blur publishes without restoring editor focus", async ({ page }) => {
  await fixture(page, "name: ");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "Before editor" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("End");
  await editor(page).evaluate(element => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    document.execCommand("insertText", false, "日本");
  });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "After editor" })).toBeFocused();
  await editor(page).dispatchEvent("compositionend", { data: "日本" });
  await page.clock.runFor(350);
  await expect(page.getByRole("button", { name: "After editor" })).toBeFocused();
  expect(await changes(page)).toEqual([{ version: 1, value: "name: 日本" }]);
});

test("unmount removes handlers and pending callbacks cannot publish", async ({ page }) => {
  await fixture(page);
  await editor(page).focus();
  await editor(page).press("End");
  await editor(page).press("x");
  const count = (await changes(page)).length;
  await editor(page).evaluate(element => {
    (window as Fixture).yamlFixture.unmount();
    element.textContent = "detached";
    element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "x", bubbles: true }));
  });
  await page.waitForTimeout(350);
  expect(await changes(page)).toHaveLength(count);
});
