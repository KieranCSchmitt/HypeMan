import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), { token: "pdf-browser-fixture" });
const profile = await mkdtemp(join(tmpdir(), "hypeman-documents-"));
let context;
async function rpc(page, message) {
  return page.evaluate(async (message) => {
    const result = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    if (!result?.ok) throw new Error(result?.error || "No extension response");
    return result.data;
  }, message);
}
function pdfFixture(password) {
  const content = "BT /F1 18 Tf 48 710 Td (PDF originals stay local.) Tj ET";
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const md5 = (value) => createHash("md5").update(value).digest();
  const pad = (value) => Buffer.concat([Buffer.from(value), padding]).subarray(0, 32);
  const rc4 = (key, bytes) => {
    const state = Array.from({ length: 256 }, (_, index) => index); let j = 0, i = 0;
    for (; i < 256; i++) { j = (j + state[i] + key[i % key.length]) % 256; [state[i], state[j]] = [state[j], state[i]]; }
    i = j = 0; return Buffer.from(bytes.map((value) => { i = (i + 1) % 256; j = (j + state[i]) % 256; [state[i], state[j]] = [state[j], state[i]]; return value ^ state[(state[i] + state[j]) % 256]; }));
  };
  const id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const owner = password && rc4(md5(pad("fixture-owner")).subarray(0, 5), pad(password));
  const key = password && md5(Buffer.concat([pad(password), owner, Buffer.from("fcffffff", "hex"), id])).subarray(0, 5);
  const stream = password ? rc4(md5(Buffer.concat([key, Buffer.from([4, 0, 0, 0, 0])])).subarray(0, 10), Buffer.from(content)).toString("latin1") : content;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  if (password) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${rc4(key, padding).toString("hex")}> /P -4 >>`);
  let value = "%PDF-1.4\n", offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(value.length); value += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = value.length;
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${password ? `/Encrypt 6 0 R /ID [<${id.toString("hex")}><${id.toString("hex")}>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value, "latin1");
}
try {
  const base = `http://127.0.0.1:${await gateway.listen()}`;
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"] });
  // Chrome 116 lacks this API. Check that the locally bundled reader installs its compatibility layer.
  await context.addInitScript(() => { Promise.withResolvers = undefined; });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const home = await context.newPage(); await home.goto(`${origin}/newtab.html#chat`);
  const pdf = pdfFixture(), conversationId = "pdf-security-fixture", channel = "private-reader-fixture";
  const transfer = await rpc(home, { type: "document.upload.begin", conversationId, name: "original.pdf", size: pdf.length });
  await rpc(home, { type: "document.upload.chunk", conversationId, uploadId: transfer.uploadId, index: 0, data: pdf.toString("base64") });
  const metadata = await rpc(home, { type: "document.upload.complete", conversationId, uploadId: transfer.uploadId });
  const grant = await rpc(home, { type: "frame.grant", tool: "documents", conversationId, channel });
  const readerUrl = `${origin}/documents.html?${new URLSearchParams({ conversationId, documentId: metadata.id, channel, parentOrigin: origin })}`;
  await home.evaluate((url) => { const iframe = document.createElement("iframe"); iframe.title = "Private PDF fixture"; iframe.src = url; iframe.style.cssText = "width:800px;height:900px"; document.body.append(iframe); }, readerUrl);
  await home.frameLocator('iframe[title="Private PDF fixture"]').locator(".pdf-reader").waitFor();
  const actualReader = home.frames().find((frame) => frame.url() === readerUrl);
  assert.ok(actualReader);
  await home.evaluate(({ token, channel, conversationId, documentId, origin }) => {
    document.querySelector('iframe[title="Private PDF fixture"]').contentWindow.postMessage({ type: "hypeman.frame-authorize", token, channel, conversationId, documentId }, origin);
  }, { ...grant, channel, conversationId, documentId: metadata.id, origin });
  const fixture = home.frameLocator('iframe[title="Private PDF fixture"]');
  await fixture.locator(".textLayer span").first().waitFor();
  assert.match(await fixture.locator(".textLayer").innerText(), /originals stay local/);
  assert.equal(await actualReader.evaluate(() => typeof Promise.withResolvers), "function");
  assert.equal(new URL(await home.locator('iframe[title="Private PDF fixture"]').getAttribute("src")).searchParams.has("token"), false);
  console.log("✓ Local PDF reader renders with Chrome 116 Promise compatibility and keeps capability out of its URL");

  const bytes = await rpc(actualReader, { type: "document.read", conversationId, documentId: metadata.id,
    offset: 0, length: 256 * 1024, frameToken: grant.token, frameChannel: channel });
  assert.deepEqual(Buffer.from(bytes.data, "base64"), pdf);
  await assert.rejects(rpc(actualReader, { type: "document.read", conversationId, documentId: metadata.id, offset: 0, length: 256 * 1024 }), /authorized|Unknown tool/);
  console.log("✓ IndexedDB preserves the exact original bytes and rejects reads without a private capability");

  const downloaded = home.waitForEvent("download");
  const operation = home.evaluate(({ token, channel, conversationId, origin }) => new Promise((resolve, reject) => {
    const iframe = document.querySelector('iframe[title="Private PDF fixture"]'), requestId = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Export timed out")); }, 15_000);
    const receive = (event) => { if (event.source !== iframe.contentWindow || event.origin !== origin || event.data?.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener("message", receive); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
    window.addEventListener("message", receive);
    iframe.contentWindow.postMessage({ type: "hypeman.tool-command", requestId, token, channel, conversationId, tool: "documents", operation: "export", args: {} }, origin);
  }), { ...grant, channel, conversationId, origin });
  const [download] = await Promise.all([downloaded, operation]);
  assert.equal(download.suggestedFilename(), "original.pdf");
  assert.deepEqual(await readFile(await download.path()), pdf);
  console.log("✓ Chat tool export downloads the original PDF without changing its bytes");

  const attacker = await context.newPage(); await attacker.goto(`${base}/demo/guide/`);
  const unauthorizedUrl = `${origin}/documents.html?${new URLSearchParams({ conversationId, documentId: metadata.id, channel, parentOrigin: base })}`;
  await attacker.evaluate((url) => { const iframe = document.createElement("iframe"); iframe.title = "Untrusted PDF fixture"; iframe.src = url; document.body.append(iframe); }, unauthorizedUrl);
  await attacker.frameLocator('iframe[title="Untrusted PDF fixture"]').locator(".pdf-reader").waitFor();
  const result = await attacker.evaluate(({ token, channel, conversationId, documentId, origin }) => new Promise((resolve) => {
    const iframe = document.querySelector('iframe[title="Untrusted PDF fixture"]'), requestId = crypto.randomUUID();
    const receive = (event) => { if (event.source !== iframe.contentWindow || event.origin !== origin || event.data?.requestId !== requestId) return;
      window.removeEventListener("message", receive); resolve(event.data); };
    window.addEventListener("message", receive);
    iframe.contentWindow.postMessage({ type: "hypeman.frame-authorize", token, channel, conversationId, documentId }, origin);
    iframe.contentWindow.postMessage({ type: "hypeman.tool-command", requestId, token, channel, conversationId, tool: "documents", operation: "read", args: {} }, origin);
  }), { ...grant, channel, conversationId, documentId: metadata.id, origin });
  assert.match(result.error, /no longer authorized/);
  assert.equal(await attacker.frameLocator('iframe[title="Untrusted PDF fixture"]').locator("canvas").count(), 0);
  console.log("✓ A webpage cannot load or analyze a PDF through a forged frame even with a token from another tab");
  await rpc(home, { type: "frame.revoke", token: grant.token });
  await assert.rejects(rpc(actualReader, { type: "document.read", conversationId, documentId: metadata.id, offset: 0, length: 1, frameToken: grant.token, frameChannel: channel }), /no longer authorized/);
  console.log("✓ Revoking a frame capability immediately stops original-byte access");

  const encrypted = pdfFixture("local-secret");
  const lockedUpload = await rpc(home, { type: "document.upload.begin", conversationId, name: "encrypted.pdf", size: encrypted.length });
  await rpc(home, { type: "document.upload.chunk", conversationId, uploadId: lockedUpload.uploadId, index: 0, data: encrypted.toString("base64") });
  const lockedDocument = await rpc(home, { type: "document.upload.complete", conversationId, uploadId: lockedUpload.uploadId });
  const lockedChannel = "encrypted-reader-fixture", lockedGrant = await rpc(home, { type: "frame.grant", tool: "documents", conversationId, channel: lockedChannel });
  const lockedUrl = `${origin}/documents.html?${new URLSearchParams({ conversationId, documentId: lockedDocument.id, channel: lockedChannel, parentOrigin: origin })}`;
  await home.evaluate((url) => { const iframe = document.createElement("iframe"); iframe.title = "Encrypted PDF fixture"; iframe.src = url; document.body.append(iframe); }, lockedUrl);
  const locked = home.frameLocator('iframe[title="Encrypted PDF fixture"]');
  await locked.locator(".pdf-reader").waitFor();
  await home.evaluate(({ token, channel, conversationId, documentId, origin }) => {
    document.querySelector('iframe[title="Encrypted PDF fixture"]').contentWindow.postMessage({ type: "hypeman.frame-authorize", token, channel, conversationId, documentId }, origin);
  }, { ...lockedGrant, channel: lockedChannel, conversationId, documentId: lockedDocument.id, origin });
  await locked.getByLabel("PDF password", { exact: true }).fill("wrong-secret"); await locked.getByLabel("PDF password", { exact: true }).press("Enter");
  await locked.getByText("Incorrect password", { exact: true }).waitFor();
  await locked.getByRole("button", { name: "Unlock", exact: true }).waitFor();
  assert.equal(await locked.getByLabel("PDF password", { exact: true }).inputValue(), "");
  assert.equal(await locked.locator("canvas").count(), 0, "A rejected password must not unlock or render the PDF");
  await locked.getByLabel("PDF password", { exact: true }).fill("local-secret"); await locked.getByLabel("PDF password", { exact: true }).press("Enter");
  await locked.locator(".textLayer span").first().waitFor();
  assert.match(await locked.locator(".textLayer").innerText(), /originals stay local/);
  assert.doesNotMatch(JSON.stringify(await rpc(home, { type: "document.list", conversationId })), /local-secret|wrong-secret/);
  console.log("✓ A real encrypted PDF handles wrong passwords and unlocks locally without persisting passwords");

  const damaged = Buffer.from("%PDF-1.4\nDamaged object table and trailer");
  const damagedUpload = await rpc(home, { type: "document.upload.begin", conversationId, name: "damaged.pdf", size: damaged.length });
  await rpc(home, { type: "document.upload.chunk", conversationId, uploadId: damagedUpload.uploadId, index: 0, data: damaged.toString("base64") });
  const damagedDocument = await rpc(home, { type: "document.upload.complete", conversationId, uploadId: damagedUpload.uploadId });
  const damagedChannel = "damaged-reader-fixture", damagedGrant = await rpc(home, { type: "frame.grant", tool: "documents", conversationId, channel: damagedChannel });
  const damagedUrl = `${origin}/documents.html?${new URLSearchParams({ conversationId, documentId: damagedDocument.id, channel: damagedChannel, parentOrigin: origin })}`;
  await home.evaluate((url) => { const iframe = document.createElement("iframe"); iframe.title = "Damaged PDF fixture"; iframe.src = url; document.body.append(iframe); }, damagedUrl);
  const broken = home.frameLocator('iframe[title="Damaged PDF fixture"]');
  await broken.locator(".pdf-reader").waitFor();
  await home.evaluate(({ token, channel, conversationId, documentId, origin }) => {
    document.querySelector('iframe[title="Damaged PDF fixture"]').contentWindow.postMessage({ type: "hypeman.frame-authorize", token, channel, conversationId, documentId }, origin);
  }, { ...damagedGrant, channel: damagedChannel, conversationId, documentId: damagedDocument.id, origin });
  await broken.getByRole("alert").filter({ hasText: "damaged" }).waitFor();
  assert.equal(await broken.locator("canvas").count(), 0);
  const damagedReader = home.frames().find((frame) => frame.url() === damagedUrl);
  const retained = await rpc(damagedReader, { type: "document.read", conversationId, documentId: damagedDocument.id, offset: 0,
    length: 256 * 1024, frameToken: damagedGrant.token, frameChannel: damagedChannel });
  assert.deepEqual(Buffer.from(retained.data, "base64"), damaged);
  console.log("✓ A real corrupt PDF shows an honest parse error while preserving its original bytes");
} finally { await context?.close(); await gateway.close(); await rm(profile, { recursive: true, force: true }); }
