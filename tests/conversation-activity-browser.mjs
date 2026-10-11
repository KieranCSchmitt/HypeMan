import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const token = "hypeman-shared-activity-fixture";
const profile = await mkdtemp(join(tmpdir(), "hypeman-shared-activity-"));
const first = "Open the review page and fill both review labels. Do not submit anything.";
const again = "Try the second review label again and use retry-ready. Do not submit anything.";
const completion = "The second review label is ready. Nothing was submitted.";
const trace = [], external = [];
let site, context, home, destination, delayed = false, release;
const hold = new Promise(done => { release = done; });
const fixture = http.createServer((request, response) => {
  if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(`<!doctype html><html><head><title>Fictional lamp review</title></head><body><main>
    <h1>Review labels for an adjustable desk lamp</h1><p>Fictional lamp, $24.99. This page has no submission controls.</p>
    <label>First review label <input aria-label="First review label"></label>
    <label>Second review label <input aria-label="Second review label"></label>
    </main><script>window.edits=[];document.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>window.edits.push([input.getAttribute('aria-label'),input.value])));</script></body></html>`);
});
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token,
  agent: async input => {
    trace.push(structuredClone(input));
    if (input.surface === "conversation") return { action: { type: "navigate", url: `${site}/review` }, done: true, provider: "demo" };
    const fields = Object.fromEntries(input.page.elements.filter(row => row.kind === "input" || row.name?.includes("review label")).map(row => [row.name, row]));
    assert.ok(fields["First review label"] && fields["Second review label"], `Review fields missing: ${JSON.stringify(input.page.elements.map(row => ({ name: row.name, kind: row.kind })))}`);
    if (input.message === first) {
      if (!fields["First review label"].value) return { action: { type: "type", target: fields["First review label"].id, text: "first-ready" }, say: "Added the first review label.", done: false, provider: "demo" };
      delayed = true;
      await hold;
      return { action: { type: "type", target: fields["Second review label"].id, text: "must-not-run" }, done: false, provider: "demo" };
    }
    assert.equal(input.message, again);
    return fields["Second review label"].value === "retry-ready"
      ? { action: { type: "say", text: completion }, done: true, provider: "demo" }
      : { action: { type: "type", target: fields["Second review label"].id, text: "retry-ready" }, done: false, provider: "demo" };
  },
});
async function waitFor(predicate, description, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await predicate(); if (value) return value; await new Promise(done => setTimeout(done, 50)); }
  throw new Error(`Timed out: ${description}`);
}
async function rpc(message) {
  return home.evaluate(async message => {
    const reply = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    if (!reply?.ok) throw new Error(reply?.error || "No extension reply");
    return reply.data;
  }, message);
}
async function send(text) {
  await home.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).fill(text);
  await home.getByRole("button", { name: "Send message", exact: true }).click();
}
try {
  const gatewayUrl = `http://127.0.0.1:${await gateway.listen()}`;
  await new Promise(done => fixture.listen(0, "127.0.0.1", done));
  site = `http://127.0.0.1:${fixture.address().port}`;
  const extension = resolve(process.env.HYPEMAN_TEST_EXTENSION_DIR || "apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging", "--disable-background-networking"] });
  context.setDefaultTimeout(20_000);
  await context.route(/^https?:\/\//, async route => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "127.0.0.1") return route.continue();
    if (!["localhost", "[::1]", "::1"].includes(hostname)) external.push(route.request().url());
    await route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  home = await context.newPage();
  await home.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html#chat`);
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).waitFor();
  await rpc({ type: "settings.patch", patch: { serverUrl: gatewayUrl, serverToken: token, onboarded: true,
    reducedMotion: "on", learningEnabled: false, proactiveEnabled: false, tabContextEnabled: false } });
  const unrelated = await context.newPage(); await unrelated.goto(`${site}/unrelated`);
  await home.bringToFront(); await send(first);
  destination = await waitFor(() => context.pages().find(page => page.url() === `${site}/review`), "browser handoff opens review");
  await waitFor(() => delayed, "second gateway decision is deliberately pending");
  assert.equal(await destination.getByRole("textbox", { name: "First review label", exact: true }).inputValue(), "first-ready");
  const conversationId = trace.find(input => input.surface === "conversation").conversationId;
  await home.bringToFront();
  await home.getByRole("button", { name: "Stop", exact: true }).waitFor();
  await home.locator(".conversation-working").filter({ hasText: "127.0.0.1" }).waitFor();
  await home.locator(".chat-message.assistant").filter({ hasText: "Added the first review label." }).waitFor();
  assert.equal(await home.locator(".chat-message.assistant").filter({ hasText: "Added the first review label." }).count(), 1);
  await home.getByRole("button", { name: "Show working tab", exact: true }).click();
  const destinationId = await home.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, destination.url());
  assert.equal(await home.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id), destinationId);
  await home.bringToFront();
  await mkdir("tests/screenshots", { recursive: true });
  await home.screenshot({ path: "tests/screenshots/conversation-activity-origin.png" });
  await home.getByRole("button", { name: "Stop", exact: true }).click();
  await home.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await waitFor(async () => (await rpc({ type: "conversation.activity.get", conversationId })) === null, "shared activity clears after Stop");
  release();
  // Give the aborted gateway response time to arrive. It must not activate the held field edit.
  await new Promise(done => setTimeout(done, 600));
  assert.equal(await destination.getByRole("textbox", { name: "Second review label", exact: true }).inputValue(), "");
  assert.equal((await destination.evaluate(() => window.edits)).length, 1);
  const stopped = await rpc({ type: "conversation.open", conversationId });
  assert.equal(stopped.messages.filter(row => row.role === "status" && row.text === "Stopped. Completed work is saved.").length, 1);
  assert.ok(!stopped.messages.some(row => /Cancelled or timed out|Progress saved\. Retry/.test(row.text)), "Explicit Stop does not add a transport-failure notice");
  await home.locator(".chat-message.status").filter({ hasText: "Stopped. Completed work is saved." }).waitFor();
  assert.deepEqual(await unrelated.evaluate(() => window.edits), []);
  console.log("✓ Origin shows working site, partial reply and correct tab; remote Stop cancels delayed edit once");
  await send(again);
  const retried = await waitFor(() => context.pages().find(page => page !== destination && page.url() === `${site}/review`), "new run opens its review page");
  await waitFor(async () => await retried.getByRole("textbox", { name: "Second review label", exact: true }).inputValue() === "retry-ready", "new run succeeds after cancellation");
  await home.locator(".chat-message.assistant").filter({ hasText: completion }).waitFor();
  await home.getByRole("button", { name: "Send message", exact: true }).waitFor();
  assert.equal(await home.locator(".chat-message.assistant").filter({ hasText: completion }).count(), 1);
  assert.equal(await rpc({ type: "conversation.activity.get", conversationId }), null);
  assert.equal((await rpc({ type: "conversation.open", conversationId })).messages.filter(row => row.text === completion).length, 1);
  assert.equal(await destination.getByRole("textbox", { name: "Second review label", exact: true }).inputValue(), "", "The cancelled run never resumes");
  assert.deepEqual(external, []);
  console.log("✓ A new run completes in the same chat after Stop; one shared final reply, no unrelated tab edits");
  console.log("2 shared conversation activity browser scenarios passed.");
} catch (error) {
  console.error("Fixture decision trace:", JSON.stringify(trace.map(input => ({ surface: input.surface, message: input.message, url: input.page.url, elements: input.page.elements.map(row => ({ name: row.name, kind: row.kind, value: row.value })), history: input.history.map(row => ({ type: row.action.type, ok: row.result.ok, error: row.result.error })) })), null, 2));
  if (home) console.error("Origin chat:", await home.locator(".conversation-pane").innerText().catch(() => "unavailable"));
  for (const page of context?.pages() || []) if (page.url() === `${site}/review`) console.error("Review chat:", await page.locator(".conversation-pane").innerText().catch(() => "unavailable"));
  throw error;
} finally {
  release(); await context?.close(); await gateway.close();
  await new Promise(done => fixture.close(done)); await rm(profile, { recursive: true, force: true });
}
