/** Fresh packaging and derived animation work for the user-supplied HypeMan art. */
import { IDLE_0 } from "./hypeman/frames";
import { PALETTE, MARKERS } from "./hypeman/palette";
import { Surface } from "./scene/surface";
import { drawSky, drawFar, drawNear, drawRoof } from "./scene/layers";
import {
  drawJumbotron,
  drawStringLights,
  drawGraffiti,
  drawCrt,
  drawCrtShell,
  drawPigeons,
  drawBoombox,
  type World,
} from "./scene/props";
import { CLOUDS, BLIMP, BOLT, PIGEON, SPARKLE } from "./scene/sprites";
import { THEMES, type Phase } from "./scene/timeOfDay";

const W = 48,
  H = 64;
const file = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png").split(",")[1];
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function crop(source: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const c = canvas(w, h);
  c.getContext("2d")!.drawImage(source, x, y, w, h, 0, 0, w, h);
  return c;
}
function pixel(ctx: CanvasRenderingContext2D, x: number, y: number, key: string) {
  ctx.fillStyle = PALETTE[key as keyof typeof PALETTE].hex;
  ctx.fillRect(x, y, 1, 1);
}
const base = canvas(32, 48);
const b = base.getContext("2d")!;
IDLE_0.forEach((row, y) =>
  [...row].forEach((key, x) => {
    if (key !== ".") pixel(b, x, y, MARKERS[key]?.paintsAs ?? key);
  }),
);

function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, closed = false) {
  if (!closed) return;
  for (const dx of [13, 16]) {
    pixel(ctx, x + dx, y + 10, "s");
    pixel(ctx, x + dx, y + 11, "s");
    pixel(ctx, x + dx, y + 11, "K");
  }
}
function glint(ctx: CanvasRenderingContext2D, x: number, y: number, size = 1, key = "I") {
  for (let d = -size; d <= size; d++) {
    pixel(ctx, x + d, y, key);
    pixel(ctx, x, y + d, key);
  }
  pixel(ctx, x, y, "w");
}
function frame(state: string, index: number): HTMLCanvasElement {
  const c = canvas(W, H),
    ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const phase = index % 8;
  const jump =
    state === "celebrate" || state === "hype"
      ? [0, 2, 5, 7, 5, 2, 0, 0][phase]
      : state === "walk"
        ? [0, 1, 0, 1, 0, 1, 0, 1][phase]
        : state === "idle" && phase === 3
          ? 1
          : 0;
  const x = 8 + (state === "confused" ? (index % 4 === 1 ? -1 : index % 4 === 3 ? 1 : 0) : 0),
    y = 14 - jump;
  // Split the authored pose into a grounded lower body and an expressive upper body.
  ctx.drawImage(base, 0, 30, 32, 18, x, y + 30, 32, 18);
  ctx.drawImage(base, 0, 0, 32, 30, x, y, 32, 30);
  if (state === "walk") {
    const legShift = [0, 1, 0, -1, 0, 1, 0, -1][phase];
    ctx.clearRect(x, y + 34, 32, 14);
    ctx.drawImage(base, 0, 34, 14, 14, x + legShift, y + 34, 14, 14);
    ctx.drawImage(base, 14, 34, 18, 14, x + 14 - legShift, y + 34, 18, 14);
  }
  if (
    state === "wave" ||
    state === "greet" ||
    state === "celebrate" ||
    state === "hype" ||
    state === "point"
  ) {
    // Move the supplied phone hand as a rigid articulated sprite; never stretch the pixels.
    ctx.clearRect(x + 24, y, 8, 24);
    const angles =
      state === "point"
        ? [-0.55, -0.65, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75]
        : [0, -0.18, -0.32, -0.18, 0, 0.15, 0, -0.12];
    // Inverse-map the arm onto whole pixels. Canvas rotation would soften alpha edges.
    const angle = angles[phase],
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        const dx = xx - (x + 25),
          dy = yy - (y + 20);
        const sx = Math.floor(dx * cos + dy * sin + 25);
        const sy = Math.floor(-dx * sin + dy * cos + 20);
        if (sx < 24 || sx >= 32 || sy < 0 || sy >= 24) continue;
        const key = IDLE_0[sy][sx];
        if (key !== ".") pixel(ctx, xx, yy, MARKERS[key]?.paintsAs ?? key);
      }
  }
  if (state === "thinking") {
    // A screen scan and shifting head glint communicate work without extra text.
    pixel(ctx, x + 27, y + 7 + (index % 3), "C");
    pixel(ctx, x + 28, y + 7 + (index % 3), "w");
    if (index % 4 === 2) glint(ctx, x + 17, y + 3, 1, "C");
  }
  if (state === "confused") {
    const q = [".CCC.", "C...C", "....C", "...C.", "..C..", ".....", "..C.."];
    q.forEach((row, yy) =>
      [...row].forEach((key, xx) => {
        if (key !== ".") pixel(ctx, 4 + xx, 4 + yy + (index % 2), key);
      }),
    );
  }
  if (state === "sleepy" || state === "afk") {
    eyes(ctx, x, y, true);
    const z = ["WWW", "..W", ".W.", "WWW"];
    z.forEach((row, yy) =>
      [...row].forEach((key, xx) => {
        if (key !== ".") pixel(ctx, 36 + xx, 3 + yy - (index % 3), key);
      }),
    );
  } else eyes(ctx, x, y, state === "idle" && index === 7);
  if (state === "celebrate" || state === "hype") {
    glint(ctx, 4, 11 + (index % 2), index % 3 === 1 ? 2 : 1, "H");
    glint(ctx, 41, 23 - (index % 3), 1, "C");
  }
  if (state === "idle" && index === 4) glint(ctx, 33, 27, 1, "I");
  return c;
}

const states = [
  "idle",
  "wave",
  "thinking",
  "confused",
  "celebrate",
  "sleepy",
  "greet",
  "point",
  "hype",
  "walk",
  "afk",
];
const durations: Record<string, number[]> = {
  idle: [850, 650, 700, 800, 550, 800, 700, 120],
  wave: [120, 100, 100, 100, 100, 100, 100, 250],
  thinking: [400, 400, 400, 400, 400, 400, 400, 400],
  greet: [120, 100, 100, 100, 100, 100, 100, 250],
  hype: [110, 110, 110, 160, 110, 110, 110, 400],
  walk: [120, 120, 120, 120, 120, 120, 120, 120],
  point: [120, 120, 120, 120, 120, 120, 120, 500],
  confused: [300, 300, 300, 300, 300, 300, 300, 300],
  celebrate: [110, 110, 110, 160, 110, 110, 110, 400],
  sleepy: [700, 700, 700, 700, 700, 700, 700, 700],
};

export async function exportAssets(fonts: Record<string, string>) {
  for (const [family, data] of Object.entries(fonts)) {
    const face = new FontFace(family, `url(data:font/ttf;base64,${data})`);
    document.fonts.add(face);
    await face.load();
  }
  const files: Record<string, string> = {};
  const atlas: {
    meta: Record<string, string | number>;
    animations: Record<
      string,
      { frames: { x: number; y: number; w: number; h: number; duration: number }[]; loop: boolean }
    >;
  } = {
    meta: {
      image: "hypeman.png",
      frameWidth: W,
      frameHeight: H,
      sheetWidth: W * 8,
      sheetHeight: H * states.length,
      version: 1,
    },
    animations: {},
  };
  const sheet = canvas(W * 8, H * states.length),
    sheetCtx = sheet.getContext("2d")!;
  for (const [row, state] of states.entries()) {
    const frames = [];
    for (let col = 0; col < 8; col++) {
      const img = frame(state, col);
      sheetCtx.drawImage(img, col * W, row * H);
      frames.push({
        x: col * W,
        y: row * H,
        w: W,
        h: H,
        duration: (durations[state] ?? durations.idle)[col],
      });
      if (col === 0) files[`hypeman-${state}.png`] = file(img);
    }
    atlas.animations[state] = {
      frames,
      loop: !["wave", "greet", "celebrate", "hype"].includes(state),
    };
  }
  files["hypeman.png"] = file(sheet);
  // Fresh toolbar plates built from the supplied head art; nearest-neighbour at every size.
  for (const size of [16, 32, 48, 128]) {
    const native = canvas(16, 16),
      n = native.getContext("2d")!;
    n.imageSmoothingEnabled = false;
    n.fillStyle = "#1B1F3B";
    n.fillRect(0, 0, 16, 16);
    n.drawImage(base, 7, 1, 16, 16, 1, 1, 14, 14);
    n.fillStyle = "#00E5FF";
    n.fillRect(2, 0, 12, 1);
    n.fillRect(0, 2, 1, 12);
    n.fillStyle = "#FF5FD2";
    n.fillRect(2, 15, 12, 1);
    n.fillRect(15, 2, 1, 12);
    const icon = canvas(size, size),
      ctx = icon.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(native, 0, 0, size, size);
    files[`icon${size}.png`] = file(icon);
  }

  const preview = canvas(W * states.length * 3, H * 3),
    previewCtx = preview.getContext("2d")!;
  previewCtx.imageSmoothingEnabled = false;
  previewCtx.fillStyle = "#1B1F3B";
  previewCtx.fillRect(0, 0, preview.width, preview.height);
  states.forEach((state, i) => previewCtx.drawImage(frame(state, 2), i * W * 3, 0, W * 3, H * 3));
  files["preview-characters.png"] = file(preview);
  const props: Record<string, { file: string; width: number; height: number }> = {};
  function prop(name: string, s: Surface, box?: [number, number, number, number]) {
    const img = box ? crop(s.canvas, ...box) : s.canvas;
    files[`prop-${name}.png`] = file(img);
    props[name] = { file: `prop-${name}.png`, width: img.width, height: img.height };
  }
  function matrix(name: string, rows: readonly string[], remap?: Record<string, string>) {
    const s = new Surface(rows[0].length, rows.length);
    s.sprite(rows, 0, 0, { remap });
    prop(name, s);
  }
  matrix("blimp", BLIMP);
  matrix("bolt", BOLT);
  matrix("pigeon", PIGEON.stand[0]);
  matrix("pigeon-fly", PIGEON.fly[0]);
  matrix("sparkle", SPARKLE[2]);
  matrix("cloud", CLOUDS[1], { w: "I", I: "V" });
  const world: World = {
    t: 0,
    now: new Date("2026-10-10T00:00:00"),
    glow: 1,
    micLive: false,
    soundOn: false,
    avatarState: "idle",
    im: { text: "", caret: 0, focused: false, log: [] },
    crt: { channel: 2, status: "", steps: [], changedAt: -9000, typedAt: 0 },
    jumbotron: { h24: true, dateUntil: 0 },
    boombox: { playing: false },
    pigeons: { scatteredAt: null },
    graffiti: { shimmerAt: null },
  };
  for (const [name, draw, box] of [
    ["crt", drawCrt, [2, 168, 122, 88]],
    ["boombox", drawBoombox, [409, 230, 60, 33]],
    ["graffiti", drawGraffiti, [0, 122, 124, 31]],
    ["jumbotron", drawJumbotron, [6, 18, 118, 45]],
  ] as const) {
    const s = new Surface(480, 270);
    if (name === "crt") drawCrtShell(s, "night");
    draw(s, world);
    prop(name, s, [...box] as [number, number, number, number]);
  }
  for (const phase of ["dawn", "day", "dusk", "night"] as Phase[]) {
    const sky = new Surface(480, 270),
      far = new Surface(480, 270),
      near = new Surface(480, 270),
      roof = new Surface(480, 270),
      lights = new Surface(480, 270),
      decor = new Surface(480, 270);
    drawSky(sky, phase, 0);
    drawFar(far, phase, 0, null);
    drawNear(near, phase, 0);
    drawRoof(roof, phase);
    drawCrtShell(roof, phase);
    world.glow = THEMES[phase].glow;
    drawStringLights(lights, world);
    drawGraffiti(decor, world);
    drawCrt(decor, world);
    drawBoombox(decor, world);
    drawPigeons(decor, world);
    drawJumbotron(decor, world);
    const full = new Surface(480, 270);
    for (const [name, layer] of Object.entries({ sky, far, near, roof, lights, decor })) {
      files[`${name}-${phase}.png`] = file(layer.canvas);
      full.blit(layer.canvas);
    }
    files[`scene-${phase}.png`] = file(full.canvas);
  }
  return { files, atlas, props };
}
Object.assign(window, { exportAssets });
