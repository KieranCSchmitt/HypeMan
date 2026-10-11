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
  "board",
  "video",
  "connection",
  "preferences",
  "documents",
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
  const pdfRoot = resolve(root, "node_modules/pdfjs-dist");
  const pdfOutput = resolve(output, "assets/pdfjs");
  mkdirSync(pdfOutput, { recursive: true });
  cpSync(resolve(pdfRoot, "legacy/build/pdf.worker.min.mjs"), resolve(pdfOutput, "pdf.worker.min.mjs"));
  for (const name of ["cmaps", "standard_fonts", "wasm"])
    cpSync(resolve(pdfRoot, name), resolve(pdfOutput, name), { recursive: true });
  cpSync(resolve(root, "node_modules/katex/dist/fonts"), resolve(output, "fonts"), { recursive: true });
  const licenses = resolve(output, "licenses");
  mkdirSync(licenses, { recursive: true });
  for (const name of ["react", "react-dom", "katex", "pdfjs-dist"])
    cpSync(resolve(root, "node_modules", name, "LICENSE"), resolve(licenses, `${name}.txt`));
  const styles = ["ui.css", "y2k-base.css", "y2k-art.css", "y2k-hub.css", "y2k-tools.css", "overlays.css", "tool-theme.css"]
    .map((name) => resolve(source, "public", name))
    .filter(existsSync)
    .map((path) => readFileSync(path, "utf8"));
  styles.push(readFileSync(resolve(root, "node_modules/katex/dist/katex.min.css"), "utf8"));
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
  loader: { ".css": "css", ".woff2": "file", ".woff": "file", ".ttf": "file" },
  logLevel: "info",
};
if (watchMode) {
  const context = await esbuild.context(options);
  await context.watch();
  watch(resolve(source, "public"), { recursive: true }, () => copy());
  watch(resolve(source, "manifest.json"), () => copy());
  console.log("HypeMan extension is watching. Reload it in chrome://extensions after a build.");
} else await esbuild.build(options);
