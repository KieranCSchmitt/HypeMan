/**
 * Spark sprite frames.
 *
 * Same rules as HypeMan's frames: every frame is a 32x48 matrix, one
 * character per pixel, each a key from ./palette.ts ('.' is transparent,
 * 'a' marks the LED on her handheld console, lit green while the mic is live).
 * Her feet stand on the same baseline row as HypeMan's.
 *
 *   K outline        J hair           I ice            N deep teal
 *   1 skin light     j hair layers    V lavender       U sky deep
 *   2 skin mid       A teal streaks   L leaf green     D chrome dark
 *   3 skin shadow    w gloss white    C cyber cyan     M chrome mid
 *   h haze           H peach          c cloud shade    a console LED
 *   . transparent
 *
 * The shortest of the roster: a 40px figure, facing the viewer in the same
 * 3/4 view as HypeMan. The puffer's holographic bands (ice, lavender, leaf
 * green, gloss white, two rows each) are drawn here in their resting order.
 * The face (eyes, catchlights, nose, mouth) is the shared template, six
 * rows from the brow down.
 */
import type { Frame } from '../../hypeman/frames';

/**
 * idle 0: both hands on the handheld console, thumbs on the controls.
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
  '................................', //  6
  '................................', //  7
  '...........KKKKKKKK.............', //  8  crown
  '..........KJAAJJJjJK............', //  9  choppy shag, first teal streak
  '.........KJJAAJjJJAAK...........', // 10  second teal streak
  '.........KJjAAJJjJAAK...........', // 11  layers
  '.........KJJAJ3J33AAK...........', // 12  jagged fringe over the brows
  '........KJJ22wK2wK2AJK..........', // 13  eyes with catchlights
  '........KjJ122K22K2AJK..........', // 14
  '........KJJ11222132AJK..........', // 15  nose
  '.......KJjJ22133322JJJK.........', // 16  mouth, ends flicking outward
  '.......KJKJK322223KJKJK.........', // 17  jaw, choppy tips
  '........K.K.K3223K.K.K..........', // 18  neck
  '......KKKKKKIVVVVIKKKKKK........', // 19  shoulders, puffer collar over a lavender long-sleeve
  '.....KwIIIIIIIIMIIIIIIICK.......', // 20  holographic band: ice
  '.....KIIIKIIIIIMIIIIKIICK.......', // 21
  '.....KVVVKVVVVVMVVVVKVVVK.......', // 22  band: lavender
  '.....KVVVKVVVVVMVVVVKVVVK.......', // 23
  '.....KLLLKLLLLLMLLLLKLLLK.......', // 24  band: leaf green
  '.....KLLLKLLLLLMLLLLKLLLK.......', // 25  cropped hem
  '.....KwwwKKVVVVVVVVKKwwcK.......', // 26  band: gloss white on the sleeves / long-sleeve at the waist
  '.....KwwwKKKKKKKKKKKKwwcK.......', // 27  top of the console
  '......K12KwwwwwwwwwAK12K........', // 28  console gloss band, a hand on each end
  '......K22K1KAhhhhAH1K22K........', // 29  thumbs on the d-pad and button, screen between
  '......K23KAAAhIhhAaAK23K........', // 30  LED
  '.......KKKNNNNNNNNNNKKK.........', // 31
  '........KNKKKKKKKKKKNK..........', // 32  wide cargo pants
  '.......KUNNNNNNNNNNNNNK.........', // 33
  '.......KUNNNNNNNNNNNNNK.........', // 34
  '.......KUUUUNNNNNNUUUUK.........', // 35  cargo pocket flaps
  '.......KUNNNNNNKNNNNNNK.........', // 36
  '.......KUNNNNNNKNNNNNNK.........', // 37
  '.......KUUUUNNNKNNUUUUK.........', // 38
  '.......KUNNNNNNKNNNNNNK.........', // 39
  '.......KUNNNNNNKNNNNNNK.........', // 40
  '.......KUNNNNNNKNNNNNNK.........', // 41
  '.......KUUUUUUUKUUUUUUK.........', // 42  drawcord hems
  '........KMDDDDDKMDDDDDK.........', // 43  platform boots
  '.......KwDDDDDDKwDDDDDDK........', // 44  gloss on the toes
  '.......KwwwwwwwKwwwwwwwK........', // 45  gloss white platform soles
  '.......KcccccccKcccccccK........', // 46
  '........KKKKKKK.KKKKKKK.........', // 47
];
