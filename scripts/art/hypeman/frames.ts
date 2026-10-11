/**
 * HypeMan sprite frames.
 *
 * Every frame is a 32x48 matrix: 48 strings of 32 characters, one character
 * per pixel. Each character is a key from palette.ts ('.' is transparent,
 * 'a' marks the flip phone's antenna tip). Edit the art right here, then run
 * `npm run sprites` to re-render the sheet and atlas.
 *
 *   K outline        J jersey black   d denim black    S skin light
 *   W chrome light   j mesh black     f denim fade     s skin mid
 *   M chrome mid     T thermal cream  O boot wheat     x skin shadow
 *   D chrome dark    t thermal shade  o boot shadow    w gloss white
 *   C cyber cyan     I ice            U sky deep       h haze
 *   a antenna tip    . transparent
 *
 * The key light is top-left: single gloss-white pixels sit on the upper-left
 * of anything shiny (cap, brim, chain, rings, phone, boot toes, eyes).
 *
 * He faces the viewer in 3/4 view, turned slightly to screen-right. "Left"
 * and "right" in the comments below are screen directions.
 */

export const FRAME_W = 32;
export const FRAME_H = 48;

export type Frame = readonly string[];

/**
 * idle 0, the base pose: left hand in the front pocket, right hand holding
 * the chrome flip phone up like a mirror selfie.
 */
// prettier-ignore
export const IDLE_0: Frame = [
  //         1111111111222222222233
  //1234567890123456789012345678901
  '................................', //  0
  '.............KKKKKKK............', //  1  cap crown, cocked up to the right
  '.........KKKKJJJJJJJK........K..', //  2
  '........KJJwjjJJJJJJK.......KaK.', //  3  gloss on the crown / antenna tip
  '........KJwjjJJJJJJJK.......KMK.', //  4
  '........KJjjJJJJJJJJKKK...KKKKK.', //  5
  '........KJJJJJJjwjjjjDDK.KwwwIK.', //  6  flat brim / flip phone: gloss band
  '........KwjjjjjKKKKKKKKK.KhUUCK.', //  7  phone's outer display
  '........KKKKKKKxxxxjK....KIUICK.', //  8  brow under the brim
  '.......KfKjxxxxssssfK....KCCCCK.', //  9  box braids start
  '.......KjKfsswKswKsjK.....KMMK..', // 10  eyes with catchlights / chrome hinge
  '.......KfKjSssKssKsfK....KwIICK.', // 11
  '.......KjKfSSsssSxsjK...KsSsSsK.', // 12  fingers around the phone
  '.......KfKjssSxxxssfK...KswsWxK.', // 13  mouth / rings
  '.......KjKfKxssssxKjK....KxssxK.', // 14  jaw
  '.......KfKjKKxssxKKfK.....KTTTK.', // 15  neck / thermal cuff
  '.....KKKKKfKKTTTTKKKKKKK..KTtTK.', // 16  shoulders, braid tips
  '....KDDDDDKJwJTTjMDDDDDDjKKTTTK.', // 17  shoulder sheen / chain
  '...KDjJjJjJjJMJjMjJjJjJjJjKtTtK.', // 18
  '...KjJjKjJjJjJwMjJjJjJKwwwKTTTK.', // 19  chain glint
  '...KwwwKJjwwwwwjwwwwwjKwJjKTtTK.', // 20  "25"
  '...KjJwKjJjJjJwJwJjJjJKIIIjJjJK.', // 21
  '...KwwwKJjJjJjwjwjJjJjKKJIJjJjK.', // 22
  '...KIJjKjJwwwwwJwwwwwJK.KKKKKK..', // 23  numerals: white above, ice below
  '...KIIIKJjIjJjJjJjJjIjK.........', // 24
  '...KKKKKjJIJjJjJjJjJIJK.........', // 25  jersey sleeve ends
  '...KTtTKJjIIIIIjIIIIIjK.........', // 26  thermal sleeve
  '...KTTTKjJjJjJjJjJjJjJK.........', // 27
  '....KtTtKjJjJjJjJjJjJjK.........', // 28
  '....KTTTKJjJjJjJjJjJjJK.........', // 29
  '.....KTtTKKKKKKKKKKKKKK.........', // 30  jersey hem
  '......KTTKddddddddddddK.........', // 31  low-slung waist
  '......KssKddddddddddddK.........', // 32  wrist into the pocket
  '......KKKKdfdfdddfdfddK.........', // 33  thigh fade
  '.....KddddfdfdddddfdfddK........', // 34
  '.....KdddfdfdfdddfdfdfdK........', // 35
  '.....KddddfdfdddddfdfddK........', // 36
  '....KdddfdfdddKdddfdfdddK.......', // 37  knee fade
  '....KddfdfdfddKddfdfdfddK.......', // 38
  '...KdKKKKdddddKdddddKKKKdK......', // 39  stacking
  '...KddfffdKKKdKdKKKdfffddK......', // 40
  '...KdKKKddfffdKdfffddKKKdK......', // 41
  '...KddKKKKKKKKKKKKKKKKKddK......', // 42  hem puddles over the boots
  '....KKOOoOoOOK.KOOoOoOOKK.......', // 43  boots
  '....KOwOOOOOoK.KOwOOOOOOoK......', // 44  gloss on the toes
  '....KooooooooK.KoooooooooK......', // 45  chunky sole
  '....KxxxxxxxxK.KxxxxxxxxxK......', // 46
  '.....KKKKKKKK...KKKKKKKKK.......', // 47
];
