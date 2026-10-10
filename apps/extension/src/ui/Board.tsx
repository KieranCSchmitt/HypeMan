import { useEffect, useRef, useState, type PointerEvent } from "react";
import { request } from "../bridge";
import { Notice } from "./common";
import { Icon } from "./Icon";
import { ToolHeader, WindowBar } from "./ToolChrome";
import { message } from "./hooks";
import { ArtSprite } from "./ArtSprite";

interface InkReply {
  lines: string[];
  status: "ok" | "off" | "unclear";
  line: number | null;
  hint: string;
  note: string[];
  provider: string;
}
type Stroke =
  | { kind: "clear" }
  | { kind: "stroke"; color: string; size: number; points: { x: number; y: number }[] };
export function Board({ embedded = false, active = true }: { embedded?: boolean; active?: boolean } = {}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<Extract<Stroke, { kind: "stroke" }> | null>(null);
  const history = useRef<Stroke[]>([]);
  const future = useRef<Stroke[]>([]);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#1b1f3b");
  const [size, setSize] = useState(3);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<InkReply | null>(null);
  const [error, setError] = useState("");
  const [goal, setGoal] = useState("");
  const [coaching, setCoaching] = useState(false);
  const [, update] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const drawStroke = (stroke: Stroke) => {
    const c = canvas.current!,
      ctx = c.getContext("2d")!;
    if (stroke.kind === "clear") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      return;
    }
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
    }
    ctx.stroke();
  };
  const repaint = () => {
    drawStroke({ kind: "clear" });
    history.current.forEach(drawStroke);
    update((n) => n + 1);
  };
  useEffect(() => {
    drawStroke({ kind: "clear" });
    return () => controller.current?.abort();
  }, []);
  useEffect(() => { if (!active) controller.current?.abort(); }, [active]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const c = event.currentTarget,
      box = c.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * c.width) / box.width,
      y: ((event.clientY - box.top) * c.height) / box.height,
    };
  };
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = {
      kind: "stroke",
      color: tool === "eraser" ? "#ffffff" : color,
      size: tool === "eraser" ? size * 6 : size,
      points: [point(event)],
    };
    drawStroke(current.current);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current;
    if (!stroke) return;
    const p = point(event),
      previous = stroke.points.at(-1)!;
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    stroke.points.push(p);
    if (stroke.points.length > 8192)
      stroke.points = stroke.points.filter((_, i, all) => i % 2 === 0 || i === all.length - 1);
  };
  const remember = (stroke: Stroke) => {
    history.current.push(stroke);
    future.current = [];
    update((n) => n + 1);
  };
  const up = () => {
    if (current.current) {
      remember(current.current);
      current.current = null;
    }
  };
  const undo = () => {
    const last = history.current.pop();
    if (last) {
      future.current.push(last);
      repaint();
    }
  };
  const redo = () => {
    const next = future.current.pop();
    if (next) {
      history.current.push(next);
      drawStroke(next);
      update((n) => n + 1);
    }
  };
  const clear = () => {
    const command: Stroke = { kind: "clear" };
    drawStroke(command);
    remember(command);
    setReply(null);
  };
  const check = async () => {
    setBusy(true);
    setError("");
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      setReply(
        await request<InkReply>(
          {
            type: "api",
            path: "/api/ink",
            body: {
              image: canvas.current!.toDataURL("image/png"),
              previousLines: reply?.lines || [],
              rung: 1,
              goal,
            },
          },
          controller.current.signal,
        ),
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = canvas.current!.toDataURL("image/png");
    a.download = "hypeman-drawing.png";
    a.click();
  };
  return (
    <div className={`tool-page studio board-studio ${embedded ? "embedded-studio" : ""} ${coaching ? "show-coach" : ""}`}>
      {!embedded && <ToolHeader title="Ink studio" icon="sketch">
        <button
          className="icon-button"
          title="Notebook camera"
          aria-label="Use a paper notebook"
          onClick={() => void request({ type: "notebook.open" }).catch((e) => setError(message(e)))}
        >
          <Icon name="camera" />
        </button>
      </ToolHeader>}
      <main className="tool-main board-main">
        <div className="studio-heading">
          <div>
            <span className="eyebrow">CREATE / 01</span>
            <h1>Think in ink.</h1>
          </div>
          <span className="studio-keyhint">PEN · TOUCH · MOUSE</span>
        </div>
        <div className="board-layout">
          <section className="drawing-surface studio-window">
            <WindowBar title="Untitled.canvas" icon="sketch" />
            <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
              {embedded && <button className="icon-button" aria-label="Ask about this drawing" title="Ask about this drawing" aria-expanded={coaching} onClick={() => setCoaching(!coaching)}><Icon name="spark" /></button>}
              <div className="tool-toggle">
                <button
                  className={tool === "pen" ? "selected" : ""}
                  aria-label="Pen"
                  title="Pen"
                  aria-pressed={tool === "pen"}
                  onClick={() => setTool("pen")}
                >
                  <Icon name="sketch" />
                </button>
                <button
                  className={tool === "eraser" ? "selected" : ""}
                  aria-label="Eraser"
                  title="Eraser"
                  aria-pressed={tool === "eraser"}
                  onClick={() => setTool("eraser")}
                >
                  <Icon name="eraser" />
                </button>
              </div>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Pen color"
                title="Pen color"
              />
              <label className="pen-size" title="Stroke size">
                <span className="sr-only">Size</span>
                <input
                  aria-label="Stroke size"
                  type="range"
                  min="1"
                  max="12"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
                <output>{size}</output>
              </label>
              <div className="row drawing-actions">
                <button
                  className="icon-button"
                  aria-label="Undo"
                  title="Undo"
                  disabled={!history.current.length}
                  onClick={undo}
                >
                  <Icon name="undo" />
                </button>
                <button
                  className="icon-button"
                  aria-label="Redo"
                  title="Redo"
                  disabled={!future.current.length}
                  onClick={redo}
                >
                  <Icon name="redo" />
                </button>
                <button
                  className="icon-button"
                  aria-label="Clear"
                  title="Clear canvas"
                  onClick={clear}
                >
                  <Icon name="trash" />
                </button>
                <button
                  className="icon-button"
                  aria-label="Save PNG"
                  title="Save PNG"
                  onClick={download}
                >
                  <Icon name="download" />
                </button>
              </div>
            </div>
            <canvas
              ref={canvas}
              width="1200"
              height="850"
              className="drawing-canvas"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              aria-label="Drawing board. Use a mouse, touch, or stylus to draw."
            />
            <div className="canvas-status">
              <span>
                <i />
                LOCAL CANVAS
              </span>
              <span>1200 × 850</span>
            </div>
          </section>
          <aside className="surface board-coach studio-window">
            <WindowBar title="Co-pilot" icon="spark" />
            <div className="studio-window-body">
              <div className="mini-orbit" aria-hidden="true">
                <ArtSprite name="bolt" width={45} />
              </div>
              <h2>Need a second look?</h2>
              <label className="field">
                <span className="sr-only">Goal or question</span>
                <textarea
                  rows={3}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="What are you working on?"
                  maxLength={2000}
                />
              </label>
              <div className="row">
                <button
                  className="button primary"
                  aria-label="Check my work"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  <Icon name="spark" />
                  {busy ? "Checking…" : "Check"}
                </button>
                {busy && (
                  <button
                    className="icon-button"
                    aria-label="Cancel"
                    title="Cancel"
                    onClick={() => controller.current?.abort()}
                  >
                    <Icon name="stop" />
                  </button>
                )}
              </div>
              <span
                className="studio-privacy"
                title="Only Check sends your drawing to your paired service. Unclear handwriting stays marked uncertain."
              >
                <Icon name="shield" />
                Sent only when you check
              </span>
              <Notice tone="error">{error}</Notice>
              {reply && (
                <div className="ink-feedback" aria-live="polite">
                  <span className={`status-pill ${reply.status === "ok" ? "completed" : "paused"}`}>
                    {reply.status === "ok"
                      ? "Looking good"
                      : reply.status === "unclear"
                        ? "Uncertain"
                        : "Try another step"}
                  </span>
                  <h3>{reply.hint || "Here’s what I read."}</h3>
                  {reply.lines.length > 0 && (
                    <details className="studio-details">
                      <summary>
                        Recognized lines <span>{reply.lines.length}</span>
                      </summary>
                      <ol>
                        {reply.lines.map((line, i) => (
                          <li key={i} className={i + 1 === reply.line ? "flagged" : ""}>
                            {line}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {reply.note?.map((note, i) => (
                    <p key={i}>{note}</p>
                  ))}
                  <small>
                    {reply.provider === "demo"
                      ? "Demonstration feedback"
                      : "Review recognition against your drawing."}
                  </small>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
