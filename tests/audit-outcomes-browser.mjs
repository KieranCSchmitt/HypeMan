import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const { MessagingService } = await tsImport("../apps/gateway/src/messaging.ts", import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "hypeman-audit-phone-"));
const profile = await mkdtemp(join(tmpdir(), "hypeman-audit-outcomes-"));
const token = "audit-outcome-fixture", owner = "+12125550123", thread = "audit-phone";
const noteText = "One half plus one quarter equals three quarters because both fractions can be expressed in quarters.";
const source = "https://example.com/fractions";
const outbound = [], decisions = [];
const transport = { configured: true, connected: true, async start(receive) { this.receive = receive; }, async send(destination, text) { outbound.push({ destination, text }); return { id: crypto.randomUUID(), spaceId: thread }; }, async close() {} };
const messaging = new MessagingService({ directory, transport, demo: true });
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), { token, messaging, agent: async (input) => {
  decisions.push(input);
  const completed = input.history.map(entry => entry.action.type === "tool" ? `${entry.action.tool}.${entry.action.operation}` : entry.action.type);
  if (!completed.includes("board.add")) return { action: { type: "tool", tool: "board", operation: "add", args: { objects: [{ kind: "equation", text: "1/2 + 1/4 = 3/4", x: 60, y: 60 }] } }, done: false, provider: "demo" };
  if (!completed.includes("notes.save")) return { action: { type: "tool", tool: "notes", operation: "save", args: { text: noteText, title: "Fractions comparison", url: source } }, done: false, provider: "demo" };
  if (!completed.includes("phone.send")) {
    assert.ok(input.history.some(entry => entry.result.message.includes(noteText)), "The next decision receives the exact saved note");
    return { action: { type: "tool", tool: "phone", operation: "send", args: { text: `${noteText}\n\nSource: ${source}` } }, done: false, provider: "demo" };
  }
  return { action: { type: "say", text: "Diagram saved, note saved, and text sent." }, done: true, provider: "demo" };
} });
let context, home;
async function rpc(message) { return home.evaluate(async message => { const result = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() }); if (!result?.ok) throw new Error(result?.error || "No response"); return result.data; }, message); }
async function waitFor(predicate, label) { const until = Date.now() + 20000; while (Date.now() < until) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(`Timed out: ${label}`); }
async function begin(text) { const field = home.getByRole("textbox", { name: "What do you need?", exact: true }); await field.fill(text); await field.press("Enter"); }
async function idle() { await home.getByRole("button", { name: "Send message", exact: true }).waitFor({ timeout: 25000 }); const errors = await home.locator(".conversation-pane .notice.error:visible").allTextContents(); assert.equal(errors.length, 0, JSON.stringify({ errors, decisions: decisions.map(input => ({ goal: input.goal, history: input.history })) })); }
try {
  await messaging.start(); const base = `http://127.0.0.1:${await gateway.listen()}`;
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  home = await context.newPage(); await home.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html#chat`);
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).waitFor();
  await rpc({ type: "settings.patch", patch: { serverUrl: base, serverToken: token, onboarded: true, proactiveEnabled: false, learningEnabled: true, reducedMotion: "on" } });
  const invitation = await rpc({ type: "messaging.pair", phone: owner });
  await transport.receive({ id: "audit-pair", sender: owner, spaceId: thread, text: `PAIR ${invitation.code}`, at: Date.now(), fromMe: false, isGroup: false });
  await rpc({ type: "messaging.status" }); outbound.length = 0;
  await begin("Draw a fractions diagram, save the comparison, then text it to me");
  const approval = home.getByRole("alertdialog", { name: "Confirm action", exact: true }); await approval.waitFor();
  assert.ok((await approval.innerText()).includes(noteText)); assert.ok((await approval.innerText()).includes(source)); assert.ok((await approval.innerText()).includes("0123"));
  assert.equal(outbound.length, 0, "No text before exact inline review");
  await approval.getByRole("button", { name: "Send text", exact: true }).click(); await idle();
  await waitFor(() => outbound.length === 1, "one approved text");
  assert.equal(outbound[0].text, `${noteText}\n\nSource: ${source}`);
  const state = await rpc({ type: "workspace.get" }); assert.equal(state.notes.length, 1); assert.equal(state.notes[0].text, noteText);
  assert.equal(decisions.length, 4); assert.equal(await home.locator(".workspace-board").count(), 1); assert.equal(await home.locator(".workspace-notes").count(), 1);
  console.log("✓ One avatar request chains board → saved source note → exact inline text review → one delivered fixture message");

  const tabId = await home.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  const conversationId = (await rpc({ type: "conversation.resolve", tabId })).id;
  const original = Buffer.from("%PDF-1.4\n% backup original fixture\n%%EOF\n");
  const upload = await rpc({ type: "document.upload.begin", conversationId, name: "backup-original.pdf", size: original.length });
  await rpc({ type: "document.upload.chunk", conversationId, uploadId: upload.uploadId, index: 0, data: original.toString("base64") });
  const pdf = await rpc({ type: "document.upload.complete", conversationId, uploadId: upload.uploadId });
  await rpc({ type: "learn.plan", plan: { id: "audit-practice", goal: "Fractions", createdAt: Date.now(), steps: [{ title: "Explain quarters", concept: "Fractions", done: false }] } });
  const firstDownload = home.waitForEvent("download"); await begin("Export workspace"); const first = await firstDownload; await idle();
  const backup = JSON.parse(await readFile(await first.path(), "utf8"));
  assert.equal(backup.format, "hypeman-backup"); assert.equal(backup.workspace.notes.length, 1); assert.ok(backup.workbench.artifacts.some(item => item.kind === "board"));
  assert.ok(backup.workbench.conversations.some(item => item.messages.some(message => message.text.includes("Draw a fractions"))));
  assert.equal(backup.learning.plans.length, 1); assert.deepEqual(Buffer.from(backup.documents[0].data, "base64"), original);
  await begin("Open preferences"); await idle();
  const secondDownload = home.waitForEvent("download"); await home.locator(".workspace-settings").getByRole("button", { name: "Export", exact: true }).click(); const second = await secondDownload;
  const preferences = JSON.parse(await readFile(await second.path(), "utf8"));
  for (const field of ["workspace", "learning", "documents"]) assert.deepEqual(preferences[field], backup[field], `Same backup coverage: ${field}`);
  assert.equal(preferences.workbench.artifacts.length, backup.workbench.artifacts.length);
  console.log("✓ Chat and Preferences export conversations, diagrams, notes, practice and byte-exact original PDFs through one service");

  await rpc({ type: "note.remove", id: state.notes[0].id }); await rpc({ type: "document.remove", conversationId, documentId: pdf.id });
  const encoded = Buffer.from(JSON.stringify(backup));
  async function restore() { const transfer = await rpc({ type: "backup.restore.begin", size: encoded.length }); let index = 0; for (let offset = 0; offset < encoded.length; offset += transfer.chunkBytes) await rpc({ type: "backup.restore.chunk", transferId: transfer.transferId, index: index++, data: encoded.subarray(offset, offset + transfer.chunkBytes).toString("base64") }); return rpc({ type: "backup.restore.complete", transferId: transfer.transferId }); }
  const restored = await restore(); assert.equal(restored.restored.notes, 1); assert.equal(restored.restored.documents, 1);
  const duplicate = await restore(); assert.equal(Object.values(duplicate.restored).reduce((sum, count) => sum + count, 0), 0); assert.ok(duplicate.skipped > 0);
  assert.equal((await rpc({ type: "workspace.get" })).notes.length, 1);
  console.log("✓ A validated backup restores missing work and repeated imports do not duplicate existing IDs");
} finally { await context?.close(); await gateway.close(); await messaging.close(); await rm(profile, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); }
