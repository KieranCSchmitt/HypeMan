/**
 * Orbit sprite frames.
 *
 * Same rules as HypeMan's frames: every frame is a 32x48 matrix, one
 * character per pixel, each a key from ./palette.ts ('.' is transparent,
 * 'a' marks the LED on her PDA, lit green while the mic is live).
 * Her feet stand on the same baseline row as HypeMan's.
 *
 *   K outline        4 hair           p sky pale       I ice
 *   1 skin light     5 hair sheen     B sky mid        C cyber cyan
 *   2 skin mid       w gloss white    h haze           U sky deep
 *   3 skin shadow    W chrome light   6 denim          V lavender
 *   M chrome mid     D chrome dark    7 denim fade     c cloud shade
 *   a PDA LED        . transparent
 *
 * A 42px figure with an average build, facing the viewer in the same 3/4
 * view as HypeMan.
 * The face (eyes, catchlights, nose, mouth) is the shared template, six
 * rows from the brow down.
 */
import type { Frame } from '../../hypeman/frames';

/**
 * idle 0: PDA in one hand, tapping its screen with the stylus in the
 * other.
 */
// prettier-ignore
export const IDLE_0: Frame = [
  //         1111111111222222222233
  //1234567890123456789012345678901
  '................................', //  0
  '................................', //  1
  '................................', //  2
  '................................', //  3
  '................................', //  4
  '................................', //  5
  '...........KKKKKKKK.............', //  6  crown
  '..........K45544444K............', //  7  sleek hair: a long sheen along the top
  '.........KwwwwwwwwwcK...........', //  8  glossy white headband
  '........K445412224444K..........', //  9  hair swept to both sides
  '........K454233233444K..........', // 10  brows, face-framing pieces
  '........K4542wK2wK244K..........', // 11  eyes with catchlights
  '........K44422K22K244K..........', // 12
  '........K451122213244K..........', // 13  nose
  '........K442213332244K..........', // 14  mouth
  '........K44K322223K44K..........', // 15  jaw, bob turning in at the chin
  '.........KK.K3223K.KK...........', // 16  neck
  '......KKKKKWWppppWWKKKKK........', // 17  shoulders, vest collar
  '.....KhppKwwwMppMwwcKppBK.......', // 18  puffer vest: gloss along the top of each tube
  '.....KhppKWWWMppMWWMKppBK.......', // 19
  '.....KhppKKKKKKKMMVMKppBK.......', // 20  quilting seam / top of the PDA / stylus
  '.....KhppKwwwwIKKVwcKppBK.......', // 21  PDA gloss band
  '.....KhppKhUUUIK12KKKppBK.......', // 22  PDA screen / hand on the stylus
  '.....KhppKIUhUIV23pppppBK.......', // 23  stylus tip on the screen
  '.....KhppKIUUUVKKKppBBBBK.......', // 24
  '......K12KIIaICKppKKKKKK........', // 25  hand under the PDA / LED
  '......K23KCCCCCKppBK............', // 26  fitted long-sleeve below the cropped vest
  '.......KKKKKKKKKppBK............', // 27
  '.........K776666666K............', // 28  mid-rise jeans
  '.........K766666666K............', // 29
  '.........K766666666K............', // 30
  '.........K766666666K............', // 31
  '.........K7666K6666K............', // 32
  '.........K7766K7766K............', // 33  thigh fade
  '.........K7766K7766K............', // 34
  '.........K7666K7666K............', // 35
  '.........K7666K7666K............', // 36
  '........K76666K66666K...........', // 37  flare starts at the knee
  '........K76666K66666K...........', // 38
  '.......K776666K666666K..........', // 39
  '.......K766666K666666K..........', // 40
  '......K7666666K6666666K.........', // 41
  '......K7666666K6666666K.........', // 42  hem
  '......KKwwwwwwKwwwwwwwK.........', // 43  platform sneakers
  '.......KVVVVVVKVVVVVVVK.........', // 44  lavender trim
  '.......KwwwwwwKwwwwwwwK.........', // 45  platform
  '.......KccccccKcccccccK.........', // 46
  '........KKKKKK.KKKKKKK..........', // 47
];
