import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const token = "hypeman-project-execution-fixture";
const models = ["Model A", "Model B", "Model C"], prices = [749, 799, 849];
const decisions = [];
let site, context, home, article, existingTargetTab;
const fixture = http.createServer((request, response) => {
  const path = new URL(request.url, "http://fixture").pathname;
  const number = Number(path.match(/laptop-(\d)/)?.[1] ?? 0);
  const links = models.map((model, index) => `<a href="/laptop-${index + 1}">${model}</a>`).join(" · ");
  const text = number ? `${models[number - 1]} costs $${prices[number - 1]}. Memory: 16 GB. Storage: 512 GB. Weight: ${number + 2} lb.` : "Find laptops under $900.";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><head><title>${number ? models[number - 1] : "Laptop research"}</title>
  <style>body{font:20px system-ui;max-width:42rem;margin:3rem auto;padding:1rem}a{margin-right:.5rem}select,button{font:inherit}</style></head>
  <body><h1>${number ? models[number - 1] : "Laptop research"}</h1><p>${text}</p><nav>${links}</nav>
  ${path.endsWith("/configure") ? '<label for="memory">Memory</label><select id="memory"><option>8 GB</option><option>16 GB</option></select><button id="order">Place order</button><script>window.orders=0;document.querySelector("#order").onclick=()=>window.orders++;</script>' : '<p><a href="/laptop-2/configure">Configure Model B</a></p>'}</body></html>`);
});
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token,
  agent: async (input) => {
    decisions.push(input);
    const reply = (action) => ({ action, done: true, provider: "demo" });
    const path = new URL(input.page.url).pathname;
    if (!input.task) return reply({ type: "plan", goal: input.goal, steps: ["Compare three laptops under $900", "Configure the chosen laptop"] });
    if (input.task.steps[0].status === "done") {
      if (!path.endsWith("/configure")) return reply({ type: "navigate", url: `${site}/laptop-2/configure`, newTab: true });
      const memory = input.page.elements.find((item) => item.name === "Memory");
      if (memory.value !== "16 GB") return reply({ type: "select", target: memory.id, value: "16 GB" });
      return reply({ type: "ask", question: "Model B is configured with 16 GB memory. Review it before placing an order." });
    }
    if (path === "/start") return reply({ type: "navigate", url: `${site}/search`, newTab: true });
    if (path === "/search") return reply({ type: "navigate", url: `${site}/laptop-1`, newTab: true });
    const number = Number(path.match(/laptop-(\d)/)?.[1]);
    const model = models[number - 1];
    if (!input.history.some((entry) => entry.action.type === "note" && entry.action.text.startsWith(`${model} costs`))) {
      const excerpt = `${model} costs $${prices[number - 1]}. Memory: 16 GB. Storage: 512 GB. Weight: ${number + 2} lb.`;
      return reply({ type: "note", text: excerpt, excerpt });
    }
    if (number === 1) return reply({ type: "switchTab", tabId: existingTargetTab });
    if (number < 3) return reply({ type: "navigate", url: `${site}/laptop-${number + 1}`, newTab: true });
    assert.ok(input.sources.some((note) => note.text.includes("Model A costs $749")));
    assert.ok(input.sources.some((note) => note.text.includes("Model B costs $799")));
    assert.ok(input.sources.some((note) => note.text.includes("Model C costs $849")));
    return reply({ type: "ask", question: "Model A is $749, Model B is $799, and Model C is $849. All have 16 GB memory and 512 GB storage. Choose a model to configure." });
  },
  assessTask: async (input) => ({ stepId: input.task.steps.find((step) => step.status === "doing").id, completed: false, evidence: "" }),
});
const profile = await mkdtemp(join(tmpdir(), "hypeman-project-execution-"));
async function waitFor(predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate(); if (result) return result;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function rpc(message) {
  return home.evaluate(async (message) => {
    const response = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    if (!response?.ok) throw new Error(response?.error || "No extension response");
    return response.data;
  }, message);
}
async function panel(page) {
  if (!await page.locator(".conversation-pane").isVisible())
    await page.getByRole("button", { name: /Open HypeMan\. Drag to move/ }).click();
  return page.locator(".conversation-pane");
}
async function send(page, message) {
  const chat = await panel(page);
  await chat.getByRole("textbox", { name: "What do you need?", exact: true }).fill(message);
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
}
async function prepareWindows(page) {
  await send(page, "open whiteboard");
  const board = page.locator(".workspace-board:visible");
  await board.waitFor();
  const before = await board.boundingBox();
  await board.getByRole("group", { name: "Resize Whiteboard window", exact: true }).press("Shift+ArrowLeft");
  await board.getByRole("group", { name: "Resize Whiteboard window", exact: true }).press("ArrowUp");
  await board.locator(".pixel-workspace-bar").press("ArrowLeft");
  const rect = await waitFor(async () => {
    const rect = await board.boundingBox();
    return rect.width < before.width - 40 && rect.height < before.height - 5 ? rect : null;
  }, "board moved and resized before project");
  await send(page, "open notes");
  const notes = page.locator(".workspace-notes:visible");
  await notes.getByRole("button", { name: "Minimize Notes window", exact: true }).click();
  await waitFor(async () => await notes.getAttribute("data-minimized") === "true", "notes minimized before project");
  return rect;
}
async function restoredWindows(page, rect) {
  // Assert restoration before panel/send can reopen anything.
  await page.locator(".conversation-pane:visible").waitFor();
  const board = page.locator(".workspace-board:visible"), notes = page.locator(".workspace-notes:visible");
  await board.waitFor(); await notes.waitFor();
  await waitFor(async () => {
    const actual = await board.boundingBox();
    return ["x", "y", "width", "height"].every((key) => Math.abs(actual[key] - rect[key]) <= 1);
  }, `navigation restores board position and size on ${page.url()}`);
  assert.equal(await notes.getAttribute("data-minimized"), "true", "notes stay minimized after handoff");
  assert.equal(await notes.locator(".pixel-workspace-content").isVisible(), false);
}
try {
  const gatewayUrl = `http://127.0.0.1:${await gateway.listen()}`;
  await new Promise((done) => fixture.listen(0, "127.0.0.1", done));
  site = `http://127.0.0.1:${fixture.address().port}`;
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"],
  });
  context.setDefaultTimeout(15_000);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  home = await context.newPage();
  await home.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html#chat`);
  await home.locator("#task-goal").waitFor();
  await rpc({ type: "settings.patch", patch: { serverUrl: gatewayUrl, serverToken: token, onboarded: true,
    reducedMotion: "on", learningEnabled: true, proactiveEnabled: false, tabContextEnabled: true } });
  const existing = await context.newPage(); await existing.goto(`${site}/laptop-2`);
  existingTargetTab = await home.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, existing.url());
  assert.ok(Number.isInteger(existingTargetTab));
  article = await context.newPage(); await article.goto(`${site}/start`); await article.bringToFront();
  const preservedBoard = await prepareWindows(article);
  await send(article, "Compare three laptops under $900, then help me configure the best one.");
  await waitFor(() => decisions.some((input) => new URL(input.page.url).pathname === "/laptop-3" && input.history.some((entry) => entry.action.type === "note" && entry.action.text.startsWith("Model C"))), "three observed product pages and comparison");
  const products = context.pages().filter((page) => /\/laptop-[123]$/.test(new URL(page.url()).pathname));
  assert.equal(products.length, 3);
  assert.equal(article.url(), `${site}/start`);
  assert.ok(decisions.every((input) => input.mode === "browse"));
  const workspace = await rpc({ type: "workspace.get" });
  assert.equal(workspace.tasks.length, 1);
  assert.equal(workspace.notes.filter((note) => note.taskId === workspace.activeTaskId).length, 3);
  for (let index = 0; index < 3; index++) {
    const note = workspace.notes.find((note) => note.url === `${site}/laptop-${index + 1}`);
    assert.ok(note.excerpt.includes(`${models[index]} costs $${prices[index]}`));
  }
  const last = products.find((page) => page.url().endsWith("/laptop-3"));
  await last.bringToFront();
  for (const product of products) await restoredWindows(product, preservedBoard);
  await (await panel(last)).getByText(/Choose a model to configure\./).waitFor();
  assert.ok(decisions.some((input) => new URL(input.page.url).pathname === "/laptop-2" && input.history.some((entry) => entry.action.type === "switchTab")));
  console.log("✓ One project request visits new and existing product tabs with chat, resized board and minimized notes preserved");
  await send(last, "done step 1");
  const configuration = await waitFor(() => context.pages().find((page) => page.url() === `${site}/laptop-2/configure`), "configuration opens in a new tab");
  await restoredWindows(configuration, preservedBoard);
  await waitFor(async () => await configuration.getByLabel("Memory", { exact: true }).inputValue() === "16 GB", "next milestone configures the laptop automatically");
  assert.equal(await configuration.evaluate(() => window.orders), 0);
  const after = await rpc({ type: "workspace.get" });
  assert.deepEqual(after.tasks[0].steps.map((step) => step.status), ["done", "doing"]);
  const configure = decisions.find((input) => input.page.url.endsWith("/configure"));
  assert.ok(configure.sources.some((note) => note.text.includes("Model A costs $749")));
  assert.ok(configure.sources.some((note) => note.text.includes("Model B costs $799")));
  console.log("✓ Completing the comparison starts configuration with previous sources intact and no purchase");
  assert.equal(context.pages().filter((page) => /\/laptop-[123]$/.test(new URL(page.url()).pathname)).length, 3);
  console.log("2 automatic project execution browser scenarios passed.");
} finally {
  await context?.close(); await gateway.close();
  await new Promise((done) => fixture.close(done));
  await rm(profile, { recursive: true, force: true });
}
