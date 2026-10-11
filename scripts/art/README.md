# HypeMan art sources

The pixel matrices and scene drawing routines are maintained in `scripts/art/`. The wallpaper uses these drawing routines with the animation controller in `apps/extension/src/art/wallpaper.ts`. Run `node scripts/export-y2k-art.mjs` to render transparent props, rooftop layers, and the character animation atlas into `apps/extension/public/assets/y2k/`.

The exporter renders HYPEMAN graffiti, an LCD jumbotron, city layers, clouds, a blimp, CRT, pigeons, boombox, and the character palette. Animation frames use whole-pixel articulation and hard alpha. Scene export uses locally packaged Press Start 2P and Tiny5. Both are distributed under the SIL Open Font License 1.1, with their notices alongside the font files. Press Start 2P is by CodeMan38 / The Press Start 2P Project Authors; Tiny5 is by Stefan Schmidt / The Tiny5 Project Authors. The fonts come from the official Google Fonts repository: [Press Start 2P](https://github.com/google/fonts/tree/main/ofl/pressstart2p) and [Tiny5](https://github.com/google/fonts/tree/main/ofl/tiny5). Runtime never fetches fonts remotely.

Generated PNGs ship directly, so normal builds do not require a browser or art regeneration. Preserve the artwork ownership and applicable notices.
