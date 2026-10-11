import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync, watch, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  source = resolve(root, "apps/extension"),
  output = resolve(source, "dist");
const watchMode = process.argv.includes("--watch");
const names = [
  "content",
  "newtab",
  "popup",
  "onboarding",
  "customize",
  "board",
  "video",
  "capture",
  "connection",
  "preferences",
];
const entries = Object.fromEntries(
  names
    .filter((name) => existsSync(resolve(source, `src/entries/${name}.tsx`)))
    .map((name) => [name, resolve(source, `src/entries/${name}.tsx`)]),
);
entries.background = resolve(source, "src/background/index.ts");
function copy() {
  mkdirSync(output, { recursive: true });
  const publicRoot = resolve(source, "public");
  cpSync(publicRoot, output, { recursive: true });
  cpSync(resolve(source, "manifest.json"), resolve(output, "manifest.json"));
  const styles = ["ui.css", "y2k-base.css", "y2k-art.css", "y2k-hub.css", "y2k-tools.css", "overlays.css"]
    .map((name) => resolve(source, "public", name))
    .filter(existsSync)
    .map((path) => readFileSync(path, "utf8"));
  writeFileSync(resolve(output, "ui.css"), styles.join("\n"));
}
rmSync(output, { recursive: true, force: true });
copy();
const options = {
  entryPoints: entries,
  outdir: output,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  jsx: "automatic",
  minify: !watchMode,
  sourcemap: watchMode,
  alias: { "@core": resolve(root, "packages/core/src/index.ts") },
  define: { "process.env.NODE_ENV": JSON.stringify(watchMode ? "development" : "production") },
  loader: { ".css": "css" },
  logLevel: "info",
};
if (watchMode) {
  const context = await esbuild.context(options);
  await context.watch();
  watch(resolve(source, "public"), { recursive: true }, () => copy());
  watch(resolve(source, "manifest.json"), () => copy());
  console.log("HypeMan extension is watching. Reload it in chrome://extensions after a build.");
} else await esbuild.build(options);
