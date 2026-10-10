/**
 * Small scene sprites, authored the same way as HypeMan: one palette key per
 * pixel. `sprite()` pads ragged rows, so trailing dots are optional.
 */
import { sprite } from './surface';

/**
 * Builds a cumulus cloud from overlapping round lobes sitting on a flat
 * base. The top is 'w' (gloss white) and the underside 'c' (cloud shade),
 * with one dithered row between them; both keys are remapped per phase.
 */
function cumulus(width: number, height: number, lobes: [x: number, y: number, r: number][]): readonly string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const inside = lobes.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.5);
      if (!inside) row += '.';
      else if (y >= height - 3) row += 'c';
      else if (y === height - 4) row += (x + y) % 2 ? 'c' : 'w';
      else row += 'w';
    }
    rows.push(row);
  }
  return sprite(...rows);
}

export const CLOUDS = [
  cumulus(58, 21, [
    [8, 17, 5],
    [18, 13, 9],
    [31, 10, 10],
    [43, 13, 8],
    [51, 17, 5],
  ]),
  cumulus(44, 16, [
    [6, 13, 4],
    [15, 9, 8],
    [27, 10, 7],
    [36, 12, 6],
    [40, 14, 3],
  ]),
  cumulus(28, 11, [
    [5, 9, 3],
    [13, 6, 6],
    [21, 8, 4],
    [24, 9, 3],
  ]),
];

/** The puff that pops when the daytime sky is clicked. Three growth frames. */
export const PUFF = [
  sprite('.ww.', 'wwww', '.ww.'),
  sprite('..www..', '.wwwww.', 'wwwwwww', '.wwwww.', '..ccc..'),
  sprite('...wwww....', '.wwwwwwww..', 'wwwwwwwwwww', 'wwwwwwwwwww', '.cwwwwwwwc.', '..ccccccc..'),
];

/** A plain glossy-white blimp with a water-teal stripe, nose to the right. No markings. */
export const BLIMP = sprite(
  '...........WWWWWWWWWWWWWWWWW',
  '.......WWWWwwwwwwwwwwwwwwwwwWWWW',
  'M....WWwwwwwwwwwwwwwwwwwwwwwwwwwWW',
  'MM.WWwwwwwwwwwwwwwwwwwwwwwwwwwwwwwWW',
  'MMMWhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhW',
  'MMMWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAW',
  'MMMWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
  'MMMWccccccccccccccccccccccccccccccccW',
  'MM.WWcccccccccccccccccccccccccccccWW',
  'M....WWWcccccccccccccccccccccccWWW',
  '........MMMMMMMMMMMMMMMMMMMMMMM',
  '...............KDDDDDDDK',
  '................KIIIIIK',
  '.................KKKKK',
);

/**
 * Pigeon, facing right, in soft grey-white with a gloss pixel on its back:
 * two standing frames (head bob) and two flying frames.
 */
export const PIGEON = {
  stand: [
    sprite(
      '......WW',
      '.....WKWH',
      '.....WVW',
      '..wWWWWW',
      '.WWMMWW',
      'MMWWMW',
      '.MMWWW',
      '...H.H',
    ),
    sprite(
      '',
      '.......WW',
      '......WKWH',
      '..wWWWVW',
      '.WWMMWW',
      'MMWWMW',
      '.MMWWW',
      '...H.H',
    ),
  ],
  fly: [
    sprite(
      '..ww',
      '..wWw....WW',
      '...wWWw.WKWH',
      '....WWWWWVW',
      '.MMWWWWWW',
      'MM.WWWWW',
      '.....HH',
    ),
    sprite(
      '',
      '.........WW',
      '........WKWH',
      '.MMWWWWWWVW',
      'MM.WWWWWW',
      '...wWWWw',
      '..wWw.HH',
      '..ww',
    ),
  ],
};

/**
 * A satellite dish in glossy metal. The digits are remapped per phase:
 * 1 gloss, 2 light, 3 body, 4 shadow and mast.
 */
export const DISH = sprite(
  '.........4',
  '..113...4',
  '.12333.4',
  '1233334',
  '2333344',
  '3333444',
  '.334444',
  '..4444',
  '....44',
  '....44',
  '...4444',
);

/** A 1px circle, `diameter` pixels across. */
function ring(diameter: number, key: string): readonly string[] {
  const r = (diameter - 1) / 2;
  const rows: string[] = [];
  for (let y = 0; y < diameter; y++) {
    let row = '';
    for (let x = 0; x < diameter; x++) {
      const d = Math.hypot(x - r, y - r);
      row += Math.abs(d - r) < 0.55 ? key : '.';
    }
    rows.push(row);
  }
  return sprite(...rows);
}

/** Pieces of the daytime lens flare, in sun glow ('Y') and haze ('h'). */
export const FLARE = {
  smallRing: ring(7, 'Y'),
  dot: sprite('hh', 'hh'),
  largeRing: ring(11, 'h'),
  bigDot: sprite('.Y.', 'YYY', '.Y.'),
};

/**
 * Ambient bubbles in three sizes. 'w' is the lit upper-left of the ring and
 * its highlight, 'I' the lower-right; both are remapped per phase.
 */
export const BUBBLES = [
  sprite(
    '.ww..',
    'ww..I',
    'w...I',
    'I...I',
    '.III.',
  ),
  sprite(
    '..www..',
    '.w...I.',
    'w.w...I',
    'w.....I',
    'w.....I',
    '.I...I.',
    '..III..',
  ),
  sprite(
    '...www...',
    '.ww...II.',
    '.w.w...I.',
    'w.w.....I',
    'w.......I',
    'w.......I',
    '.I.....I.',
    '.II...II.',
    '...III...',
  ),
];

/** The same bubbles with an outline ring around them, for skies a light ring would vanish into. */
export const BUBBLES_OUTLINED = BUBBLES.map((bubble) => {
  const size = bubble.length + 2;
  const padded = ['.'.repeat(size), ...bubble.map((row) => `.${row}.`), '.'.repeat(size)].map((row) => [...row]);
  // Flood the outside, then ring every outside pixel that touches the bubble.
  const outside = padded.map((row) => row.map(() => false));
  const queue: [number, number][] = [[0, 0]];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    if (x < 0 || y < 0 || x >= size || y >= size || outside[y][x] || padded[y][x] !== '.') continue;
    outside[y][x] = true;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && padded[y][x] !== '.';
  return sprite(
    ...padded.map((row, y) =>
      row.map((key, x) => (outside[y][x] && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ? 'K' : key)).join(''),
    ),
  );
});

/** A bubble popping: a ring of droplets. */
export const BUBBLE_POP = sprite('w...w', '.....', '..w..', '.....', 'w...w');

/** The send button: a beveled lightning bolt. */
export const BOLT = sprite(
  '.......KKKKKKK',
  '......KwwYYYK',
  '.....KwYYYYK',
  '....KwYYYYK',
  '...KwYYYYK',
  '..KwYYYYKKKKK',
  '.KwYYYYYYYYYK',
  '.KHHHHYYYYHK',
  '..KKKKYYYHK',
  '.....KYYHK',
  '....KYYHK',
  '...KYYHK',
  '..KYYHK',
  '.KYYHK',
  '.KYHK',
  '.KHK',
  '.KK',
);

/** Sparkles for the hype burst and chrome glints: three sizes. */
export const SPARKLE = [
  sprite('w'),
  sprite('.w.', 'wYw', '.w.'),
  sprite('..w..', '..Y..', 'wYwYw', '..Y..', '..w..'),
];

/** An eighth note; 'H' is remapped to vary the colour. */
export const NOTE = sprite('..HHH', '..H.H', '..H', 'HHH', 'HHH');

/** The "Z" that drifts up while he is away from keyboard. */
export const ZED = [sprite('www', '.w.', 'www'), sprite('wwww', '..w.', '.w..', 'wwww')];

/**
 * Block letters, 7 rows tall. The graffiti renderer doubles them and
 * inflates the strokes, so one-cell gaps close up into bubble-letter notches.
 */
export const TAG_LETTERS: Record<string, readonly string[]> = {
  H: sprite('#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
  Y: sprite('#...#', '#...#', '##.##', '.###.', '..#..', '..#..', '..#..'),
  P: sprite('####.', '#...#', '#...#', '####.', '#....', '#....', '#....'),
  E: sprite('#####', '#....', '#....', '####.', '#....', '#....', '#####'),
  M: sprite('#.....#', '##...##', '###.###', '#.###.#', '#..#..#', '#.....#', '#.....#'),
  A: sprite('.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
  N: sprite('#...#', '##..#', '###.#', '#.###', '#..##', '#...#', '#...#'),
};
