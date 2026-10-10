export function bindOverlayFrame() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") parent.postMessage({ type: "hypeman.close-overlay" }, "*");
  });
}
