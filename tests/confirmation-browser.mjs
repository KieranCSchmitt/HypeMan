import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const serve = process.argv.includes("--serve");
const reviewText = ["Search · www.expedia.com", "New York → Chicago", "November 6–10, 2026", "1 adult, Economy", ...Array.from({ length: 12 }, (_, index) => `Review detail ${index + 1}: retain the requested date and location.`), "Review end marker"].join("\n");
// Render the real workbench and production styles with a deterministic runtime.
// No installed extension, external page, model service, or user profile is used.
const source = `
import { createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS } from "@core";
import { ConversationWorkbench } from "./apps/extension/src/ui/ConversationWorkbench";
const listeners = new Set();
let snapshot = { conversationId: "fixture", phase: "idle", status: "Ready", messages: [], confirmation: null, task: null, video: null, sketch: null,
  learning: { enabled: false, hintLevel: 0, plan: [], teaching: null, autoHint: null }, settings: DEFAULT_SETTINGS, reducedMotion: true, screenshotAttached: false };
const notify = () => { for (const listener of listeners) listener(); };
window.fixtureAnswers = [];
window.fixtureReview = message => { snapshot = { ...snapshot, phase: "confirming", status: "Thinking…", confirmation: { message, label: "Submit" } }; notify(); };
const runtime = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setConversationId() {}, setToolHandler() {}, setSelectedContent() {}, stop() {},
  confirm(answer) { window.fixtureAnswers.push(answer); snapshot = { ...snapshot, phase: "idle", confirmation: null }; notify(); } };
const manual = new URLSearchParams(location.search).has("manual");
const showReview = manual ? createElement("button", { type: "button", style: { position: "fixed", right: 24, top: 24, padding: 12 }, onClick: () => window.fixtureReview(${JSON.stringify(reviewText)}) }, "Show confirmation") : null;
createRoot(document.getElementById("root")).render(createElement(Fragment, null, showReview, createElement(ConversationWorkbench, { runtime })));
`;
const stubs = {
  bridge: `
    export async function request(message) {
      if (message.type === "conversation.resolve") return { id: "fixture", messages: [{ id: "existing", role: "assistant", text: "Existing conversation context. ".repeat(80), at: 1 }] };
      if (message.type === "workbench.ui.get") return window.fixtureUI;
      if (message.type === "workbench.ui.patch") { window.fixtureUI = { ...window.fixtureUI, ...message.patch, geometry: { ...window.fixtureUI.geometry, ...message.patch.geometry } }; return window.fixtureUI; }
      return {};
    }
    export const subscribe = () => () => {};
  `,
  hooks: `import { DEFAULT_SETTINGS } from "@core"; export const useSettings = () => ({ settings: DEFAULT_SETTINGS }); export const exportWorkspace = async () => {}; export const host = value => value; export const message = value => String(value); export const relativeTime = () => "";`,
  ToolOverlay: "export const ToolOverlay = () => null;",
  Video: "export const parseCaptions = () => [];",
};
const bundle = await build({ stdin: { contents: source, resolveDir: resolve("."), loader: "jsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  alias: { "@core": resolve("packages/core/src/index.ts") }, define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "fixture-neighbors", setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)(bridge|hooks|ToolOverlay|Video)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: resolve(".") }));
  } }],
});
const styles = (await Promise.all(["ui.css", "y2k-base.css", "y2k-hub.css", "y2k-tools.css", "overlays.css", "tool-theme.css"].map(name => readFile(`apps/extension/public/${name}`, "utf8")))).join("\n");
const font = await readFile("apps/extension/public/assets/fonts/Tiny5.ttf");
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(styles); return; }
  if (url.pathname.endsWith("Tiny5.ttf")) { response.setHeader("Content-Type", "font/ttf"); response.end(font); return; }
  const rect = { x: 24, y: 24, width: Number(url.searchParams.get("width") || 340), height: Number(url.searchParams.get("height") || 120) };
  const ui = { open: true, tools: [], active: null, geometry: { chat: { rect, minimized: false, maximized: false, restoreRect: null, userResized: true } } };
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.fixtureUI=${JSON.stringify(ui)}</script><script src="/fixture.js"></script></body></html>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
if (serve) {
  console.log(`Confirmation fixture: http://127.0.0.1:${server.address().port}/?manual=1&width=340&height=120`);
  console.log("Press Ctrl+C to stop the isolated fixture server.");
  await new Promise(done => { const close = () => server.close(done); process.once("SIGINT", close); process.once("SIGTERM", close); });
} else {
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir("tests/screenshots", { recursive: true });
  for (const scenario of [
    { viewport: { width: 1440, height: 900 }, width: 340, height: 120 },
    { viewport: { width: 390, height: 560 }, width: 300, height: 180 },
    { viewport: { width: 360, height: 300 }, width: 300, height: 120 },
    { viewport: { width: 1440, height: 900 }, width: 340, height: 400 },
  ]) {
    const page = await browser.newPage({ viewport: scenario.viewport });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?width=${scenario.width}&height=${scenario.height}`);
    const pane = page.locator(".conversation-pane"), composer = page.getByRole("textbox", { name: "What do you need?", exact: true });
    await composer.waitFor(); await page.waitForFunction(() => !document.querySelector("textarea").disabled);
    const before = await pane.boundingBox();
    await page.evaluate(text => window.fixtureReview(text), reviewText);
    const dialog = page.getByRole("alertdialog", { name: "Confirm browser action", exact: true });
    await dialog.waitFor(); await page.evaluate(() => document.fonts.ready);
    assert.equal(await dialog.getByRole("status").textContent(), "Waiting for your confirmation");
    assert.equal(await page.locator(".conversation-working").count(), 0);
    const review = dialog.locator(".confirmation-review");
    const geometry = await dialog.evaluate(element => {
      const box = node => { const { x, y, width, height, bottom, right } = node.getBoundingClientRect(); return { x, y, width, height, bottom, right }; };
      const review = element.querySelector(".confirmation-review");
      return { card: box(element), review: box(review), body: box(element.parentElement), pane: box(element.closest(".conversation-pane")),
        buttons: [...element.querySelectorAll("button")].map(box), font: getComputedStyle(review).fontFamily, scrollHeight: review.scrollHeight, clientHeight: review.clientHeight };
    });
    assert.ok(geometry.font.includes("Tiny5"), "Confirmation retains the Tiny5 pixel typeface");
    assert.ok(geometry.clientHeight >= 26, "Review text has readable height");
    assert.ok(geometry.scrollHeight > geometry.clientHeight, "Long review text scrolls independently");
    assert.ok(geometry.review.right <= geometry.card.right, "Long details wrap within the card");
    for (const button of geometry.buttons) {
      assert.ok(button.height >= 34, "Confirmation controls retain a usable target size");
      assert.ok(button.y >= geometry.body.y - 1 && button.bottom <= geometry.body.bottom + 1, "Action buttons remain visible inside the chat body");
    }
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    if (scenario.viewport.width === 390) await page.screenshot({ path: "tests/screenshots/confirmation-compact.png" });
    await cancel.focus(); await cancel.press("Tab"); assert.equal(await review.evaluate(element => element === document.activeElement), true);
    await review.press("Shift+Tab"); assert.equal(await cancel.evaluate(element => element === document.activeElement), true);
    const end = await review.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      const range = document.createRange(), text = element.firstChild;
      range.setStart(text, text.textContent.lastIndexOf("Review end marker")); range.setEnd(text, text.length);
      return { textBottom: range.getBoundingClientRect().bottom, viewportBottom: element.getBoundingClientRect().bottom };
    });
    assert.ok(end.textBottom <= end.viewportBottom + 1, "The complete review remains reachable by scrolling");
    await cancel.click(); await dialog.waitFor({ state: "detached" });
    const after = await pane.boundingBox();
    assert.equal(after.height, before.height, "The prior compact height is restored");
    assert.equal(after.y, before.y, "The prior window position is restored");
    assert.equal(await composer.evaluate(element => element === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => window.fixtureAnswers), [false]);
    assert.deepEqual(errors, []);
    console.log(`✓ Confirmation at ${scenario.viewport.width}×${scenario.viewport.height}, previous window ${scenario.width}×${scenario.height}`);
    await page.close();
  }
} finally {
  await browser?.close(); await new Promise(done => server.close(done));
}
}
