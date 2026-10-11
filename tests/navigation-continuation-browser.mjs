import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const token = "hypeman-navigation-continuation-fixture";
const profile = await mkdtemp(join(tmpdir(), "hypeman-navigation-continuation-"));
const decisions = [], loads = new Map(), externalRequests = [];
const intro = "Find an adjustable desk lamp under $35. Ask me which page to open.";
const scenarios = [
  { name: "observed _blank noopener link", prefix: "native", marker: "native-ready", completion: "Native lamp review is ready." },
  { name: "ordinary existing-tab switch", prefix: "existing", marker: "existing-ready", completion: "Existing lamp review is ready." },
];
for (const scenario of scenarios) scenario.message = `Open the adjustable lamp ${scenario.prefix === "native" ? "in its own tab" : "in the existing product tab"} and write ${scenario.marker} in its Review label field. Keep the $35 budget; do not purchase.`;
let site, context, home, existingTabId;
const fixture = http.createServer((request, response) => {
  const path = new URL(request.url, "http://fixture.invalid").pathname;
  if (path === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  const scenario = scenarios.find(({ prefix }) => path.startsWith(`/${prefix}-`));
  if (!scenario) { response.writeHead(404); response.end("Unknown fixture"); return; }
  loads.set(path, (loads.get(path) || 0) + 1);
  const source = path.endsWith("-source");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(`<!doctype html><html><head><title>Fictional ${scenario.prefix} lamp ${source ? "search" : "review"}</title></head><body><main>
    <h1>${source ? "Desk lamps under $35" : "Adjustable desk lamp"}</h1>
    <p>Fictional adjustable lamp, $24.99. Small desk clamp. Bulb included.</p>
    ${source ? `<a href="/${scenario.prefix}-destination" target="_blank" rel="noopener">Open adjustable lamp</a>` : `<label>Review label <input aria-label="Review label" autocomplete="off"></label><p>No purchases or account actions are available.</p>`}
    </main><script>window.reviewEdits = 0; document.querySelector('input')?.addEventListener('input', () => window.reviewEdits++);</script></body></html>`);
});
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token,
  agent: async (input) => {
    const path = new URL(input.page.url).pathname;
    const scenario = scenarios.find(({ prefix }) => path.startsWith(`/${prefix}-`));
    assert.ok(scenario, `Unexpected agent page: ${input.page.url}`);
    let reply;
    if (input.message === intro) reply = { action: { type: "ask", question: "Ready to open the adjustable lamp?" }, done: true, provider: "demo" };
    else {
      assert.equal(input.message, scenario.message, "Latest steering is retained after handoff");
      if (path.endsWith("-source")) {
        if (scenario.prefix === "native") {
          const link = input.page.elements.find((element) => element.name === "Open adjustable lamp");
          assert.ok(link && link.href === `${site}/native-destination`, "The click uses an actually observed destination");
          reply = { action: { type: "click", target: link.id }, done: false, provider: "demo" };
        } else reply = { action: { type: "switchTab", tabId: existingTabId }, done: false, provider: "demo" };
      } else {
        const field = input.page.elements.find((element) => element.name === "Review label");
        assert.ok(field, "Destination input is observed before editing it");
        reply = field.value === scenario.marker
          ? { action: { type: "say", text: scenario.completion }, done: true, provider: "demo" }
          : { action: { type: "type", target: field.id, text: scenario.marker }, done: false, provider: "demo" };
      }
    }
    decisions.push({ input: structuredClone(input), reply });
    return reply;
  },
});
async function waitFor(predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 75));
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
async function send(page, text) {
  if (!await page.locator(".conversation-pane").isVisible())
    await page.getByRole("button", { name: /^Open HypeMan\. Drag/ }).click();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "What do you need?", exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
try {
  const gatewayUrl = `http://127.0.0.1:${await gateway.listen()}`;
  await new Promise((done) => fixture.listen(0, "127.0.0.1", done));
  site = `http://127.0.0.1:${fixture.address().port}`;
  const extension = resolve(process.env.HYPEMAN_TEST_EXTENSION_DIR || "apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging", "--disable-background-networking"],
  });
  context.setDefaultTimeout(20_000);
  await context.route(/^https?:\/\//, async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "127.0.0.1") await route.continue();
    else {
      // Fresh profiles briefly probe the default local gateway before fixture settings arrive.
      // Keep those probes blocked too, but do not misclassify loopback as external traffic.
      if (!["localhost", "[::1]", "::1"].includes(hostname)) externalRequests.push(route.request().url());
      await route.abort();
    }
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 20_000 });
  home = await context.newPage();
  await home.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html#chat`);
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).waitFor();
  await rpc({ type: "settings.patch", patch: { serverUrl: gatewayUrl, serverToken: token, onboarded: true,
    reducedMotion: "on", learningEnabled: false, proactiveEnabled: false, tabContextEnabled: true } });
  for (const scenario of scenarios) {
    const existing = scenario.prefix === "existing" ? await context.newPage() : null;
    if (existing) {
      await existing.goto(`${site}/existing-destination`);
      existingTabId = await home.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, existing.url());
      assert.ok(Number.isInteger(existingTabId));
    }
    const source = await context.newPage();
    await source.goto(`${site}/${scenario.prefix}-source`);
    await source.bringToFront();
    await send(source, intro);
    await source.locator(".chat-message.assistant").filter({ hasText: "Ready to open the adjustable lamp?" }).waitFor();
    await send(source, scenario.message);
    const destination = existing || await waitFor(() => context.pages().find((page) => page.url() === `${site}/native-destination`), "observed link opens its destination tab");
    await destination.getByRole("textbox", { name: "Review label", exact: true }).waitFor();
    await waitFor(async () => await destination.getByRole("textbox", { name: "Review label", exact: true }).inputValue() === scenario.marker, `${scenario.name} executes the remaining edit`);
    const completed = await waitFor(() => decisions.find(({ input, reply }) => input.page.url === destination.url() && reply.action.type === "say" && reply.action.text === scenario.completion), `${scenario.name} completes once`);
    await destination.locator(".chat-message.assistant").filter({ hasText: scenario.completion }).waitFor();
    await destination.getByRole("button", { name: "Send message", exact: true }).waitFor();
    let lastCount = decisions.length, quietSince = Date.now();
    await waitFor(() => {
      if (lastCount !== decisions.length) { lastCount = decisions.length; quietSince = Date.now(); }
      return Date.now() - quietSince >= 500;
    }, "handoff hydration and dispatch become idle without duplicate work");
    const trace = decisions.filter(({ input }) => input.message === scenario.message);
    const started = trace.find(({ input }) => input.page.url === source.url());
    assert.ok(started?.input.conversationId, "Source has a saved conversation");
    assert.equal(completed.input.conversationId, started.input.conversationId);
    assert.equal(completed.input.goal, started.input.goal);
    assert.equal(completed.input.message, scenario.message);
    assert.ok(completed.input.conversation.some((turn) => turn.role === "user" && turn.text === intro), "The earlier budget request remains in the same conversation");
    assert.ok(completed.input.history.some((entry) => entry.action.type === (scenario.prefix === "native" ? "click" : "switchTab") && entry.result.ok), "The verified navigation action survives the handoff");
    assert.equal(completed.input.history.filter((entry) => entry.action.type === "type" && entry.result.ok).length, 1, "One successful destination edit is recorded");
    assert.equal(trace.filter(({ reply }) => reply.action.type === "type").length, 1, "The edit is proposed once");
    assert.equal(trace.filter(({ reply }) => reply.action.type === "say" && reply.action.text === scenario.completion).length, 1, "One completion is proposed");
    assert.equal(trace.filter(({ input }) => input.page.url === source.url()).length, 1, "The successful source click/switch is not repeated");
    assert.equal(await destination.evaluate(() => window.reviewEdits), 1, "The destination receives one actual input event");
    assert.equal(context.pages().filter((page) => page.url() === destination.url()).length, 1);
    assert.equal(loads.get(`/${scenario.prefix}-destination`), 1, "Only one destination document loads");
    const conversation = await rpc({ type: "conversation.open", conversationId: started.input.conversationId });
    assert.equal(conversation.messages.filter((message) => message.role === "assistant" && message.text === scenario.completion).length, 1, "One completion is persisted to shared chat");
    assert.equal(await destination.locator(".conversation-pane .notice.error:visible").count(), 0);
    assert.equal((await rpc({ type: "workspace.get" })).tasks.length, 0, "Ordinary handoffs do not create a project");
    console.log(`✓ ${scenario.name} retains conversation, latest steering and verified history; one edit and completion`);
    await source.close(); await destination.close();
  }
  assert.deepEqual(externalRequests, [], "All browser fixture traffic stays local");
  console.log("2 ordinary navigation continuation browser scenarios passed.");
} finally {
  await context?.close(); await gateway.close();
  await new Promise((done) => fixture.close(done));
  await rm(profile, { recursive: true, force: true });
}
