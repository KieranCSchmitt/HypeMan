import { useRef, useState, type PointerEvent } from "react";
import { request } from "../bridge";
export function ScreenRegion({ onImage, onError }: { onImage: (image: string) => void; onError: (error: Error) => void }) {
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null), pending = useRef(false);
  const down = (event: PointerEvent<HTMLDivElement>) => { if (pending.current) return; start.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); setBox({ ...start.current, width: 0, height: 0 }); };
  const move = (event: PointerEvent<HTMLDivElement>) => { const point = start.current; if (point) setBox({ x: Math.min(point.x, event.clientX), y: Math.min(point.y, event.clientY), width: Math.abs(event.clientX - point.x), height: Math.abs(event.clientY - point.y) }); };
  const capture = async (event: PointerEvent<HTMLDivElement>) => {
    const point = start.current; start.current = null; if (!point || pending.current) return;
    const region = { x: Math.min(point.x, event.clientX), y: Math.min(point.y, event.clientY), width: Math.abs(event.clientX - point.x), height: Math.abs(event.clientY - point.y) };
    if (region.width < 5 || region.height < 5) return;
    pending.current = true;
    const overlay = event.currentTarget, host = document.getElementById("hypeman-companion-v2"), previous = host?.style.visibility;
    const controller = new AbortController(), cancel = () => controller.abort(); window.addEventListener("hypeman.cancel-tools", cancel);
    overlay.style.visibility = "hidden"; if (host) host.style.visibility = "hidden";
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      controller.signal.throwIfAborted();
      const { image } = await request<{ image: string }>({ type: "screenshot" }, controller.signal);
      const source = await createImageBitmap(await (await fetch(image)).blob());
      controller.signal.throwIfAborted();
      const ratio = source.width / innerWidth, width = region.width * ratio, height = region.height * ratio, scale = Math.min(1, 1200 / Math.max(width, height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      canvas.getContext("2d")!.drawImage(source, region.x * ratio, region.y * ratio, width, height, 0, 0, canvas.width, canvas.height); source.close();
      onImage(canvas.toDataURL("image/jpeg", 0.8));
    } catch (reason) { onError(reason instanceof Error ? reason : new Error(String(reason))); }
    finally { if (host) host.style.visibility = previous || ""; overlay.style.visibility = ""; window.removeEventListener("hypeman.cancel-tools", cancel); pending.current = false; }
  };
  return <div className="screen-region-selection" aria-label="Select screen region" onPointerDown={down} onPointerMove={move} onPointerUp={(event) => void capture(event)} onPointerCancel={() => { start.current = null; setBox(null); }}>
    <p>Drag over the screen to attach an image. Escape cancels.</p>{box && <div className="screen-region-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}
  </div>;
}
