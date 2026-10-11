export function bindOverlayFrame() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const query = new URLSearchParams(location.search);
      parent.postMessage({ type: "hypeman.escape", channel: query.get("channel"), conversationId: query.get("conversationId") }, "*");
    }
  });
}
