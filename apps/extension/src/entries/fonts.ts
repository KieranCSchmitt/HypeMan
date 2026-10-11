/** Shadow-root styles cannot register fonts in Chrome. Load the packaged bytes locally. */
export function loadCompanionFonts(): void {
  for (const [family, file] of [
    ["Press Start 2P", "PressStart2P.ttf"],
    ["Tiny5", "Tiny5.ttf"],
  ]) {
    void fetch(chrome.runtime.getURL(`assets/fonts/${file}`))
      .then((response) => {
        if (!response.ok) throw new Error("Font unavailable");
        return response.arrayBuffer();
      })
      .then((bytes) => new FontFace(family, bytes).load())
      .then((face) => document.fonts.add(face))
      .catch(() => {
        // System fallbacks keep the companion usable if a page prevents local font loading.
      });
  }
}

let boardFonts: Promise<void> | undefined;
/** KaTeX also needs document-registered fonts when its CSS lives in the page overlay's shadow root. */
export function loadBoardFonts(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts || !globalThis.chrome?.runtime?.getURL) return Promise.resolve();
  const families: Array<[string, string[]]> = [
    ["AMS", ["Regular"]], ["Caligraphic", ["Regular", "Bold"]], ["Fraktur", ["Regular", "Bold"]],
    ["Main", ["Regular", "Italic", "Bold", "BoldItalic"]], ["Math", ["Italic", "BoldItalic"]],
    ["SansSerif", ["Regular", "Italic", "Bold"]], ["Script", ["Regular"]],
    ["Size1", ["Regular"]], ["Size2", ["Regular"]], ["Size3", ["Regular"]], ["Size4", ["Regular"]], ["Typewriter", ["Regular"]],
  ];
  return boardFonts ??= Promise.all(families.flatMap(([family, variants]) => variants.map(async (variant) => {
    try {
      const response = await fetch(chrome.runtime.getURL(`fonts/KaTeX_${family}-${variant}.woff2`));
      if (!response.ok) return;
      const face = await new FontFace(`KaTeX_${family}`, await response.arrayBuffer(), {
        style: variant.includes("Italic") ? "italic" : "normal", weight: variant.includes("Bold") ? "700" : "400",
      }).load();
      document.fonts.add(face);
    } catch { /* Keep plain text and system fallback usable if local font loading is blocked. */ }
  }))).then(() => {});
}
