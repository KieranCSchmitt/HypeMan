import atlas from "../../public/assets/y2k/hypeman-atlas.json";

export const CHARACTER_FRAME = {
  width: atlas.meta.frameWidth,
  height: atlas.meta.frameHeight,
};

/** Uploads use the same native frame as the packaged character. Zoom can crop deliberately. */
export function renderCharacter(
  output: HTMLCanvasElement,
  source: HTMLImageElement,
  options: { zoom: number; threshold: number; removeBackground: boolean; colors: number },
): string {
  const { width, height } = CHARACTER_FRAME;
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  const padding = 3;
  const scale = Math.min((width - padding * 2) / source.naturalWidth, (height - padding * 2) / source.naturalHeight) * options.zoom;
  const w = source.naturalWidth * scale,
    h = source.naturalHeight * scale;
  const left = (width - w) / 2,
    top = (height - h) / 2;
  ctx.drawImage(source, left, top, w, h);
  const pixels = ctx.getImageData(0, 0, width, height),
    d = pixels.data;
  // Flood only connected background, preserving matching colors enclosed by the subject.
  if (options.removeBackground) {
    const candidates: number[] = [];
    for (let x = 0; x < width; x++) candidates.push(x, (height - 1) * width + x);
    for (let y = 1; y < height - 1; y++) candidates.push(y * width, y * width + width - 1);
    const sampleX = Math.min(width - 1, Math.max(0, Math.ceil(left))),
      sampleY = Math.min(height - 1, Math.max(0, Math.ceil(top)));
    const corner = (sampleY * width + sampleX) * 4;
    const bg = [d[corner], d[corner + 1], d[corner + 2]];
    const hasBackground = d[corner + 3] > 0;
    const seen = new Uint8Array(width * height);
    let at = 0;
    while (at < candidates.length) {
      const index = candidates[at++];
      if (index < 0 || index >= seen.length || seen[index]) continue;
      seen[index] = 1;
      const p = index * 4;
      if (d[p + 3] > 0 && (!hasBackground || Math.hypot(d[p] - bg[0], d[p + 1] - bg[1], d[p + 2] - bg[2]) > options.threshold * 2.5))
        continue;
      d[p + 3] = 0;
      const x = index % width,
        y = Math.floor(index / width);
      if (x > 0) candidates.push(index - 1);
      if (x < width - 1) candidates.push(index + 1);
      if (y > 0) candidates.push(index - width);
      if (y < height - 1) candidates.push(index + width);
    }
  }
  const step = 255 / Math.max(2, options.colors - 1);
  for (let p = 0; p < d.length; p += 4)
    for (let c = 0; c < 3; c++) d[p + c] = Math.round(d[p + c] / step) * step;
  ctx.putImageData(pixels, 0, 0);
  return output.toDataURL("image/png");
}
