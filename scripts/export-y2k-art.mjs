/** Package user-supplied art once; normal builds consume the checked-in PNGs. */
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const result = await build({
  entryPoints: [resolve(root, "scripts/art/export.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome116",
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const fonts = {};
  for (const [family, file] of [
    ["Press Start 2P", "PressStart2P.ttf"],
    ["Tiny5", "Tiny5.ttf"],
  ])
    fonts[family] = (
      await readFile(resolve(root, "apps/extension/public/assets/fonts", file))
    ).toString("base64");
  const art = await page.evaluate((fonts) => window.exportAssets(fonts), fonts);
  const out = resolve(root, "apps/extension/public/assets/y2k");
  await mkdir(out, { recursive: true });
  await Promise.all(
    Object.entries(art.files).map(([file, data]) =>
      writeFile(resolve(out, file), Buffer.from(data, "base64")),
    ),
  );
  const demo = resolve(root, "apps/gateway/public/demo/assets/y2k");
  await mkdir(demo, { recursive: true });
  await Promise.all(
    [
      "scene-night.png",
      "scene-dusk.png",
      "prop-crt.png",
      "prop-boombox.png",
      "prop-graffiti.png",
      "hypeman-idle.png",
      "hypeman-celebrate.png",
      "prop-bolt.png",
      "prop-sparkle.png",
    ].map((file) => writeFile(resolve(demo, file), Buffer.from(art.files[file], "base64"))),
  );
  const icons = resolve(root, "apps/extension/public/assets/icons");
  await mkdir(icons, { recursive: true });
  await Promise.all(
    [16, 32, 48, 128].map((size) =>
      writeFile(
        resolve(icons, `icon${size}.png`),
        Buffer.from(art.files[`icon${size}.png`], "base64"),
      ),
    ),
  );
  await writeFile(resolve(out, "hypeman-atlas.json"), JSON.stringify(art.atlas, null, 2) + "\n");
  await writeFile(resolve(out, "props.json"), JSON.stringify(art.props, null, 2) + "\n");
  console.log(
    `Exported ${Object.keys(art.files).length} PNGs and ${Object.keys(art.atlas.animations).length} animated states to ${out}`,
  );
} finally {
  await browser.close();
}
