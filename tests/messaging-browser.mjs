import { installBrowserFixtures } from "./fixtures/browser-pages.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

// Use the real gateway and durable phone service with a deterministic transport.
// No Photon SDK, credentials, or external AI connection is opened in this suite.
const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const { MessagingService } = await tsImport("../apps/gateway/src/messaging.ts", import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "hypeman-messaging-gateway-"));
const profile = await mkdtemp(join(tmpdir(), "hypeman-messaging-browser-"));
const token = "hypeman-messaging-browser-fixture";
const ownerPhone = "+14155551234";
const conversation = "messaging-browser-owner-thread";
const sent = [], decisions = [];
const transport = {
  configured: true,
  connected: true,
  failNext: false,
  async start(receive) { this.receive = receive; },
  async send(destination, text) {
    sent.push({ destination: structuredClone(destination), text });
    if (this.failNext) { this.failNext = false; throw new Error("Fixture response lost after possible acceptance"); }
    return { id: `fixture-outbound-${sent.length}`, spaceId: destination.spaceId || conversation };
  },
  async close() { this.connected = false; },
};
const messaging = new MessagingService({ transport, directory, demo: true });
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token, messaging,
  agent: async (input) => {
    decisions.push(input);
    return { action: { type: "say", text: "Phone goal opened in Chrome. Review the workshops together." }, done: true, provider: "demo" };
  },
});
let context, worker, home, preferences, proxy, base, extensionId;
let sequence = 0, checks = 0;
const check = (name) => { checks++; console.log(`✓ ${name}`); };
async function waitFor(predicate, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
const incoming = (text, patch = {}) => ({
  id: `fixture-inbound-${++sequence}`, sender: ownerPhone, spaceId: conversation,
  text, at: Date.now(), fromMe: false, isGroup: false, ...patch,
});
async function receive(text, patch) { await transport.receive(incoming(text, patch)); }
async function rpc(message) {
  return home.evaluate(async (message) => {
    const reply = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    if (!reply?.ok) throw new Error(reply?.error || "No extension response");
    return reply.data;
  }, message);
}
async function contentRpc(page, message) {
  const tabId = await home.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  assert.ok(Number.isInteger(tabId));
  return worker.evaluate(async ({ tabId, message }) => {
    const result = await chrome.scripting.executeScript({
      target: { tabId }, world: "ISOLATED",
      func: (message) => chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() }),
      args: [message],
    });
    return result[0].result;
  }, { tabId, message });
}
async function launch() {
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1100 },
    proxy: { server: `http://127.0.0.1:${proxy.address().port}`, bypass: "<-loopback>" },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"],
  });
  await installBrowserFixtures(context);
  context.setDefaultTimeout(15000);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
  home = await context.newPage();
  await home.goto(`chrome-extension://${extensionId}/newtab.html#chat`);
  await home.locator("#task-goal").waitFor();
  for (const page of context.pages()) if (page !== home) await page.close();
}
async function chat(page, text, approve) {
  await page.bringToFront();
  const field = page.getByLabel("What do you need?", { exact: true });
  await field.fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await waitFor(async () => await field.inputValue() === "", `composer clears after ${text}`);
  if (approve) await page.getByRole("alertdialog", { name: "Confirm action", exact: true }).getByRole("button", { name: approve, exact: true }).click();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
}
async function openPreferences() {
  preferences = home;
  await chat(preferences, "show phone status");
  const phone = preferences.frameLocator(".workspace-phone-frame").getByRole("region", { name: "Phone companion", exact: true });
  await phone.waitFor();
  return phone;
}
async function refreshPhone() { await chat(preferences, "show phone status"); }

try {
  base = `http://127.0.0.1:${await gateway.listen()}`;
  await messaging.start();
  // Isolate Chromium before installation-created pages can contact any default
  // gateway. This allowlist also blocks external sites, HTTPS CONNECT, and AI.
  proxy = http.createServer((request, response) => {
    let destination;
    try { destination = new URL(request.url, base); }
    catch { response.writeHead(400).end(); return; }
    if (destination.origin !== base) {
      response.writeHead(403).end("Only the messaging fixture gateway is allowed.");
      return;
    }
    const upstream = http.request(destination, { method: request.method, headers: request.headers }, (reply) => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  proxy.on("connect", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
  proxy.on("connection", (socket) => socket.on("error", () => {}));
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  await launch();
  await rpc({ type: "settings.patch", patch: {
    serverUrl: base, serverToken: token, onboarded: true, reducedMotion: "on",
    learningEnabled: false, proactiveEnabled: false, screenshotEnabled: false,
  } });
  let phone = await openPreferences();
  await phone.getByText("Ready to pair", { exact: true }).waitFor();
  assert.equal(messaging.status().paired, false);
  check("Real extension Settings displays a configured Photon connection without live credentials");

  await chat(preferences, `pair phone ${ownerPhone}`, "Pair phone");
  const code = await waitFor(async () => {
    const content = await phone.locator(".phone-pair-code strong").textContent().catch(() => "");
    return content?.match(/^PAIR (\d{6})$/)?.[1];
  }, "desktop pairing code");
  assert.equal(sent[0].destination.phone, ownerPhone);
  assert.ok(!sent[0].text.includes(code), "The pairing invitation must not disclose the desktop code");
  await receive(`PAIR ${code}`, { sender: "+14155559999" });
  assert.equal(messaging.status().paired, false);
  await receive(`PAIR ${code}`);
  await phone.getByText("Paired · •••• 1234", { exact: true }).waitFor();
  await phone.getByRole("tab", { name: "Check-ins", exact: true }).click();
  assert.equal(await phone.getByLabel("Morning planning time", { exact: true }).inputValue(), "09:00");
  assert.equal(await phone.getByLabel("Evening reflection time", { exact: true }).inputValue(), "19:00");
  assert.equal(await phone.getByLabel("Phone timezone", { exact: true }).inputValue(), "America/New_York");
  check("Phone ownership requires the desktop code from the matching sender and shows the default schedule");

  await phone.getByLabel("Morning planning time", { exact: true }).fill("10:30");
  await waitFor(() => messaging.status().settings.morningTime === "10:30", "phone preferences saved");
  assert.equal(messaging.status().settings.morningTime, "10:30");
  const beforeTestText = sent.length;
  await chat(preferences, "send test text", "Send test");
  await waitFor(() => sent.length > beforeTestText, "test text delivered through gateway");
  assert.deepEqual(sent.at(-1).destination, { phone: ownerPhone, spaceId: conversation });
  check("Settings updates persist through the gateway and test texts use only the paired owner");

  const beforeUncertain = sent.length;
  transport.failNext = true;
  await preferences.getByLabel("What do you need?", { exact: true }).fill("send test text");
  await preferences.getByRole("button", { name: "Send message", exact: true }).click();
  await preferences.getByRole("alertdialog", { name: "Confirm action", exact: true }).getByRole("button", { name: "Send test", exact: true }).click();
  await preferences.getByRole("alert").filter({ hasText: "Delivery is uncertain" }).waitFor();
  await refreshPhone(); await refreshPhone();
  assert.equal(sent.length, beforeUncertain + 1, "Refreshing an uncertain delivery must never resend it");
  assert.equal(messaging.status().deliveries.at(-1).status, "unknown");
  await phone.getByText("Uncertain deliveries are not automatically resent.", { exact: true }).waitFor({ state: "attached" });
  check("An uncertain manual delivery stays visible and status refresh never repeats the text");

  await chat(preferences, "remind me to Check the kiln in 2 minutes");
  await phone.getByRole("tab", { name: "Reminders", exact: true }).click();
  const reminder = phone.getByRole("region", { name: "Phone reminders", exact: true }).locator(".phone-item").filter({ hasText: "Check the kiln" });
  await reminder.waitFor();
  assert.equal(messaging.status().reminders.filter((item) => item.status === "pending").length, 1);
  await reminder.click();
  await chat(preferences, "snooze this reminder 30 minutes");
  assert.equal(messaging.status().reminders.filter((item) => item.status === "pending").length, 1);
  await reminder.click();
  await chat(preferences, "cancel this reminder");
  assert.equal(messaging.status().reminders.filter((item) => item.status === "pending").length, 0);
  check("Conversational reminder creation and selected-reminder snooze/cancel use the durable service");

  const target = `${base}/__test/workshops/`;
  const goal = `Compare pottery workshops from ${target}`;
  await receive(`QUEUE ${goal}`, { fromMe: true });
  await receive(`QUEUE ${goal}`, { isGroup: true });
  await receive(`QUEUE ${goal}`, { sender: "+14155559999" });
  assert.equal(messaging.status().captures.length, 0);
  await receive(`QUEUE ${goal}`);
  await refreshPhone();
  await phone.getByRole("tab", { name: "Inbox", exact: true }).click();
  await phone.locator(".phone-inbox .phone-item").filter({ hasText: goal }).waitFor();
  assert.equal((await rpc({ type: "workspace.get" })).tasks.length, 0);
  assert.equal(decisions.length, 0);
  assert.equal(context.pages().filter((page) => page.url().startsWith(base)).length, 0);
  await rpc({ type: "messaging.inbox" }); // Send the durable import acknowledgement.
  assert.ok(messaging.status().captures[0].importedAt > 0);
  assert.equal((await rpc({ type: "messaging.inbox", refresh: false })).captures.length, 1);
  check("Phone captures import once and acknowledge durably without opening tabs or starting browser work");

  await context.close();
  context = undefined;
  await launch();
  phone = await openPreferences();
  await phone.getByText("Paired · •••• 1234", { exact: true }).waitFor();
  await phone.locator(".phone-inbox .phone-item").filter({ hasText: goal }).waitFor();
  assert.equal(await phone.locator(".phone-inbox .phone-item").count(), 1);
  assert.equal(decisions.length, 0);
  assert.equal((await rpc({ type: "messaging.inbox" })).captures.length, 1);
  check("Chrome restart preserves the imported inbox without duplicate captures or automatic continuation");

  await phone.locator(".phone-inbox .phone-item").filter({ hasText: goal }).click();
  await chat(preferences, "continue this idea in chrome", "Continue idea");
  const article = await waitFor(() => context.pages().find((page) => page.url() === target), "explicit Chrome continuation tab");
  await waitFor(() => decisions.find((input) => input.goal === goal), "browser assistant receives the stored phone goal");
  assert.equal((await rpc({ type: "messaging.inbox", refresh: false })).captures.length, 0);
  assert.equal((await rpc({ type: "workspace.get" })).tasks.length, 0);
  check("Only selecting a capture and asking to continue launches the stored goal through the existing browser assistant");

  const noteText = "Pottery workshops include clay and tools; compare the evening schedule.";
  await rpc({ type: "note.save", note: { text: noteText, excerpt: "Clay and tools included", title: "Workshop finding", url: target } });
  await article.bringToFront();
  await article.getByRole("button", { name: /(?:Open|Close) HypeMan\. Drag to move/ }).waitFor();
  if (!await article.getByLabel("What do you need?", { exact: true }).isVisible())
    await article.getByRole("button", { name: /Open HypeMan\. Drag to move/ }).click();
  await chat(article, "open notes");
  const noteEditor = article.getByLabel("Edit note: Workshop finding", { exact: true });
  await noteEditor.waitFor();
  assert.equal(await noteEditor.inputValue(), noteText);
  await noteEditor.click();
  const beforeNoteText = sent.length;
  await chat(article, "text this to me", "Send text");
  await waitFor(() => sent.slice(beforeNoteText).find((message) => message.text.includes(noteText)), "saved-note text from content overlay");
  const sentNote = sent.slice(beforeNoteText).find((message) => message.text.includes(noteText));
  assert.deepEqual(sentNote.destination, { phone: ownerPhone, spaceId: conversation });
  assert.ok(sentNote.text.includes(target));
  const protectedReply = await contentRpc(article, { type: "messaging.settings", patch: { timezone: "Europe/London" } });
  assert.equal(protectedReply.ok, false);
  const ownerOnlyReply = await contentRpc(article, { type: "messaging.send", text: "Owner-only overlay fixture", recipient: "+14155559999" });
  assert.equal(ownerOnlyReply.ok, true);
  assert.deepEqual(sent.at(-1).destination, { phone: ownerPhone, spaceId: conversation });
  check("Text this to me works on real webpage overlays while management stays protected and recipients stay fixed");

  await preferences.bringToFront();
  await receive("SAVE Keep this idea separate from source notes");
  await refreshPhone();
  const idea = phone.locator(".phone-inbox .phone-item").filter({ hasText: "Keep this idea separate from source notes" });
  await idea.waitFor();
  await idea.click();
  await chat(preferences, "dismiss this idea");
  await waitFor(async () => (await rpc({ type: "messaging.inbox" })).captures.length === 0, "dismissed capture stays handled");
  assert.equal((await rpc({ type: "workspace.get" })).notes.length, 1);
  check("Freeform phone ideas remain separate from source notes and dismissed captures do not reappear");

  const remoteUrl = `${base}/__test/workshops/?phone=remote`;
  const remoteText = `control my desktop to open ${remoteUrl}`;
  for (const patch of [{ fromMe: true }, { isGroup: true }, { sender: "+14155559999" }, { spaceId: "wrong-thread" }])
    await receive(remoteText, patch);
  assert.equal(messaging.status().browserRequests?.length, 0);
  const existingProject = await rpc({ type: "task.start", goal: "Existing desktop project", steps: ["Review source notes", "Prepare a decision"], dispatch: false });
  const remote = incoming(remoteText);
  await transport.receive(remote);
  assert.equal(messaging.status().browserRequests.at(-1).status, "queued");
  assert.match(sent.at(-1).text, /queued.*Chrome/i);
  // Wait for the real MV3 alarm, without clicking Sync or Continue on the computer.
  const opened = await waitFor(() => context.pages().find((page) => page.url() === remoteUrl), "phone command automatically opens Chrome", 45000);
  await waitFor(() => messaging.status().browserRequests.at(-1).status === "started", "Chrome acceptance reported to the phone");
  await opened.locator(".conversation-pane:visible").waitFor();
  const decision = await waitFor(() => decisions.find((input) => input.goal.includes(remoteUrl)), "phone goal reaches the browser task runner");
  assert.equal(decision.task?.id, undefined, "Remote commands must not inherit a desktop project's milestones");
  assert.equal((await rpc({ type: "workspace.get" })).activeTaskId, existingProject.id);
  assert.ok(sent.some((message) => /(?:sent to|started in) Chrome/i.test(message.text) && message.text.includes(remoteUrl)));
  assert.ok(!sent.some((message) => /I can.t (?:open|control)/i.test(message.text)));
  await transport.receive(remote); await rpc({ type: "messaging.inbox" }); await rpc({ type: "messaging.inbox" });
  assert.equal(context.pages().filter((page) => page.url() === remoteUrl).length, 1);
  assert.equal(messaging.status().browserRequests.length, 1);
  check("A paired phone command opens a fresh Chrome chat automatically and reports acceptance without changing the existing project");

  const decisionsAfterRemote = decisions.length;
  await context.close(); context = undefined;
  await launch(); await rpc({ type: "messaging.inbox" });
  assert.equal(context.pages().filter((page) => page.url() === remoteUrl).length, 0);
  assert.equal(decisions.length, decisionsAfterRemote);
  assert.equal(messaging.status().browserRequests.at(-1).status, "started");
  phone = await openPreferences();
  check("Duplicate phone events, repeated syncs, and a Chrome restart never relaunch an accepted command");

  await mkdir("tests/screenshots", { recursive: true });
  await preferences.screenshot({ path: "tests/screenshots/hypeman-messaging.png", fullPage: true });
  console.log(`\n${checks} messaging browser scenarios passed.`);
} catch (error) {
  console.error("Messaging browser state", messaging.status());
  console.error("Browser decisions", decisions.map((input) => ({ goal: input.goal, url: input.page.url })));
  await mkdir("tests/screenshots", { recursive: true });
  await preferences?.screenshot({ path: "tests/screenshots/messaging-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await gateway.close();
  proxy?.closeAllConnections();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  await Promise.all([directory, profile].map((path) => rm(path, { recursive: true, force: true })));
}
