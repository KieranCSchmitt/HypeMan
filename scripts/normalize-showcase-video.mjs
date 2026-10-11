/** Remove Chromium surface padding around the complete application viewport. */
import { execFile } from "node:child_process";
import { rename } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function normalizeShowcaseVideo({ file, sampleSeconds, width = 1600, height = 1000, referenceWindow, measureOnly = false }) {
  const { stdout } = await execute("ffmpeg", [
    "-v", "error", "-ss", String(sampleSeconds), "-i", file,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: width * height * 3 + 1024 * 1024, encoding: "buffer" });
  if (stdout.length !== width * height * 3) throw new Error("Unexpected screencast dimensions.");
  // A real floating window provides a stronger scale reference on white pages,
  // where Chromium's white surface padding can blend into the page background.
  let measuredScale;
  if (referenceWindow) {
    const anchor = referenceWindow;
    let best;
    const dark = (x, y) => {
      const at = (y * width + x) * 3;
      return stdout[at] < 80 && stdout[at + 1] < 100 && stdout[at + 2] < 115;
    };
    for (let y = Math.floor(anchor.y * .7); y < Math.min(height, Math.ceil(anchor.y * 1.02) + 4); y++) {
      let left;
      for (let x = Math.floor(anchor.x * .7); x < Math.min(width, Math.ceil((anchor.x + anchor.width) * 1.03)); x++) {
        if (dark(x, y)) { left ??= x; continue; }
        if (left === undefined) continue;
        const length = x - left;
        if (length > anchor.width * .7 && length < anchor.width * 1.03) {
          const scale = (anchor.x * left + anchor.y * y + anchor.width * length) /
            (anchor.x ** 2 + anchor.y ** 2 + anchor.width ** 2);
          const error = Math.abs(left - anchor.x * scale) + Math.abs(y - anchor.y * scale) + Math.abs(length - anchor.width * scale);
          if (error < 5 && (!best || error < best.error)) best = { scale, error };
        }
        left = undefined;
      }
    }
    measuredScale = best?.scale;
  }
  let cropWidth, cropHeight;
  if (measuredScale && measuredScale < .998) {
    // Keep a pixel of tolerance for antialiased borders and video compression.
    cropWidth = Math.min(width, Math.ceil(width * measuredScale) + 1);
    cropHeight = Math.min(height, Math.ceil(height * measuredScale) + 1);
  } else {
    const background = [...stdout.subarray(0, 3)];
    let right = width - 1;
    while (right > 0 && background.some((channel, i) => Math.abs(channel - stdout[right * 3 + i]) > 24)) right--;
    cropWidth = right + 1; cropHeight = Math.round(cropWidth * height / width);
  }
  if (cropWidth < width * .85) throw new Error("The screencast is incomplete; refusing to crop application content.");
  if (cropWidth >= width - 2) return { normalized: false, width, height };
  if (measureOnly) return { normalized: false, crop: { x: 0, y: 0, width: cropWidth, height: cropHeight }, measuredScale, width, height };

  const directory = dirname(file), stem = parse(file).name;
  const normalized = join(directory, `${stem}-normalized.webm`);
  const surface = join(directory, `${stem}-surface.webm`);
  await execute("ffmpeg", [
    "-y", "-v", "error", "-i", file,
    "-vf", `crop=${cropWidth}:${cropHeight}:0:0:exact=1,scale=${width}:${height}:flags=lanczos`,
    "-c:v", "libvpx-vp9", "-crf", "16", "-b:v", "0", "-deadline", "good",
    "-cpu-used", "6", "-row-mt", "1", "-pix_fmt", "yuv420p", "-an", normalized,
  ], { maxBuffer: 1024 * 1024 });
  await rename(file, surface);
  await rename(normalized, file);
  return { normalized: true, crop: { x: 0, y: 0, width: cropWidth, height: cropHeight }, width, height,
    source: surface, note: "Only padding around the complete application viewport was removed." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(process.argv[2] || "test-results/showcase/recording-video.webm");
  console.log(JSON.stringify(await normalizeShowcaseVideo({ file, sampleSeconds: Number(process.argv[3] || 10) }), null, 2));
}
