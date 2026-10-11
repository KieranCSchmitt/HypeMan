/**
 * Glitch sprite frames.
 *
 * Same rules as HypeMan's frames: every frame is a 32x48 matrix, one
 * character per pixel, each a key from ./palette.ts ('.' is transparent,
 * 'a' marks the LED on his keychain, lit green while the mic is live).
 * His feet stand on the same baseline row as HypeMan's.
 *
 *   K outline        J hair           B sky mid        M chrome mid
 *   1 skin light     D hair sheen     p sky pale       W chrome light
 *   2 skin mid       T frosted tips   U sky deep       c cloud shade
 *   3 skin shadow    w gloss white    I ice            L leaf green
 *   G grass green    h haze           N deep teal      Y sun glow
 *   a keychain LED   . transparent
 *
 * He is the tallest of the roster: a 46px figure, lanky, facing the viewer
 * in the same 3/4 view as HypeMan.
 * The face (eyes, catchlights, nose, mouth) is the shared template, six
 * rows from the brow down.
 */
import type { Frame } from '../../hypeman/frames';

/**
 * idle 0: spinning the virtual-pet keychain on a raised finger, the other
 * arm loose at his side.
 */
// prettier-ignore
export const IDLE_0: Frame = [
  //         1111111111222222222233
  //1234567890123456789012345678901
  '................................', //  0
  '................................', //  1
  '...........KKKKKKKK..........K..', //  2  crown / top of the keychain egg
  '..........KJDDJjJJJK........KwK.', //  3  straight hair: one sheen streak / gloss on the egg
  '.........KJDDJJjJJJJK......KLhhK', //  4  middle part / the pet's screen
  '.........KJDJJ12JJJJK......KLhNK', //  5  curtain bangs open over the forehead
  '.........KJJJ3323JJJK......KLYaK', //  6  brows / button and LED
  '.........KJT2wK2wKTJK....K.KGGGK', //  7  eyes with catchlights, frosted tips
  '.........KJT12K22KTJK...K1M.KKK.', //  8  frosted tips / finger through the key ring
  '.........KJ11222132JK..KK2K.....', //  9  nose
  '..........K22133322K..K1122K....', // 10  mouth / hand
  '...........K322223K...K1223K....', // 11  jaw
  '.........KKKK3223KKKK..K33K.....', // 12  neck, hood rolled down behind it
  '.....KKKKpBBBK32KBBBUKKwwwcK....', // 13  hood / elastic cuff
  '.....KwwwwwwwBBMBwwwcKKpBBUK....', // 14  white yoke, zip up to the collar
  '....KwwwwwwwwwwMwwwwcKKpBBUK....', // 15
  '....KwwcKwwwwwwMwwwwcKKpBBUK....', // 16
  '....KIIIKIIIIIIMIIIIIKKIIIIK....', // 17  ice band across chest and sleeves
  '....KpBBKpBBBBBMBBBBUKwwwwcK....', // 18  sky mid body / white elbow
  '....KpBBKpBBBBBMBBBBUKwwwccK....', // 19
  '....KpBBKpBBBBBMBBBBUKKKKKK.....', // 20
  '....KpBBKpBBBBBMBBBBUK..........', // 21
  '....KpBBKpBBBBBMBBBBUK..........', // 22
  '....KpBBKpUUUBBMBBUUUK..........', // 23  pocket openings
  '....KpBBKpBBBBBMBBBBUK..........', // 24
  '....KwwcKpBBBBBMBBBBUK..........', // 25  cuff
  '....K122KpBBBBBMBBBBUK..........', // 26  hand
  '....K223KpBBBBBMBBBBUK..........', // 27
  '.....KKKKUUUUUUMUUUUUK..........', // 28  elastic hem, the darkest row
  '........KMMMMMMMMMMMK...........', // 29  cargo pants
  '........KWMMMMMMMMMMK...........', // 30
  '........KWMMMMMMMMMMK...........', // 31
  '........KWMMMMMMMMMMK...........', // 32
  '........KWMMMMKMMMMMK...........', // 33
  '........KDDDMMKMMDDDK...........', // 34  cargo pocket flaps
  '........KDMDMMKMMDMDK...........', // 35  pocket snaps
  '........KDDDMMKMMDDDK...........', // 36
  '........KDDDMMKMMDDDK...........', // 37
  '........KWMMMMKMMMMMK...........', // 38
  '........KWMMMMKMMMMMK...........', // 39
  '........KWMDDMKMMDDMK...........', // 40  creases
  '........KWMMMMKMMMMMK...........', // 41
  '.......KMMMMMMKMMMMMMK..........', // 42  hems stack on the sneakers
  '.......KwwMwMwKwwMwMwK..........', // 43  chunky sneakers, laces
  '......KwwwwwwcKwwwwwwcK.........', // 44
  '......KcccccccKcccccccK.........', // 45  cloud shade soles
  '......KMMMMMMMKMMMMMMMK.........', // 46
  '.......KKKKKKK.KKKKKKK..........', // 47
];
