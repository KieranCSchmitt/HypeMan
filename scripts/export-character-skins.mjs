import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

const atlas = JSON.parse(await readFile("apps/extension/public/assets/y2k/hypeman-atlas.json", "utf8"));
const result = await build({ entryPoints: ["scripts/art/characters/index.ts"], bundle: true, write: false, format: "iife", globalName: "Roster" });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const sheets = await page.evaluate(atlas => {
    return Roster.CHARACTERS.filter(character => character.id !== "hypeman").map(character => {
      const canvas = document.createElement("canvas");
      canvas.width = atlas.meta.sheetWidth; canvas.height = atlas.meta.sheetHeight;
      const ctx = canvas.getContext("2d");
      const palette = Roster.paletteOf(character);
      for (const [state, animation] of Object.entries(atlas.animations)) {
        animation.frames.forEach((tile, index) => {
          const active = ["walk", "hype", "celebrate", "greet", "wave"].includes(state);
          const bob = index === 0 ? 0 : active ? [0, -2, 0, -1][index % 4] : -(index % 2);
          const lean = ["point", "confused", "thinking"].includes(state) && index % 2 ? 1 : 0;
          character.idle.forEach((row, y) => {
            [...row].forEach((key, x) => {
              if (key === ".") return;
              const swatch = palette[key === "a" ? "L" : key];
              if (!swatch) throw new Error(`${character.id}: unknown colour ${key}`);
              ctx.fillStyle = swatch.hex;
              const stride = state === "walk" && y >= 42 ? (x < 16 ? 1 : -1) * (index % 2 ? 1 : -1) : 0;
              ctx.fillRect(tile.x + 8 + x + lean + stride, tile.y + 16 + y + bob, 1, 1);
            });
          });
        });
      }
      return { id: character.id, png: canvas.toDataURL("image/png").split(",")[1] };
    });
  }, atlas);
  for (const sheet of sheets) await writeFile(`apps/extension/public/assets/y2k/skins/${sheet.id}.png`, Buffer.from(sheet.png, "base64"));
  console.log(`Exported ${sheets.length} skins with ${Object.keys(atlas.animations).length} motion states each.`);
} finally { await browser.close(); }
