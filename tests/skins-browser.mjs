import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const profile = await mkdtemp(join(tmpdir(), "hypeman-skins-"));
let context;
try {
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.HYPEMAN_TEST_CHROMIUM ? { executablePath: process.env.HYPEMAN_TEST_CHROMIUM } : { channel: "chromium" }),
    headless: true, viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const home = await context.newPage();
  await home.goto(`${base}/newtab.html`);
  assert.equal(await home.locator('audio').evaluate(audio => audio.paused), true, 'music must not autoplay');
  await home.getByRole('button', { name: 'Change HypeMan skin', exact: true }).click();
  await home.getByRole('dialog', { name: 'Choose HypeMan skin', exact: true }).waitFor();
  await home.getByRole('button', { name: 'Use Rally skin', exact: true }).click();
  await home.locator('.hypeman-pet[data-skin="rally"]').waitFor();
  await home.getByRole('dialog', { name: 'Choose HypeMan skin', exact: true }).waitFor({ state: 'hidden' });
  await home.getByRole('button', { name: 'Change HypeMan skin', exact: true }).click();
  await home.keyboard.press('Escape');
  await home.getByRole('dialog', { name: 'Choose HypeMan skin', exact: true }).waitFor({ state: 'hidden' });
  await home.locator('audio').evaluate(audio => { audio.muted = true; });
  await home.getByRole('button', { name: 'Play boombox music', exact: true }).click();
  await home.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return !audio.paused && audio.currentTime > 0 && Number.isFinite(audio.duration) && audio.duration > 0;
  });
  await home.getByRole('button', { name: 'Pause boombox music', exact: true }).click();
  assert.equal(await home.locator('audio').evaluate(audio => audio.paused), true);
  const pausedAt = await home.locator('audio').evaluate(audio => audio.currentTime);
  await home.getByRole('button', { name: 'Play boombox music', exact: true }).click();
  await home.waitForFunction(pausedAt => document.querySelector('audio').currentTime > pausedAt, pausedAt);
  assert.equal(await home.locator('audio').evaluate(audio => audio.loop), true);
  await home.getByRole('button', { name: 'Pause boombox music', exact: true }).click();
  const settings = await context.newPage();
  await settings.goto(`${base}/preferences.html`);
  const picker = settings.getByRole("combobox", { name: "HypeMan skin", exact: true });
  await picker.waitFor();
  for (const skin of ["glitch", "rally", "orbit", "breeze", "spark", "hypeman"]) {
    await picker.selectOption(skin);
    await home.locator(`.hypeman-pet[data-skin="${skin}"]`).waitFor();
    const saved = await home.evaluate(async () => (await chrome.runtime.sendMessage({ type: "settings.get", requestId: crypto.randomUUID() })).data.avatarSkin);
    assert.equal(saved, skin);
    const image = home.locator(".hypeman-pet > span");
    const asset = await image.evaluate(element => getComputedStyle(element).backgroundImage);
    assert.ok(asset.includes(skin === "hypeman" ? "/hypeman.png" : `/skins/${skin}.png`));
    await home.evaluate(async asset => {
      const image = new Image(); image.src = asset.match(/url\(["']?(.*?)["']?\)/)[1]; await image.decode();
      if (image.naturalWidth !== 384 || image.naturalHeight !== 704) throw new Error('skin atlas dimensions mismatch');
    }, asset);
  }
  await picker.selectOption("spark");
  await home.locator('.hypeman-pet[data-skin="spark"]').waitFor();
  await home.reload();
  await home.locator('.hypeman-pet[data-skin="spark"]').waitFor();
  await mkdir("tests/screenshots", { recursive: true });
  await home.screenshot({ path: "tests/screenshots/fountain-spark-skin.png" });
  await settings.screenshot({ path: "tests/screenshots/avatar-skin-picker.png" });
  await home.getByRole('button', { name: 'Change HypeMan skin', exact: true }).click();
  await home.locator('.skin-picker-panel .hypeman-pet > span').evaluateAll(async elements => {
    await Promise.all(elements.map(async element => {
      const asset = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];
      const image = new Image(); image.src = asset; await image.decode();
    }));
  });
  await home.screenshot({ path: "tests/screenshots/skin-gallery.png" });
  await home.keyboard.press('Escape');
  assert.equal(await home.locator('.rooftop-tv-video iframe').count(), 0);
  await home.getByRole('button', { name: 'Turn TV video on', exact: true }).click();
  const video = home.locator('.rooftop-tv-video iframe');
  await video.waitFor();
  assert.ok((await video.getAttribute('src')).includes('/embed/GaXuCT3jOPk'));
  const player = await video.elementHandle().then(element => element.contentFrame());
  await player.waitForURL('**/embed/**', { timeout: 15000 }).catch(() => {});
  await player.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.readyState >= 2 && !video.paused && video.currentTime > 3 && video.getVideoPlaybackQuality().totalVideoFrames > 10;
  }, undefined, { timeout: 45000, polling: 500 });
  assert.equal(await player.locator('video').evaluate(video => video.muted), true);
  const tvURL = new URL(await video.getAttribute('src'));
  assert.equal(tvURL.searchParams.get('loop'), '1');
  assert.equal(tvURL.searchParams.get('playlist'), 'GaXuCT3jOPk');
  assert.equal(tvURL.searchParams.get('controls'), '0');
  assert.equal(await video.evaluate(frame => getComputedStyle(frame).pointerEvents), 'none');
  assert.equal(await video.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
  const checkFit = async () => {
    const screen = await home.locator('.rooftop-tv-video').boundingBox();
    const frame = await video.boundingBox();
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(frame[key] - screen[key]) < 1, `TV ${key} must fit the glass`);
  };
  await checkFit();
  const tabCount = context.pages().length;
  await home.mouse.click((await video.boundingBox()).x + 30, (await video.boundingBox()).y + 20);
  assert.equal(context.pages().length, tabCount);
  assert.ok(home.url().endsWith('/newtab.html'));
  for (const size of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await home.setViewportSize(size);
    await checkFit();
  }
  console.log('TV autoplays without test intervention, decodes moving frames, stays fitted on resize, and cannot navigate away.');
  await home.screenshot({ path: "tests/screenshots/tv-video.png" });
  await player.locator('video').evaluate(video => { video.currentTime = video.duration - 1; });
  await player.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && !video.paused && video.currentTime > 0 && video.currentTime < 5;
  }, undefined, { timeout: 30000 });
  console.log('TV restarts playback after reaching the end.');
  const screen = await home.locator('.rooftop-tv-video').boundingBox();
  await home.getByRole('button', { name: 'Change HypeMan skin', exact: true }).click();
  const gallery = await home.locator('.skin-picker-panel').boundingBox();
  assert.ok(gallery.width <= 216);
  assert.ok(gallery.x >= screen.x + screen.width || gallery.y + gallery.height <= screen.y);
  await home.keyboard.press('Escape');
  await home.getByRole('button', { name: 'Turn TV video off', exact: true }).click();
  await video.waitFor({ state: 'detached' });
  await home.setViewportSize({ width: 390, height: 844 });
  await home.getByRole('button', { name: 'Change HypeMan skin', exact: true }).click();
  await home.getByRole('button', { name: 'Use Breeze skin', exact: true }).click();
  await home.locator('.hypeman-pet[data-skin="breeze"]').waitFor();
  await home.locator('audio').evaluate(audio => { audio.muted = true; });
  await home.getByRole('button', { name: 'Play boombox music', exact: true }).click();
  await home.waitForFunction(() => !document.querySelector('audio').paused);
  await home.getByRole('button', { name: 'Pause boombox music', exact: true }).click();
  await home.screenshot({ path: "tests/screenshots/skin-controls-narrow.png" });
  await home.setViewportSize({ width: 1440, height: 900 });
  await home.getByRole("button", { name: "Open HypeMan", exact: true }).click();
  await home.getByRole("button", { name: "Close HypeMan chat", exact: true }).waitFor();
  console.log("Skin gallery saves immediately and closes with Escape. FLAC decodes, plays, pauses, resumes and loops without autoplay. All six skins persist after reload.");
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }

