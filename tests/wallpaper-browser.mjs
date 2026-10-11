import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const temp = await mkdtemp(join(tmpdir(), "hypeman-wallpaper-"));
let browser;
try {
  const script = join(temp, "wallpaper.js");
  await build({ stdin: { contents: `
    export * from './apps/extension/src/art/wallpaper.ts';
    export * from './apps/extension/src/art/wallpaper-layout.ts';
    export { Surface } from './scripts/art/scene/surface.ts';
    export { drawNear, roofKeyAt } from './scripts/art/scene/layers.ts';
    export { THEMES } from './scripts/art/scene/timeOfDay.ts';
    export { drawStringLights, STRING_LIGHT_SUPPORTS } from './scripts/art/scene/props.ts';
    export { CLOUDS } from './scripts/art/scene/sprites.ts';
    export { drawFountain, drawFountainStone } from './scripts/art/scene/fountain.ts';
  `, resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "iife", globalName: "WallpaperArt", outfile: script });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  await mkdir("tests/screenshots", { recursive: true });
  for (const density of [1, 1.25, 2]) {
    const context = await browser.newContext({ viewport: { width: 3840, height: 1080 }, deviceScaleFactor: density });
    const page = await context.newPage();
    await page.setContent('<canvas style="position:fixed;inset:0;width:100%;height:100%;image-rendering:pixelated"></canvas><form style="position:fixed;box-sizing:border-box;background:#f1f5f5;border:3px solid #102638;padding:10px"><input placeholder="Search the web"></form>');
    await page.addScriptTag({ path: script });
    await page.evaluate(() => {
      const fountain = new WallpaperArt.Surface(480, 270);
      const hashes = new Set();
      for (let frame = 0; frame < 12; frame++) {
        fountain.clear();
        WallpaperArt.drawFountainStone(fountain, 'day');
        WallpaperArt.drawFountain(fountain, 'day', frame * 130);
        hashes.add(fountain.canvas.toDataURL());
      }
      if (hashes.size < 3) throw new Error('fountain water does not animate');
      fountain.clear(); WallpaperArt.drawFountain(fountain, 'day', 0, true);
      const still = fountain.canvas.toDataURL();
      fountain.clear(); WallpaperArt.drawFountain(fountain, 'day', 10000, true);
      if (fountain.canvas.toDataURL() !== still) throw new Error('fountain ignores reduced motion');
      for (const theme of Object.values(WallpaperArt.THEMES)) {
        for (let y = 97; y < 206; y++) {
          if (WallpaperArt.roofKeyAt(theme, 479, y) !== theme.roof.panelSeam) throw new Error('repeated wall is missing its closing seam');
          if (WallpaperArt.roofKeyAt(theme, 478, y) !== theme.roof.panelHi) throw new Error('repeated wall is missing its edge highlight');
        }
      }
      window.wallpaper = new WallpaperArt.Wallpaper(document.querySelector("canvas"), {
        reduced: true, spriteURL: "", onLayout: layout => {
          window.layout = layout;
          const rect = WallpaperArt.wallpaperSearch(innerWidth, innerHeight, layout);
          Object.assign(document.querySelector('form').style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
        },
        onAction: action => { window.lastAction = action; },
      });
    });
    for (const [width, height] of [[3840, 1080], [7680, 1080], [1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(({ width, height, density }) => {
        const canvas = document.querySelector("canvas");
        return canvas.width === Math.round(width * density) && canvas.height === Math.round(height * density);
      }, { width, height, density });
      const targets = await page.evaluate(() => WallpaperArt.WALLPAPER_ACTIONS.filter(action => !["sky", "hypeman"].includes(action.id)).map(action => ({
        id: action.id,
        x: window.layout.x + (action.rect.x + action.rect.w / 2) * window.layout.scale,
        y: window.layout.y + (action.rect.y + action.rect.h / 2) * window.layout.scale,
      })));
      for (const target of targets) {
        assert.ok(target.x >= 0 && target.x < width && target.y >= 0 && target.y < height, `${target.id} remains visible`);
        await page.evaluate(({ x, y }) => {
          window.lastAction = null;
          window.wallpaper.walkAt(x, y);
        }, target);
        assert.equal(await page.evaluate(() => window.lastAction), target.id, `${target.id} click target follows resize`);
      }
      const result = await page.evaluate(() => {
        const canvas = document.querySelector("canvas"), ctx = canvas.getContext("2d");
        // Former edge-strip stretching produced identical columns across the margin.
        const sampleWidth = Math.floor(window.layout.x * canvas.width / innerWidth);
        const pixels = ctx.getImageData(0, 0, Math.max(1, sampleWidth), canvas.height).data;
        let differences = 0;
        for (let y = 0; y < canvas.height; y += 8) {
          for (let x = 1; x < sampleWidth; x += 4) {
            const a = (y * sampleWidth + x) * 4, b = y * sampleWidth * 4;
            if (pixels[a] !== pixels[b] || pixels[a + 1] !== pixels[b + 1] || pixels[a + 2] !== pixels[b + 2]) differences++;
          }
        }
        return { differences, sampleWidth, smoothing: ctx.imageSmoothingEnabled, layout: window.layout };
      });
      assert.equal(result.smoothing, false);
      assert.equal(result.layout.scale, result.layout.scaleY);
      const search = await page.locator('form').boundingBox();
      const sign = { x: result.layout.x + 8 * result.layout.scale, y: result.layout.y + 20 * result.layout.scale, w: 114 * result.layout.scale, h: 46 * result.layout.scale };
      assert.ok(!(search.x < sign.x + sign.w + 10 && search.x + search.width + 10 > sign.x && search.y < sign.y + sign.h + 10 && search.y + search.height + 10 > sign.y), 'search is clear of sign');
      if (result.sampleWidth > 100) assert.ok(result.differences > 100, "side margins contain detailed scenery rather than a stretched column");
      if (width === 3840 && density === 1) await page.screenshot({ path: "tests/screenshots/wallpaper-ultrawide.png" });
    }
    await page.evaluate(() => {
      const bare = new WallpaperArt.Surface(480, 270), supported = new WallpaperArt.Surface(480, 270);
      WallpaperArt.drawNear(bare, 'day', 0, false);
      WallpaperArt.drawNear(supported, 'day', 0, true);
      if (bare.ctx.getImageData(22, 70, 1, 1).data[3] !== 0 || supported.ctx.getImageData(22, 70, 1, 1).data[3] !== 255) throw new Error('sign supports must only be in the unique foreground');
      const lights = new WallpaperArt.Surface(480, 270);
      for (const [phase, theme] of Object.entries(WallpaperArt.THEMES)) {
        lights.clear();
        WallpaperArt.drawStringLights(lights, window.wallpaper.world, phase);
        for (const post of WallpaperArt.STRING_LIGHT_SUPPORTS) {
          for (let y = post.y; y <= post.roofY + 2; y++) {
            if (lights.ctx.getImageData(post.x, y, 1, 1).data[3] !== 255) throw new Error(`unsupported wire or floating pole at ${post.x},${y} in ${phase}`);
          }
          if (!WallpaperArt.roofKeyAt(theme, post.x, post.roofY)) throw new Error('pole footing misses the roof');
        }
        for (const edge of [0, 479]) {
          const post = WallpaperArt.STRING_LIGHT_SUPPORTS.find(post => post.x === edge);
          if (!post) throw new Error('repeated wire boundary has no support');
        }
      }
      lights.clear();
      WallpaperArt.drawStringLights(lights, window.wallpaper.world);
      const pixels = lights.ctx.getImageData(0, 0, 480, 270).data;
      for (let x = 0; x < 480; x++) {
        let wire = false;
        for (let y = 60; y < 122; y++) if (pixels[(y * 480 + x) * 4 + 3]) wire = true;
        if (!wire) throw new Error(`wire gap at ${x}`);
      }
      for (const [index, surface] of window.wallpaper.clouds.entries()) {
        const sprite = WallpaperArt.CLOUDS[index];
        const expected = sprite.join('').split('').filter(pixel => pixel !== '.').length;
        const actual = surface.ctx.getImageData(0, 0, surface.canvas.width, surface.canvas.height).data.filter((value, offset) => offset % 4 === 3 && value > 0).length;
        if (actual !== expected) throw new Error('cloud sprite was clipped by its drawing buffer');
      }
      window.cloudBefore = WallpaperArt.wallpaperClouds(innerWidth, window.layout.scale, window.wallpaper.world.t)[0].x;
      window.wallpaper.setReducedMotion(false);
    });
    await page.waitForFunction(() => WallpaperArt.wallpaperClouds(innerWidth, window.layout.scale, window.wallpaper.world.t)[0].x !== window.cloudBefore, null, { timeout: 8000 });
    await page.evaluate(() => window.wallpaper.setReducedMotion(true));
    await context.close();
  }
  console.log("Wallpaper browser checks passed: repeated scenery, full-width lights, unique sign supports, animated cloud, search clearance, resizing at 1x/1.25x/2x.");
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
