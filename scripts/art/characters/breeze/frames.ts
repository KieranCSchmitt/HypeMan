/**
 * Breeze sprite frames.
 *
 * Same rules as HypeMan's frames: every frame is a 32x48 matrix, one
 * character per pixel, each a key from ./palette.ts ('.' is transparent,
 * 'a' marks the LED on his headphone ear cup, lit green while the mic is live).
 * His feet stand on the same baseline row as HypeMan's.
 *
 *   K outline        4 hair           p sky pale       I ice
 *   1 skin light     5 hair highlight B sky mid        C cyber cyan
 *   2 skin mid       w gloss white    A water teal     h haze
 *   3 skin shadow    c cloud shade    O boot wheat     D chrome dark
 *   o boot shadow    Y sun glow       M chrome mid     W chrome light
 *   a headphone LED  . transparent
 *
 * A 44px figure with a broad, solid build, facing the viewer in the same
 * 3/4 view as HypeMan. His jaw row is one pixel squarer than the shared
 * template; that follows his build.
 * The face (eyes, catchlights, nose, mouth) is the shared template, six
 * rows from the brow down.
 */
import type { Frame } from '../../hypeman/frames';

/**
 * idle 0: water bottle held up in one hand, the other arm loose at his
 * side, headphones resting around his neck.
 */
// prettier-ignore
export const IDLE_0: Frame = [
  //         1111111111222222222233
  //1234567890123456789012345678901
  '................................', //  0
  '................................', //  1
  '................................', //  2
  '................................', //  3
  '..........KKK.KKK.KK............', //  4  loose curls: a scalloped top
  '.........K454K454K54K...........', //  5  each curl catches the light on its upper left
  '........K454454445444K..........', //  6  the curls spread wider than the short sides
  '........K445444544454K...KKK....', //  7  second row of curls / bottle cap
  '.........K4441452244K...KwAAK...', //  8  curls falling onto the forehead
  '.........K4223323324K....KhK....', //  9  brows, short sides
  '.........K522wK2wK25K...KwhhK...', // 10  eyes with catchlights / clear bottle
  '..........K122K22K2K....KwhIK...', // 11
  '..........K11222132K....KIwIK...', // 12  nose / water line, drifting bubbles
  '..........K22133322K....KIIpK...', // 13  mouth
  '........KKK32222223KKK..KwIpK...', // 14  jaw, clean-shaven / tops of the ear cups
  '.......KwIIKK3223KKwIIKK1212K...', // 15  ice headphones around his neck / hand on the bottle
  '....KKKKIICKpwwwwpKIaCKK2123K...', // 16  shoulders, camp collar / LED on the ear cup
  '...KppppCCCKpwwwwpKCCCppK122K...', // 17
  '...KhppKKKKppwwwwppKKKKpK122K...', // 18  shirt worn open over a white tee
  '...KhppKpppppwwwwppppBKpK123K...', // 19
  '...KAApKAAppAwwwwAppAAKpK123K...', // 20  wave print
  '...KppAKppAApwwwwpAAppKBK123K...', // 21
  '...K123KpppppwwwwppppBKKK223K...', // 22  short sleeves end, forearms bare
  '...K123KpppppwwwwppppBK..KKK....', // 23
  '...K123KAAppAwwwwAppAAK.........', // 24  wave print
  '...K123KppAApwwwwpAAppK.........', // 25
  '...K123KpppppwwwwppppBK.........', // 26
  '...K123KpppppwwwwppppBK.........', // 27
  '...K122KAAppAwwwwAppAAK.........', // 28  hand
  '...K223KppAApwwwwpAAppK.........', // 29
  '....KKKKBBBBBccccBBBBBK.........', // 30  shirt and tee hems
  '.......KYOOOOOOOOOOOOoK.........', // 31  wide carpenter pants
  '.......KYOOOOOOOOOOOOoK.........', // 32
  '.......KYOOOOOOOOOOOooK.........', // 33
  '.......KYOOOOOOKOOOOOoK.........', // 34
  '.......KYOOOOOOKOOoooOK.........', // 35  tool pocket
  '.......KYOOOOOOKOOoOoOK.........', // 36
  '.......KYOOOOOOKOOoooOK.........', // 37
  '.......KYOOOOOOKOOOOOoK.........', // 38
  '.......KYoooooOKOooooOK.........', // 39  double-knee seam
  '.......KYOOOOOOKOOOOOoK.........', // 40
  '.......KYOOOOOOKOOOOOoK.........', // 41
  '......KYOOOOOOOKOOOOOOoK........', // 42  wide hems
  '......KooooooooKoooooooK........', // 43
  '......KKMDDDDDDKMDDDDDDK........', // 44  slip-on skate shoes
  '.......KWWWWWWWKWWWWWWWK........', // 45
  '.......KMMMMMMMKMMMMMMMK........', // 46
  '........KKKKKKK.KKKKKKK.........', // 47
];
