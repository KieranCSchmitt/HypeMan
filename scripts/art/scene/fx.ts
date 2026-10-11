/**
 * Short-lived effects drawn over the scene: sparkles, music notes, sleepy
 * Zs, shooting stars, cloud puffs, and floating bubbles.
 */
import { BUBBLES, BUBBLES_OUTLINED, BUBBLE_POP, NOTE, PUFF, SPARKLE, ZED } from './sprites';
import { Surface } from './surface';

type Kind = 'sparkle' | 'note' | 'zed' | 'star' | 'puff';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  seed: number;
}

const NOTE_COLOURS = ['H', 'C', 'Y', 'L'];
const STAR_TRAIL = ['w', 'w', 'I', 'I', 'C', 'C', 'B', 'B', 'U'];

export class Effects {
  private particles: Particle[] = [];

  private add(kind: Kind, x: number, y: number, vx: number, vy: number, born: number, life: number): void {
    if (this.particles.length > 160) this.particles.shift();
    this.particles.push({ kind, x, y, vx, vy, born, life, seed: Math.floor(Math.random() * 1000) });
  }

  /** The sparkle burst that goes with the hype animation. */
  burst(x: number, y: number, t: number, count = 14): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 26 + Math.random() * 34;
      this.add('sparkle', x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - 18, t + Math.random() * 120, 700 + Math.random() * 500);
    }
  }

  note(x: number, y: number, t: number): void {
    this.add('note', x, y, (Math.random() - 0.5) * 8, -14, t, 2200);
  }

  zed(x: number, y: number, t: number): void {
    this.add('zed', x, y, 5, -7, t, 2600);
  }

  shootingStar(x: number, y: number, t: number): void {
    this.add('star', x + 34, y - 17, -96, 48, t, 760);
  }

  puff(x: number, y: number, t: number): void {
    this.add('puff', x, y, 3, -0.6, t, 3400);
  }

  clear(): void {
    this.particles = [];
  }

  draw(surface: Surface, t: number): void {
    this.particles = this.particles.filter((p) => t - p.born < p.life);
    for (const p of this.particles) {
      const age = t - p.born;
      if (age < 0) continue;
      const seconds = age / 1000;
      const u = age / p.life;
      let x = p.x + p.vx * seconds;
      let y = p.y + p.vy * seconds;
      switch (p.kind) {
        case 'sparkle': {
          y += 40 * seconds * seconds;
          const image = SPARKLE[u < 0.35 ? 2 : u < 0.7 ? 1 : 0];
          surface.sprite(image, x - (image[0].length >> 1), y - (image.length >> 1), p.seed % 3 === 0 ? { remap: { Y: 'H' } } : p.seed % 3 === 1 ? { remap: { Y: 'C' } } : {});
          break;
        }
        case 'note':
          x += Math.round(Math.sin(seconds * 4 + p.seed) * 2);
          if (u < 0.85 || Math.floor(age / 90) % 2 === 0) {
            surface.sprite(NOTE, x, y, { remap: { H: NOTE_COLOURS[p.seed % NOTE_COLOURS.length] } });
          }
          break;
        case 'zed':
          surface.sprite(ZED[u < 0.4 ? 0 : 1], x, y, u > 0.75 ? { remap: { w: 'M' } } : {});
          break;
        case 'star':
          STAR_TRAIL.forEach((key, i) => surface.px(Math.round(x) + i * 2, Math.round(y) - i, key));
          surface.px(Math.round(x) + 1, Math.round(y), 'w');
          break;
        case 'puff': {
          const image = PUFF[age < 110 ? 0 : age < 220 ? 1 : u > 0.94 ? 0 : u > 0.86 ? 1 : 2];
          surface.sprite(image, x - (image[0].length >> 1), y - (image.length >> 1));
          break;
        }
      }
    }
  }
}

interface Bubble {
  x: number;
  y: number;
  size: number;
  /** Pixels per second, upward. */
  speed: number;
  wobble: number;
  /** When it burst, or null while it is still rising. */
  poppedAt: number | null;
}

/** Never more than this many on screen. */
export const MAX_BUBBLES = 12;
const POP_MS = 220;

/**
 * Ambient bubbles: they drift up slowly with a slight sideways wobble, pop
 * as they leave the top of the frame, and start again from the bottom.
 * Decoration only, nothing here can be clicked.
 */
export class AmbientBubbles {
  private bubbles: Bubble[] = [];

  constructor(
    private readonly width: number,
    private readonly height: number,
    count = 9,
  ) {
    for (let i = 0; i < Math.min(count, MAX_BUBBLES); i++) {
      // Spread the first batch over the whole frame so they do not arrive as a row.
      this.bubbles.push(this.fresh(Math.random() * height));
    }
  }

  private fresh(y: number): Bubble {
    return {
      x: 8 + Math.random() * (this.width - 16),
      y,
      size: Math.floor(Math.random() * BUBBLES.length),
      speed: 5 + Math.random() * 7,
      wobble: Math.random() * Math.PI * 2,
      poppedAt: null,
    };
  }

  update(dt: number, t: number): void {
    this.bubbles = this.bubbles.map((bubble) => {
      if (bubble.poppedAt !== null) {
        return t - bubble.poppedAt > POP_MS ? this.fresh(this.height + 4 + Math.random() * 40) : bubble;
      }
      bubble.y -= (bubble.speed * dt) / 1000;
      if (bubble.y <= 1) bubble.poppedAt = t;
      return bubble;
    });
  }

  draw(surface: Surface, t: number, look: { ring: string; shade: string; outline: string | null }): void {
    const remap = { w: look.ring, I: look.shade };
    for (const bubble of this.bubbles) {
      const x = Math.round(bubble.x + Math.sin(t / 900 + bubble.wobble) * 2.5);
      const y = Math.round(bubble.y);
      if (bubble.poppedAt !== null) {
        surface.sprite(BUBBLE_POP, x, 1, { remap });
        continue;
      }
      const art = (look.outline ? BUBBLES_OUTLINED : BUBBLES)[bubble.size];
      surface.sprite(art, x - (look.outline ? 1 : 0), y - (look.outline ? 1 : 0), { remap });
    }
  }
}

