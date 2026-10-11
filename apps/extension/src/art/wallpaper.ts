import atlas from "../../public/assets/y2k/hypeman-atlas.json";
import { LAYOUT, SCENE_H, SCENE_W, type Rect } from "../../../../scripts/art/scene/constants";
import { AmbientBubbles, Effects } from "../../../../scripts/art/scene/fx";
import { drawFar, drawNear, drawRoof, drawSky, drawSignSupports, BLIMP_CROSSING_MS } from "../../../../scripts/art/scene/layers";
import { CLOUDS } from "../../../../scripts/art/scene/sprites";
import { drawFountain, drawFountainStone } from "../../../../scripts/art/scene/fountain";
import { drawBoombox, drawCrt, drawCrtShell, drawGraffiti, drawJumbotron, drawPigeons, drawPropOutline, drawStringLights, pigeonsAreBack, type World } from "../../../../scripts/art/scene/props";
import { Surface, clearTextCache, dissolve } from "../../../../scripts/art/scene/surface";
import { DayClock, PHASES, THEMES, type Phase } from "../../../../scripts/art/scene/timeOfDay";
import { wallpaperLayout, wallpaperTiles, wallpaperPoint, wallpaperClouds } from "./wallpaper-layout";

export type WallpaperAction = "sky" | "clock" | "graffiti" | "crt" | "pigeons" | "hypeman" | "boombox";
export type WallpaperActivity = keyof typeof atlas.animations;
export const WALLPAPER_ACTIONS: { id: WallpaperAction; label: string; rect: Rect }[] = [
  { id: "sky", label: "Launch an airship", rect: { x: 128, y: 0, w: 352, h: 92 } },
  { id: "clock", label: "Change time of day", rect: { ...LAYOUT.jumbotron, h: 40 } },
  { id: "graffiti", label: "Shimmer the graffiti", rect: LAYOUT.graffiti },
  { id: "crt", label: "Change the TV channel", rect: LAYOUT.crt },
  { id: "pigeons", label: "Scatter the pigeons", rect: { ...LAYOUT.pigeons, y: 171, h: 22 } },
  { id: "hypeman", label: "Open HypeMan", rect: { x: LAYOUT.homeX - 24, y: LAYOUT.walkY - 64, w: 48, h: 64 } },
  { id: "boombox", label: "Toggle HypeMan’s dance", rect: LAYOUT.boombox },
];

type Animation = keyof typeof atlas.animations;
type Viewport = { x: number; y: number; scale: number; scaleY: number };
type Options = { reduced: boolean; spriteURL: string; onLayout: (viewport: Viewport, avatar: Rect) => void; onAction?: (action: WallpaperAction) => void };

/** Draws and animates the rooftop artwork. */
export class Wallpaper {
  private readonly ink: CanvasRenderingContext2D;
  private readonly scene = new Surface(SCENE_W, SCENE_H);
  private readonly scenery = new Surface(SCENE_W, SCENE_H);
  private readonly clouds = CLOUDS.map(sprite => new Surface(sprite[0].length, sprite.length));
  private readonly layer = new Surface(SCENE_W, SCENE_H);
  private readonly from = new Surface(SCENE_W, SCENE_H);
  private readonly to = new Surface(SCENE_W, SCENE_H);
  private readonly mask = new Surface(SCENE_W, SCENE_H);
  private readonly sprite = new Image();
  private readonly clock = new DayClock();
  private readonly bubbles = new AmbientBubbles(SCENE_W, SCENE_H, 7);
  private readonly effects = new Effects();
  private readonly observer: ResizeObserver;
  private densityQuery: MediaQueryList | null = null;
  private readonly world: World = {
    t: 0, now: new Date(), glow: 0, avatarState: "idle",
    im: { text: "", caret: 0, focused: false, log: [] },
    crt: { channel: 2, status: "", steps: [], changedAt: -9999, typedAt: 0 },
    jumbotron: { h24: true, dateUntil: 0 }, boombox: { playing: false },
    pigeons: { scatteredAt: null }, graffiti: { shimmerAt: null },
  };
  private reduced: boolean;
  private disposed = false;
  private raf = 0;
  private timer: ReturnType<typeof setInterval>;
  private lastFrame = 0;
  private lastNote = 0;
  private lastZed = 0;
  private width = 1;
  private height = 1;
  private cssWidth = 1;
  private cssHeight = 1;
  private layoutKey = "";
  private viewport = { x: 0, y: 0, scale: 1 };
  private pointer = { x: 0, y: 0 };
  private parallax = { x: 0, y: 0 };
  private hover: WallpaperAction | null = null;
  private focus: WallpaperAction | null = null;
  private x: number = LAYOUT.homeX;
  private target: number | null = null;
  private state: Animation = "idle";
  private animationAt = 0;
  private oneShot: "greet" | "hype" | "celebrate" | null = null;
  private activity: WallpaperActivity = "idle";
  private activityKey = 0;
  private completedActivity: WallpaperActivity | null = null;
  private blimpAt: number | null = -13_000;
  private nextBlimp = 80_000;
  private phase: Phase = "day";

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: Options) {
    this.ink = canvas.getContext("2d", { alpha: false })!;
    this.reduced = options.reduced;
    this.sprite.onload = () => this.draw();
    this.sprite.src = options.spriteURL;
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    window.addEventListener("resize", this.resize);
    this.watchDensity();
    document.addEventListener("visibilitychange", this.visibility);
    document.fonts.addEventListener("loadingdone", this.fontsChanged);
    void document.fonts.ready.then(() => { if (!this.disposed) this.fontsChanged(); });
    this.resize();
    this.timer = setInterval(() => { if (!document.hidden && this.still) this.draw(); }, 30_000);
    this.resume();
  }
  get still(): boolean { return this.reduced; }
  get dancing(): boolean { return this.world.boombox.playing; }
  setDancing(playing: boolean): void { this.world.boombox.playing = playing; this.draw(); }
  get timeOfDay(): Phase { return this.clock.blend().to; }
  setSprite(url: string): void { if (this.sprite.src !== url) this.sprite.src = url; }
  setReducedMotion(reduced: boolean): void { this.reduced = reduced; this.motionChanged(); }
  setActivity(activity: WallpaperActivity, animationKey = 0): void {
    if (activity === this.activity && animationKey === this.activityKey) return;
    this.activity = activity;
    this.activityKey = animationKey;
    this.completedActivity = null;
    this.oneShot = null;
    this.animationAt = this.world.t;
    this.state = activity;
    if ((activity === "celebrate" || activity === "hype") && !this.still) this.effects.burst(this.x, 221, this.world.t, 10);
    this.draw();
  }
  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.observer.disconnect();
    window.removeEventListener("resize", this.resize);
    this.densityQuery?.removeEventListener("change", this.densityChanged);
    document.removeEventListener("visibilitychange", this.visibility);
    document.fonts.removeEventListener("loadingdone", this.fontsChanged);
    this.sprite.onload = null;
    this.effects.clear();
  }
  private fontsChanged = (): void => { clearTextCache(); this.draw(); };
  private watchDensity(): void {
    this.densityQuery?.removeEventListener("change", this.densityChanged);
    this.densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.densityQuery.addEventListener("change", this.densityChanged);
  }
  private densityChanged = (): void => { this.watchDensity(); this.resize(); };
  private visibility = (): void => {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (!document.hidden) { this.draw(); this.resume(); }
  };
  private motionChanged = (): void => {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.parallax = { x: 0, y: 0 }; this.effects.clear();
    this.draw(); this.resume();
  };
  private resume(): void {
    if (this.disposed || this.still || document.hidden || this.raf) return;
    this.lastFrame = performance.now(); this.raf = requestAnimationFrame(this.frame);
  }
  private resize = (): void => {
    const box = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(1, box.width);
    this.cssHeight = Math.max(1, box.height);
    const layout = wallpaperLayout(this.cssWidth, this.cssHeight, window.devicePixelRatio);
    this.width = this.canvas.width = layout.width;
    this.height = this.canvas.height = layout.height;
    this.viewport = layout.viewport;
    this.draw();
  };
  private frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed || document.hidden || this.still) return;
    const elapsed = now - this.lastFrame;
    // One 24 fps loop owns every layer, paused for hidden documents.
    if (elapsed >= 1000 / 24) {
      const dt = Math.min(elapsed, 100); this.lastFrame = now; this.world.t += dt;
      if (this.world.t >= this.nextBlimp) { this.blimpAt = this.world.t; this.nextBlimp = this.world.t + BLIMP_CROSSING_MS + 65_000; }
      if (this.target !== null) {
        const diff = this.target - this.x;
        this.x += Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.045);
        if (Math.abs(this.target - this.x) < 0.5) this.target = null;
      }
      const ease = Math.min(1, dt / 200);
      this.parallax.x += (this.pointer.x - this.parallax.x) * ease;
      this.parallax.y += (this.pointer.y - this.parallax.y) * ease;
      this.bubbles.update(dt, this.world.t);
      if (this.world.boombox.playing && this.world.t - this.lastNote > 800) { this.effects.note(438, 231, this.world.t); this.lastNote = this.world.t; }
      if ((this.activity === "sleepy" || this.activity === "afk") && this.world.t - this.lastZed > 2000) { this.effects.zed(this.x + 12, 207, this.world.t); this.lastZed = this.world.t; }
      this.draw();
    }
    this.raf = requestAnimationFrame(this.frame);
  };
  private nativePoint(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    return wallpaperPoint(this.viewport, clientX - box.left, clientY - box.top);
  }
  pointerMove(clientX: number, clientY: number): void {
    const p = this.nativePoint(clientX, clientY);
    this.pointer = { x: Math.max(-1, Math.min(1, p.x / SCENE_W * 2 - 1)), y: Math.max(-1, Math.min(1, p.y / SCENE_H * 2 - 1)) };
  }
  pointerLeave(): void { this.pointer = { x: 0, y: 0 }; this.hover = null; this.drawIfStill(); }
  highlight(action: WallpaperAction | null, keyboard = false): void {
    if (keyboard) this.focus = action; else this.hover = action;
    this.drawIfStill();
  }
  walk(direction: -1 | 1): void { this.walkTo(this.x + direction * 32); }
  walkAt(clientX: number, clientY: number): void {
    const p = this.nativePoint(clientX, clientY);
    const scene = WALLPAPER_ACTIONS.find(({ id, rect }) => id !== "hypeman" && id !== "sky" && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h);
    if (scene) this.activate(scene.id, p);
    else if (p.y > LAYOUT.floorTop) this.walkTo(p.x);
    else if (p.y < LAYOUT.rightWall.y) this.activate("sky", p);
  }
  private walkTo(x: number): void {
    const next = Math.max(LAYOUT.walkMinX, Math.min(LAYOUT.walkMaxX, x));
    if (this.still) { this.x = next; this.target = null; this.draw(); }
    else { this.target = next; this.oneShot = null; }
  }
  activate(action: WallpaperAction, point?: { x: number; y: number }): void {
    switch (action) {
      case "sky": {
        this.blimpAt = this.world.t - 5000; this.nextBlimp = this.world.t + 90_000;
        if (!this.still) {
          const p = point ?? { x: 302, y: 48 };
          if (this.world.glow > 0.5) this.effects.shootingStar(p.x, p.y, this.world.t);
          else this.effects.puff(p.x, p.y, this.world.t);
        }
        break;
      }
      case "clock": {
        const phase = PHASES[(PHASES.indexOf(this.timeOfDay) + 1) % PHASES.length];
        this.clock.force(phase, this.still ? 0 : 700); this.world.jumbotron.h24 = !this.world.jumbotron.h24;
        break;
      }
      case "graffiti": this.world.graffiti.shimmerAt = this.world.t; if (!this.still) this.effects.burst(60, 136, this.world.t, 8); break;
      case "crt": this.world.crt.channel = this.world.crt.channel === 2 ? 1 : 2; break;
      case "pigeons": if (pigeonsAreBack(this.world)) this.world.pigeons.scatteredAt = this.world.t; break;
      case "boombox": this.world.boombox.playing = !this.world.boombox.playing; if (!this.still && this.world.boombox.playing) this.effects.burst(438, 236, this.world.t, 6); break;
      case "hypeman": this.oneShot = this.world.boombox.playing ? "hype" : "greet"; this.animationAt = this.world.t; this.state = this.oneShot; if (!this.still) this.effects.burst(this.x, 221, this.world.t, 8); break;
    }
    this.draw(); this.options.onAction?.(action);
  }
  private drawIfStill(): void { if (this.still) this.draw(); }
  private avatarRect(): Rect { return { x: this.x - 24, y: LAYOUT.walkY - 64, w: 48, h: 64 }; }
  private backdrop(draw: (surface: Surface, phase: Phase) => void, amount: number): void {
    const blend = this.clock.blend();
    const ox = this.still ? 0 : -Math.round(this.parallax.x * amount);
    const oy = this.still ? 0 : -Math.round(this.parallax.y * amount * 0.5);
    const paint = (s: Surface, phase: Phase) => { s.clear(); s.offset(ox, oy); draw(s, phase); s.offset(0, 0); };
    if (blend.mix >= 1 || blend.from === blend.to) paint(this.layer, blend.to);
    else { paint(this.from, blend.from); paint(this.to, blend.to); dissolve(this.layer, this.from, this.to, blend.mix, this.mask); }
    this.scene.blit(this.layer.canvas);
  }
  private draw(): void {
    if (this.disposed || document.hidden) return;
    const blend = this.clock.blend();
    this.phase = blend.mix >= 0.5 ? blend.to : blend.from;
    this.world.glow = THEMES[blend.from].glow + (THEMES[blend.to].glow - THEMES[blend.from].glow) * blend.mix;
    this.world.now = new Date();
    const t = this.still ? 0 : this.world.t;
    this.scene.clear();
    this.backdrop((s, p) => drawSky(s, p, t, this.still), 3);
    this.backdrop((s, p) => drawFar(s, p, t, this.still ? null : this.blimpAt, false), 2);
    this.backdrop((s, p) => drawNear(s, p, t, false), 1);
    this.backdrop((s, p) => drawRoof(s, p, false), 0);
    const world = this.still ? { ...this.world, t: 0, pigeons: { scatteredAt: null }, graffiti: { shimmerAt: null } } : this.world;
    drawStringLights(this.scene, world, this.phase);
    // Repeat only the environment: the avatar and interactive props stay unique.
    this.scenery.clear();
    this.scenery.blit(this.scene.canvas);
    this.scene.clear();
    this.backdrop((s, p) => drawSignSupports(s, p), 1);
    this.backdrop((s, p) => drawCrtShell(s, p), 0);
    this.backdrop((s, p) => drawFountainStone(s, p), 0);
    drawFountain(this.scene, this.phase, t, this.still);
    if (!this.still) this.bubbles.draw(this.scene, t, THEMES[this.phase].bubble);
    drawGraffiti(this.scene, world); drawCrt(this.scene, world);
    drawPigeons(this.scene, world); drawBoombox(this.scene, world); drawJumbotron(this.scene, world);
    this.drawAvatar();
    if (!this.still) this.effects.draw(this.scene, t);
    const action = this.focus ?? this.hover;
    if (action === "hypeman") { const r = this.avatarRect(); this.scene.roundFrame(r.x + 5, r.y + 9, r.w - 10, r.h - 8, "C"); }
    else if (action && action !== "sky") drawPropOutline(this.scene, action === "clock" ? "jumbotron" : action, world);
    this.present();
  }
  private drawAvatar(): void {
    if (!this.sprite.complete || !this.sprite.naturalWidth) return;
    const moving = this.target !== null;
    const resting = this.completedActivity === this.activity ? "idle" : this.activity;
    const wanted: Animation = resting !== "idle" ? resting : this.oneShot ?? (moving || this.world.boombox.playing ? "walk" : "idle");
    if (wanted !== this.state) { this.state = wanted; this.animationAt = this.world.t; }
    const animation = atlas.animations[this.state];
    const duration = animation.frames.reduce((sum, f) => sum + f.duration, 0);
    let age = this.still ? 0 : this.world.t - this.animationAt;
    if (!animation.loop && age >= duration) {
      if (this.state === this.activity) this.completedActivity = this.activity;
      this.oneShot = null; this.state = "idle"; this.animationAt = this.world.t; age = 0;
    }
    const frames = atlas.animations[this.state].frames;
    age %= frames.reduce((sum, f) => sum + f.duration, 0);
    let frame = frames[0];
    for (const next of frames) { frame = next; if (age < next.duration) break; age -= next.duration; }
    const dancing = this.world.boombox.playing && resting === "idle" && !moving && !this.oneShot && !this.still;
    const beat = Math.floor(this.world.t / 270);
    const feetX = this.x + (dancing ? [0, 3, 0, -3][Math.floor(beat / 2) % 4] : 0);
    const feetY = LAYOUT.walkY - (dancing ? beat % 2 : 0);
    this.scene.blitFlippable(this.sprite, frame.x, frame.y, frame.w, frame.h, feetX - frame.w / 2, feetY - frame.h, moving && this.target! < this.x);
  }
  private present(): void {
    const { x, y, scale } = this.viewport; const ctx = this.ink;
    ctx.setTransform(this.width / this.cssWidth, 0, 0, this.height / this.cssHeight, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.fillStyle = "#1B1F3B"; ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    for (const tile of wallpaperTiles(this.cssWidth, x, scale)) {
      ctx.save();
      ctx.translate(tile.x + (tile.mirrored ? SCENE_W * scale : 0), y);
      ctx.scale(tile.mirrored ? -1 : 1, 1);
      // Continue the sky upward on tall windows without stretching clouds or buildings.
      if (y > 0) ctx.drawImage(this.scenery.canvas, 0, 0, SCENE_W, 1, 0, -y, SCENE_W * scale, y);
      ctx.drawImage(this.scenery.canvas, 0, 0, SCENE_W * scale, SCENE_H * scale);
      ctx.restore();
    }
    const cloud = THEMES[this.phase].cloud;
    for (const [index, surface] of this.clouds.entries()) {
      surface.clear();
      surface.sprite(CLOUDS[index], 0, 0, { remap: { w: cloud.light, c: cloud.shade } });
    }
    for (const position of wallpaperClouds(this.cssWidth, scale, this.still ? 0 : this.world.t)) {
      const surface = this.clouds[position.shape];
      ctx.drawImage(surface.canvas, position.x, position.y, surface.canvas.width * scale, surface.canvas.height * scale);
    }
    // Foreground props cover clouds naturally, without clipping them at tile seams.
    ctx.drawImage(this.scene.canvas, x, y, SCENE_W * scale, SCENE_H * scale);
    const key = `${this.width}:${this.height}:${this.cssWidth}:${this.cssHeight}:${this.x}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.options.onLayout({ x, y, scale, scaleY: scale }, this.avatarRect());
    }
  }
}
