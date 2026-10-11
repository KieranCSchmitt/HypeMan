export interface WindowRect { x: number; y: number; width: number; height: number }
export interface WindowViewport { x: number; y: number; width: number; height: number }
let windowLayer = 50;
export const nextWindowLayer = () => ++windowLayer;
export function windowViewport(): WindowViewport {
  const viewport = window.visualViewport;
  return { x: viewport?.offsetLeft || 0, y: viewport?.offsetTop || 0,
    width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
}
const margin = (viewport: WindowViewport) => Math.min(12, viewport.width / 4, viewport.height / 4);
const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
export function clampWindow(rect: WindowRect, viewport: WindowViewport): WindowRect {
  const inset = margin(viewport), maxWidth = Math.max(1, viewport.width - inset * 2), maxHeight = Math.max(1, viewport.height - inset * 2);
  const width = bound(rect.width, Math.min(320, maxWidth), maxWidth), height = bound(rect.height, Math.min(220, maxHeight), maxHeight);
  return { width, height, x: bound(rect.x, viewport.x + inset, viewport.x + viewport.width - inset - width),
    y: bound(rect.y, viewport.y + inset, viewport.y + viewport.height - inset - height) };
}
export function initialWindow(tool: string, viewport: WindowViewport, chat?: { left: number }, cascade = 0): WindowRect {
  const width = tool === "board" ? 860 : tool === "documents" ? 780 : tool === "video" ? 760 : 500;
  const height = tool === "documents" ? 700 : ["board", "phone"].includes(tool) ? 640 : tool === "video" ? 610 : 560;
  const size = clampWindow({ x: viewport.x, y: viewport.y, width, height }, viewport), step = cascade % 5 * 22;
  const beside = chat && chat.left - size.width - 18 >= viewport.x + margin(viewport);
  return clampWindow({ ...size, x: beside ? chat.left - size.width - 18 - step : viewport.x + (viewport.width - size.width) / 2 + step,
    y: viewport.y + (viewport.height - size.height) / 2 + step }, viewport);
}
export function resizeWindow(rect: WindowRect, width: number, height: number, viewport: WindowViewport): WindowRect {
  const current = clampWindow(rect, viewport), inset = margin(viewport);
  return clampWindow({ ...current, width: Math.min(width, viewport.x + viewport.width - inset - current.x),
    height: Math.min(height, viewport.y + viewport.height - inset - current.y) }, viewport);
}
