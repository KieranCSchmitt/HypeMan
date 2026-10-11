import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Original, silent HypeMan lesson. FFmpeg is needed only to regenerate this fixture.
const root = resolve(import.meta.dirname, "..");
const font = readFileSync(resolve(root, "apps/gateway/public/fonts/Tiny5.ttf")).toString("base64");
const browser = await chromium.launch({ headless: true });
let frames;
try {
  const page = await browser.newPage();
  frames = await page.evaluate(async (fontData) => {
    const face = new FontFace("Lesson", `url(data:font/ttf;base64,${fontData})`);
    await face.load();
    document.fonts.add(face);
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d");
    const steps = [
      ["2x + 4 = 10", "Subtract 4 from both sides"],
      ["2x = 6", "Divide both sides by 2"],
      ["x = 3", "Your turn - explain why"],
    ];
    return steps.map(([equation, instruction]) => {
      ctx.fillStyle = "#21143f"; ctx.fillRect(0, 0, 640, 360);
      ctx.strokeStyle = "#35245a"; ctx.lineWidth = 1;
      for (let i = 0; i <= 640; i += 40) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 360); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(640, i); ctx.stroke();
      }
      ctx.strokeStyle = "#9f8bff"; ctx.lineWidth = 2; ctx.strokeRect(28, 28, 584, 304);
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#f2f0ff";
      for (const [text, y, size] of [["HYPEMAN", 48, 32], ["Keep both sides balanced", 98, 28], [equation, 160, 64], [instruction, 250, 24]]) {
        ctx.font = `${size}px Lesson`; ctx.fillText(text, 320, y);
      }
      ctx.fillStyle = "#4ed8d4"; ctx.fillRect(48, 308, 544, 4);
      return canvas.toDataURL("image/png").split(",")[1];
    });
  }, font);
} finally { await browser.close(); }
const images = frames.map((data) => Buffer.from(data, "base64"));
const input = Buffer.concat(images.flatMap((data, index) => Array(index === 2 ? 96 : 72).fill(data)));
const result = spawnSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "image2pipe", "-framerate", "24", "-i", "pipe:0",
  "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-crf", "35", "-b:v", "0",
  "-map_metadata", "-1", "-metadata", "title=HypeMan - Keep both sides balanced",
  resolve(root, "apps/gateway/public/demo/media/lesson.webm"),
], { input, stdio: ["pipe", "inherit", "inherit"] });
if (result.error) throw result.error;
if (result.status) process.exit(result.status);
console.log("Generated HypeMan's silent 10-second equation lesson.");
