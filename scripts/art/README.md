# HypeMan art sources

The pixel matrices and scene drawing routines are maintained in `scripts/art/`. The wallpaper uses these drawing routines with the animation controller in `apps/extension/src/art/wallpaper.ts`. Run `node scripts/export-y2k-art.mjs` to render transparent props, rooftop layers, and the character animation atlas into `apps/extension/public/assets/y2k/`; matching demo artwork is exported into `apps/gateway/public/demo/assets/y2k/`.

The exporter renders HYPEMAN graffiti, an LCD jumbotron, city layers, clouds, a blimp, CRT, pigeons, boombox, and the character palette. Animation frames use whole-pixel articulation and hard alpha. Scene export uses local Press Start 2P and VT323 font files. Press Start 2P is the unmodified Google Fonts release by CodeMan38 / The Press Start 2P Project Authors under SIL Open Font License 1.1; its license is packaged alongside the font as `apps/extension/public/assets/fonts/OFL-PressStart2P.txt`. The font comes from the [official Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/pressstart2p); runtime never fetches fonts remotely.

Generated PNGs ship directly, so normal builds do not require a browser or art regeneration. Preserve the artwork ownership and applicable notices.
