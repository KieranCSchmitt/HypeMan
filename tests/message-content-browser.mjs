import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const serve = process.argv.includes("--serve");
const code = `function forecast(city) {\n  const example = "<img src=x onerror=alert(1)>";\n  return ${JSON.stringify("A long source line retains its exact indentation and scrolls horizontally. ".repeat(4))};\n}\n`;
const text = `Here is the code and a morning/evening forecast comparison. Copy the example or scroll across the table for every column.\n\n\`\`\`javascript\n${code}\`\`\`\n\n| City | Time | Rain chance | Temperature | Source |\n| :--- | :--- | ---: | ---: | :--- |\n| Boston | 7 am | 15% | 54°F | [Forecast](https://example.com/boston) |\n| New York | 6 pm | 0% | 69°F | [Forecast](https://example.com/nyc) |`;
const source = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { MessageContent } from "./apps/extension/src/ui/MessageContent";
window.fixtureCopied = [];
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.fixtureCopied.push(text); } } });
createRoot(document.getElementById("root")).render(createElement("section", { className: "conversation-pane", style: { width: "calc(100vw - 24px)", maxWidth: 540, maxHeight: "none", margin: 12 } },
  createElement("header", { className: "conversation-title" }, createElement("strong", null, "HypeMan")),
  createElement("div", { className: "conversation-messages" }, createElement("article", { className: "chat-message assistant" },
    createElement(MessageContent, { text: ${JSON.stringify(text)}, compact: new URLSearchParams(location.search).has("compact"), onDocumentPage: () => {} })))))
`;
const bundle = await build({ stdin: { contents: source, resolveDir: resolve("."), loader: "jsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const styles = (await Promise.all(["ui.css", "y2k-base.css", "y2k-hub.css", "y2k-tools.css", "overlays.css", "tool-theme.css"].map(name => readFile(`apps/extension/public/${name}`, "utf8")))).join("\n");
const font = await readFile("apps/extension/public/assets/fonts/Tiny5.ttf");
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(styles); return; }
  if (url.pathname.endsWith("Tiny5.ttf")) { response.setHeader("Content-Type", "font/ttf"); response.end(font); return; }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{min-width:0;margin:0;background:#e8deee}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/`;
if (serve) {
  console.log(`Message content fixture: ${url} (add ?compact=1 to inspect More)`);
  console.log("Copy is simulated inside this fixture; the system clipboard is unchanged.");
  await new Promise(done => { const close = () => server.close(done); process.once("SIGINT", close); process.once("SIGTERM", close); });
} else {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await mkdir("tests/screenshots", { recursive: true });
    for (const width of [360, 540]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(url); await page.locator("table").waitFor(); await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const code = document.querySelector("pre"), table = document.querySelector(".message-table");
        return { codeFont: getComputedStyle(code).fontFamily, codeSpace: getComputedStyle(code).whiteSpace,
          proseFont: getComputedStyle(document.querySelector("article p")).fontFamily,
          codeScroll: code.scrollWidth > code.clientWidth, tableScroll: table.scrollWidth > table.clientWidth,
          pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
      });
      assert.ok(layout.codeFont.includes("monospace")); assert.equal(layout.codeSpace, "pre");
      assert.ok(layout.proseFont.includes("Tiny5")); assert.ok(layout.codeScroll);
      if (width === 360) assert.ok(layout.tableScroll, "Compact tables scroll horizontally");
      assert.ok(layout.pageWidth <= layout.viewportWidth, "Content does not widen the page");
      assert.equal(await page.locator("pre code").textContent(), code);
      assert.equal(await page.locator("article img").count(), 0);
      await page.getByRole("button", { name: "Copy code", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.fixtureCopied), [code]);
      await page.getByRole("status").filter({ hasText: "Code copied." }).waitFor();
      await page.screenshot({ path: `tests/screenshots/message-content-${width}.png`, fullPage: true });
      await page.goto(`${url}?compact=1`); await page.locator("details").waitFor();
      await page.locator("details summary").click();
      assert.equal(await page.locator("details pre code").textContent(), code);
      assert.equal(await page.locator("details table tbody tr").count(), 2);
      assert.deepEqual(errors, []);
      console.log(`✓ Code copy, safe table and compact preview at ${width}px`);
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
