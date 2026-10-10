import type { Rect } from "@core";
/** One visual affordance, owned by this tab and excluded from page understanding. */
export class Highlight {
  private marker: HTMLDivElement;
  private target: Element | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private removers: Array<() => void> = [];
  constructor(shadow: ShadowRoot) {
    this.marker = document.createElement("div");
    this.marker.setAttribute("aria-hidden", "true");
    this.marker.dataset.burrowHighlight = "true";
    this.marker.style.cssText =
      "display:none;position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #00e5ff;border-radius:2px;box-shadow:0 0 0 2px #0a0a12,0 0 0 4px #ff5fd266,0 0 20px #00e5ff66;box-sizing:border-box;";
    shadow.append(this.marker);
    const update = () => {
      if (this.target?.isConnected) this.draw(this.target.getBoundingClientRect());
      else this.clear();
    };
    for (const event of ["scroll", "resize"]) {
      window.addEventListener(event, update, true);
      this.removers.push(() => window.removeEventListener(event, update, true));
    }
  }
  private draw(rect: Rect): void {
    Object.assign(this.marker.style, {
      display: "block",
      left: `${Math.max(0, rect.x - 4)}px`,
      top: `${Math.max(0, rect.y - 4)}px`,
      width: `${rect.width + 8}px`,
      height: `${rect.height + 8}px`,
    });
  }
  show(element: Element, ms = 5000): void {
    this.clear();
    this.target = element;
    this.draw(element.getBoundingClientRect());
    this.timer = setTimeout(() => this.clear(), ms);
  }
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.target = null;
    this.marker.style.display = "none";
  }
  dispose(): void {
    this.clear();
    for (const remove of this.removers.splice(0)) remove();
    this.marker.remove();
  }
}
