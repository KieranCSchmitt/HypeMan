# Attribution

HypeMan is a fresh rewrite based on the browser companion concept of [jerryjlwang/Burrow](https://github.com/jerryjlwang/Burrow), pinned to [commit 516ff4958cc0d496e604d6806df840c65b78677b](https://github.com/jerryjlwang/Burrow/tree/516ff4958cc0d496e604d6806df840c65b78677b).

Application source for this release has been rewritten: extension runtime/presentation, background orchestration, local gateway, shared contracts, build scripts, and tests. Original application source is not shipped as a patched fork.

Retained original materials in source include:

- Rabbit sprite sheets and asset metadata in `apps/extension/public/assets/characters/rabbit/`.
- Meadow/scene artwork, interface artwork, icons, and metadata in `apps/extension/public/assets/`.
- The demonstration clip at `apps/gateway/public/demo/media/lesson.webm`.
- Pixelify Sans and VT323 font files and original license notices.

Legacy rabbit sprites, meadow/interface artwork, and Pixelify Sans are excluded from the extension build. The active interface uses the supplied HypeMan artwork, Press Start 2P, and VT323; the demonstration clip is retained.

Credit remains with the original Burrow contributors and the respective font authors. This attribution does not assign ownership or create a new license for retained materials. Preserve applicable original notices when redistributing them.

## Fonts

- **Pixelify Sans (legacy, source only):** Copyright 2021 The Pixelify Sans Project Authors. SIL Open Font License 1.1. [Retained license](apps/extension/public/assets/fonts/OFL-PixelifySans.txt).
- **VT323:** Copyright 2011 The VT323 Project Authors. SIL Open Font License 1.1. [Retained license](apps/extension/public/assets/fonts/OFL-VT323.txt).

- **Press Start 2P:** Copyright 2012 The Press Start 2P Project Authors (CodeMan38). SIL Open Font License 1.1. [Retained license](apps/extension/public/assets/fonts/OFL-PressStart2P.txt). Included from the [official Google Fonts source](https://github.com/google/fonts/tree/main/ofl/pressstart2p).

Full font licenses remain beside the font files. The active Press Start 2P and VT323 fonts and their notices are copied into the unpacked extension build and self-hosted in `apps/gateway/public/fonts/` for local demo, notebook, and sign-in screens.

## Y2K artwork

The active Y2K identity uses the updated artwork supplied by the user in `HypeMan-2`: the pixel avatar, rooftop skyline, CRT, boombox, graffiti, blimp, pigeons, and other scene parts. The art sources have been adapted into a reproducible build-time exporter in `scripts/art/`, preserving the supplied HYPEMAN graffiti and LCD clock, with additional animation poses derived from the supplied avatar. A new silent wallpaper controller uses those drawing routines for live animation and interaction. Transparent prop PNGs, four time-of-day scenes, and the animation atlas are packaged in `apps/extension/public/assets/y2k/`. The original Burrow artwork remains available in source as attributed legacy material and is excluded from the extension build.

Only the supplied art definitions are reused; HypeMan application, orchestration, and audio code are not bundled. See [art provenance and export instructions](scripts/art/README.md).

## Portrait

The paste-up that appears under the graffiti (`PORTRAIT` in `scripts/art/scene/sprites.ts`) is a 23×28 conversion of a photo supplied by the user, matched to the scene palette. Preserve the user's ownership and any applicable notices.

## Music

The boombox loop at `apps/extension/public/assets/audio/boombox.flac` was supplied by the user and is packaged unmodified. Preserve the user's ownership and any applicable notices.
