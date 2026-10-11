/**
 * Rally sprite frames.
 *
 * Same rules as HypeMan's frames: every frame is a 32x48 matrix, one
 * character per pixel, each a key from ./palette.ts ('.' is transparent,
 * 'a' marks the LED on her stopwatch, lit green while the mic is live).
 * Her feet stand on the same baseline row as HypeMan's.
 *
 *   K outline        4 hair           A water teal     W chrome light
 *   1 skin light     D hair sheen     I ice            M chrome mid
 *   2 skin mid       w gloss white    N deep teal      c cloud shade
 *   3 skin shadow    h haze           H peach          a stopwatch LED
 *   . transparent
 *
 * A 43px figure with an athletic build, facing the viewer in the same 3/4
 * view as HypeMan.
 * The face (eyes, catchlights, nose, mouth) is the shared template, six
 * rows from the brow down.
 */
import type { Frame } from '../../hypeman/frames';

/**
 * idle 0: checking the stopwatch in her raised hand, the other hand on her
 * hip with the elbow out.
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
  '.......KKKKKKKKKKKK.............', //  5  top of the high ponytail and crown
  '......K4D4wA4DD4444K............', //  6  glossy scrunchie / sheen on the crown
  '.....K4D44AA4D444444K...........', //  7
  '....K44D4K4412222244K.....K.....', //  8  hair pulled back off the forehead / stopwatch crown
  '....K4D44K4223323324K....KMK....', //  9  brows
  '...K44D44K422wK2wK24K....KKK....', // 10  eyes with catchlights
  '...K4D444K4122K22K24K..WKwWWK...', // 11  wavy ponytail / lanyard / stopwatch gloss
  '....K44D4KK11222132K..W.KWKaK...', // 12  nose / dial and LED
  '....K4D44KK22133322K..W.KWWMK...', // 13  mouth
  '.....K44DK.K322223K..W..KKKK....', // 14  jaw
  '.....K44K...K3223K...W.K1122K...', // 15  neck / hand under the stopwatch
  '......KKKKKKAhhhhAKKKKKK1223K...', // 16  shoulders, haze tee at the collar
  '.......KIAAAAWhhWAAAAAAKK23K....', // 17  half-zip track jacket
  '......KwAAAAAAWWAAAAKAAKKHHK....', // 18  zip pull / peach wristband
  '.....KwAAKKAAAAWAAANKAAKAwAK....', // 19  one white stripe down each sleeve
  '....KwAAK.KAAAAWAAANKAAKAwAK....', // 20  elbow out, daylight between arm and waist
  '...KwAAK..KAAAAMAAANKAAKAwAK....', // 21  zip stops halfway
  '...KwAAK..KAAAAAAAANKAAKAwAK....', // 22
  '....KwAAK.KAAAAAAAANKAAAAAAK....', // 23
  '.....KwAAKKAAAAAAAANKKKKKKK.....', // 24
  '......KwAAKAAAAAAAANK...........', // 25
  '.......K122KAAAAAAANK...........', // 26  hand on her hip
  '.......K223KAAAAAAANK...........', // 27
  '........KKKNNNNNNNNNK...........', // 28  ribbed hem
  '..........KwNNNNNNNwK...........', // 29  track pants, one white side stripe
  '..........KwNNNNNNNwK...........', // 30
  '..........KwNNNNNNNwK...........', // 31
  '..........KwNNNNNNNwK...........', // 32
  '..........KwNNNKNNNwK...........', // 33
  '..........KwNNNKNNNwK...........', // 34
  '..........KwNNNKNNNwK...........', // 35
  '..........KwNNNKNNNwK...........', // 36
  '..........KwNNNKNNNwK...........', // 37
  '..........KwNNNKNNNwK...........', // 38
  '..........KwNNNKNNNwK...........', // 39
  '..........KwNNNKNNNwK...........', // 40
  '.........KwNNNNKNNNNwK..........', // 41
  '.........KwNNNNKNNNNwK..........', // 42
  '.........KwcwcwKwcwcwK..........', // 43  running sneakers, laces
  '........KwwwwwHKwwwwwHK.........', // 44  peach toe caps
  '........KccccccKccccccK.........', // 45
  '........KMMMMMMKMMMMMMK.........', // 46
  '.........KKKKKK.KKKKKK..........', // 47
];
