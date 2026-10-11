/** Shadow-root styles cannot register fonts in Chrome. Load the packaged bytes locally. */
export function loadCompanionFonts(): void {
  for (const [family, file] of [
    ["Press Start 2P", "PressStart2P.ttf"],
    ["VT323", "VT323.ttf"],
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
