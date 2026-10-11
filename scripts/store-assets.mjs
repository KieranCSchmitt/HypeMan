import { chromium } from "playwright";
import { mkdtemp, mkdir, readFile, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const output = resolve("release/store-assets");
const stage = resolve(process.env.HYPEMAN_STORE_PACKAGE_DIR || "release/extension");
const profile = await mkdtemp(join(tmpdir(), "hypeman-store-assets-"));
let context;
try {
  await mkdir(output, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.HYPEMAN_TEST_CHROMIUM ? { executablePath: process.env.HYPEMAN_TEST_CHROMIUM } : { channel: "chromium" }),
    headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${stage}`, `--load-extension=${stage}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const home = await context.newPage();
  await home.goto(`${base}/newtab.html`);
  await home.getByRole("button", { name: "Change HypeMan skin", exact: true }).waitFor();
  await home.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
  const settings = await home.evaluate(async () => (await chrome.runtime.sendMessage({ type: "settings.get", requestId: crypto.randomUUID() })).data);
  assert.equal(settings.proactiveEnabled, false);
  assert.equal(settings.screenshotEnabled, false);
  assert.equal(settings.tabContextEnabled, false);
  assert.equal(settings.trustedInput, false);
  assert.equal(await home.locator("audio").evaluate(audio => audio.paused), true);
  await home.screenshot({ path: join(output, "01-rooftop-1280x800.png") });
  await home.getByRole("button", { name: "Change HypeMan skin", exact: true }).click();
  await home.locator('.skin-picker-panel .hypeman-pet > span').evaluateAll(async elements => {
    await Promise.all(elements.map(async element => {
      const image = new Image(); image.src = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1]; await image.decode();
    }));
  });
  await home.screenshot({ path: join(output, "02-skins-1280x800.png") });
  await home.keyboard.press("Escape");
  await home.getByRole("button", { name: "Open HypeMan chat", exact: true }).click();
  const composer = home.getByRole("textbox", { name: "What do you need?", exact: true });
  await composer.fill("open whiteboard"); await composer.press("Enter");
  await home.locator(".shared-board:visible").waitFor({ timeout: 30000 });
  await home.getByRole("button", { name: "Add text", exact: true }).click();
  const textEditor = home.getByRole("textbox", { name: "Edit selected board text or equation", exact: true });
  await textEditor.fill("Plan your next step");
  await textEditor.press("Control+Enter");
  await home.getByRole("button", { name: "Draw", exact: true }).click();
  const board = await home.locator(".board-viewport:visible").boundingBox();
  await home.mouse.move(board.x + 90, board.y + 190);
  await home.mouse.down();
  await home.mouse.move(board.x + 145, board.y + 245, { steps: 12 });
  await home.mouse.move(board.x + 275, board.y + 110, { steps: 20 });
  await home.mouse.up();
  await home.screenshot({ path: join(output, "03-whiteboard-1280x800.png") });
  const preferences = await context.newPage();
  await preferences.goto(`${base}/preferences.html`);
  await preferences.getByRole("combobox", { name: "HypeMan skin", exact: true }).waitFor();
  await preferences.screenshot({ path: join(output, "04-settings-1280x800.png") });
  await copyFile(join(stage, "assets/icons/icon128.png"), join(output, "icon-128.png"));

  // Draw a promotional composition from the bundled character atlas, not a
  // screenshot or externally generated art. Preserve the original pixel style.
  const atlas = JSON.parse(await readFile(join(stage, "assets/y2k/hypeman-atlas.json"), "utf8"));
  const tile = atlas.animations.idle.frames[0];
  const png = await preferences.evaluate(async tile => {
    const image = new Image(); image.src = chrome.runtime.getURL("assets/y2k/hypeman.png"); await image.decode();
    await document.fonts.ready;
    const canvas = document.createElement("canvas"); canvas.width = 440; canvas.height = 280;
    const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#102638"; ctx.fillRect(0, 0, 440, 280);
    for (let i = 0; i < 65; i++) { ctx.fillStyle = i % 3 ? "#5bb8cc" : "#d5f8ff"; ctx.fillRect((i * 67 + 13) % 440, (i * 41 + 5) % 220, 2, 2); }
    for (let i = 0; i < 14; i++) {
      const top = 120 + (i * 23 % 70); ctx.fillStyle = "#1b4564"; ctx.fillRect(i * 34, top, 30, 280 - top);
      ctx.fillStyle = "#3e7799"; for (let y = top + 6; y < 245; y += 12) for (let x = i * 34 + 5; x < i * 34 + 25; x += 10) ctx.fillRect(x, y, 4, 5);
    }
    ctx.fillStyle = "#091923"; ctx.fillRect(0, 246, 440, 34);
    ctx.fillStyle = "#65cee7"; ctx.fillRect(0, 245, 440, 3);
    ctx.fillStyle = "#d5f8ff"; ctx.textAlign = "center"; ctx.font = "52px Tiny5, monospace"; ctx.fillText("HYPEMAN", 220, 55);
    ctx.drawImage(image, tile.x, tile.y, tile.w, tile.h, 148, 58, tile.w * 3, tile.h * 3);
    return canvas.toDataURL("image/png").split(",")[1];
  }, tile);
  await writeFile(join(output, "promo-440x280.png"), Buffer.from(png, "base64"));
  await writeFile(join(output, "capture-report.json"), JSON.stringify({ capturedAt: new Date().toISOString(), extensionId: new URL(worker.url()).host, source: "isolated install of store staging package, no publisher or user data", screenshotSize: [1280, 800], promoSize: [440, 280], defaultsVerified: ["automatic help off", "screenshots off", "other-tab context off", "real input off", "music paused"], localWhiteboardWithoutGateway: true }, null, 2) + "\n");
  console.log(`Store assets captured from the packaged extension: ${output}`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
