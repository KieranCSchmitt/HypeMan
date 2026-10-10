import type {
  Action,
  AgentRequest,
  PageSnapshot,
  PageTarget,
  HistoryEntry,
  SketchShape,
} from "./contracts";
import { parseWorkspace, safePageUrl } from "./workspace";
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 4000): v is string => typeof v === "string" && v.length <= max;
const target = (v: unknown): v is string => text(v, 80) && v.length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !text(value.type, 40)) return null;
  const v = value;
  switch (v.type) {
    case "say":
      return text(v.text) ? { type: v.type, text: v.text } : null;
    case "finish":
      return text(v.summary) ? { type: v.type, summary: v.summary } : null;
    case "ask":
      return text(v.question) ? { type: v.type, question: v.question } : null;
    case "point":
      return target(v.target) && (v.quote === undefined || text(v.quote, 500))
        ? {
            type: v.type,
            target: v.target,
            ...(typeof v.quote === "string" ? { quote: v.quote } : {}),
          }
        : null;
    case "click":
      return target(v.target) && (v.trusted === undefined || typeof v.trusted === "boolean")
        ? {
            type: v.type,
            target: v.target,
            ...(typeof v.trusted === "boolean" ? { trusted: v.trusted } : {}),
          }
        : null;
    case "type":
      return target(v.target) && text(v.text, 8000)
        ? { type: v.type, target: v.target, text: v.text }
        : null;
    case "select":
      return target(v.target) && text(v.value, 1000)
        ? { type: v.type, target: v.target, value: v.value }
        : null;
    case "key":
      return text(v.key, 40) && (v.target === undefined || target(v.target))
        ? {
            type: v.type,
            key: v.key,
            ...(typeof v.target === "string" ? { target: v.target } : {}),
          }
        : null;
    case "scroll":
      return (v.target === undefined || target(v.target)) &&
        (v.amount === undefined || (finite(v.amount) && Math.abs(v.amount) <= 10000))
        ? {
            type: v.type,
            ...(typeof v.target === "string" ? { target: v.target } : {}),
            ...(finite(v.amount) ? { amount: v.amount } : {}),
          }
        : null;
    case "navigate":
      return safePageUrl(v.url) && (v.newTab === undefined || typeof v.newTab === "boolean")
        ? {
            type: v.type,
            url: safePageUrl(v.url),
            ...(typeof v.newTab === "boolean" ? { newTab: v.newTab } : {}),
          }
        : null;
    case "observe":
      return v.target === undefined || target(v.target)
        ? { type: v.type, ...(typeof v.target === "string" ? { target: v.target } : {}) }
        : null;
    case "back":
      return { type: v.type };
    case "switchTab":
      return finite(v.tabId) && Number.isInteger(v.tabId) && v.tabId >= 0
        ? { type: v.type, tabId: v.tabId }
        : null;
    case "wait":
      return finite(v.ms) && v.ms >= 0 && v.ms <= 5000 ? { type: v.type, ms: v.ms } : null;
    case "note":
      return text(v.text) && (v.excerpt === undefined || text(v.excerpt))
        ? {
            type: v.type,
            text: v.text,
            ...(typeof v.excerpt === "string" ? { excerpt: v.excerpt } : {}),
          }
        : null;
    case "plan":
      return text(v.goal, 2000) &&
        Array.isArray(v.steps) &&
        v.steps.length > 0 &&
        v.steps.length <= 20 &&
        v.steps.every((s) => text(s, 200))
        ? { type: v.type, goal: v.goal, steps: v.steps as string[] }
        : null;
    case "video":
      return ["play", "pause", "seek", "speed"].includes(String(v.command)) &&
        (v.value === undefined || (finite(v.value) && v.value >= 0 && v.value <= 86400))
        ? {
            type: v.type,
            command: v.command as "play",
            ...(finite(v.value) ? { value: v.value } : {}),
          }
        : null;
    case "pointer":
      return ["hover", "doubleClick", "rightClick", "drag"].includes(String(v.command)) &&
        target(v.target) &&
        (v.toTarget === undefined || target(v.toTarget))
        ? {
            type: v.type,
            command: v.command as "hover",
            target: v.target,
            ...(typeof v.toTarget === "string" ? { toTarget: v.toTarget } : {}),
          }
        : null;
    case "sketch": {
      if (
        !text(v.title, 200) ||
        !Array.isArray(v.lines) ||
        v.lines.length > 30 ||
        !v.lines.every((s) => text(s, 500))
      )
        return null;
      const shapes: SketchShape[] = [];
      if (v.shapes !== undefined) {
        if (!Array.isArray(v.shapes) || v.shapes.length > 100) return null;
        for (const shape of v.shapes) {
          if (
            !isRecord(shape) ||
            !finite(shape.x) ||
            !finite(shape.y) ||
            Math.abs(shape.x) > 1000 ||
            Math.abs(shape.y) > 1000
          )
            return null;
          if (
            (shape.type === "line" || shape.type === "arrow") &&
            finite(shape.toX) &&
            finite(shape.toY)
          )
            shapes.push({
              type: shape.type,
              x: shape.x,
              y: shape.y,
              toX: shape.toX,
              toY: shape.toY,
            });
          else if (
            shape.type === "circle" &&
            finite(shape.radius) &&
            shape.radius >= 0 &&
            shape.radius <= 1000
          )
            shapes.push({ type: "circle", x: shape.x, y: shape.y, radius: shape.radius });
          else if (shape.type === "label" && text(shape.text, 100))
            shapes.push({ type: "label", x: shape.x, y: shape.y, text: shape.text });
          else return null;
        }
      }
      return {
        type: "sketch",
        title: v.title,
        lines: v.lines as string[],
        ...(v.shapes !== undefined ? { shapes } : {}),
      };
    }
    default:
      return null;
  }
}
export function parseAgentRequest(value: unknown): AgentRequest | null {
  if (
    isRecord(value) &&
    value.screenshot !== undefined &&
    (typeof value.screenshot !== "string" ||
      value.screenshot.length > 2_000_000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.screenshot))
  )
    return null;
  if (
    !isRecord(value) ||
    !text(value.requestId, 160) ||
    !value.requestId ||
    !text(value.goal, 2000) ||
    !text(value.message, 4000) ||
    !isRecord(value.page) ||
    !Array.isArray(value.history) ||
    value.history.length > 40 ||
    !["browse", "learn"].includes(String(value.mode))
  )
    return null;
  const p = value.page;
  if (
    !text(p.url, 4096) ||
    !text(p.title, 500) ||
    !text(p.text, 30000) ||
    !Array.isArray(p.headings) ||
    p.headings.length > 100 ||
    !p.headings.every((x) => text(x, 500)) ||
    !Array.isArray(p.elements) ||
    p.elements.length > 200 ||
    !Array.isArray(p.errors) ||
    !Array.isArray(p.successes) ||
    !p.errors.every((x) => text(x, 1000)) ||
    !p.successes.every((x) => text(x, 1000)) ||
    !text(p.selection, 4000)
  )
    return null;
  const elements: PageTarget[] = [];
  for (const raw of p.elements) {
    if (
      !isRecord(raw) ||
      !target(raw.id) ||
      !text(raw.role, 80) ||
      !text(raw.name, 500) ||
      !text(raw.tag, 40) ||
      typeof raw.disabled !== "boolean" ||
      typeof raw.sensitive !== "boolean" ||
      !isRecord(raw.rect) ||
      ![raw.rect.x, raw.rect.y, raw.rect.width, raw.rect.height].every(finite)
    )
      return null;
    elements.push({
      id: raw.id,
      role: raw.role,
      name: raw.name,
      tag: raw.tag,
      disabled: raw.disabled,
      sensitive: raw.sensitive,
      rect: {
        x: Number(raw.rect.x),
        y: Number(raw.rect.y),
        width: Number(raw.rect.width),
        height: Number(raw.rect.height),
      },
      ...(!raw.sensitive && text(raw.value, 8000) ? { value: raw.value } : {}),
      ...(safePageUrl(raw.href) ? { href: safePageUrl(raw.href) } : {}),
    });
  }
  if (new Set(elements.map((e) => e.id)).size !== elements.length) return null;
  const history: HistoryEntry[] = [];
  for (const raw of value.history) {
    if (
      !isRecord(raw) ||
      !isRecord(raw.result) ||
      typeof raw.result.ok !== "boolean" ||
      typeof raw.result.changed !== "boolean" ||
      !text(raw.result.message, 2000) ||
      !finite(raw.at)
    )
      return null;
    const action = parseAction(raw.action);
    if (!action) return null;
    history.push({
      action,
      result: {
        ok: raw.result.ok,
        changed: raw.result.changed,
        message: raw.result.message,
        ...(safePageUrl(raw.result.url) ? { url: safePageUrl(raw.result.url) } : {}),
        ...(raw.result.navigation === true ? { navigation: true } : {}),
      },
      at: raw.at,
    });
  }
  const page: PageSnapshot = {
    url: p.url,
    title: p.title,
    text: p.text,
    headings: p.headings as string[],
    elements,
    errors: p.errors as string[],
    successes: p.successes as string[],
    selection: p.selection,
    frames: isRecord(p.frames)
      ? {
          count: finite(p.frames.count) ? p.frames.count : 0,
          inaccessible: finite(p.frames.inaccessible) ? p.frames.inaccessible : 0,
        }
      : { count: 0, inaccessible: 0 },
    capturedAt: finite(p.capturedAt) ? p.capturedAt : 0,
    revision: finite(p.revision) ? p.revision : 0,
  };
  // Video is validated by the dedicated endpoint; only safe context reaches the agent.
  if (
    isRecord(p.video) &&
    text(p.video.id, 100) &&
    text(p.video.title, 500) &&
    finite(p.video.time) &&
    finite(p.video.duration) &&
    finite(p.video.rate) &&
    typeof p.video.paused === "boolean"
  )
    page.video = {
      id: p.video.id,
      title: p.video.title,
      time: p.video.time,
      duration: p.video.duration,
      rate: p.video.rate,
      paused: p.video.paused,
    };
  if (page.video && isRecord(p.video)) {
    if (Array.isArray(p.video.segments))
      page.video.segments = p.video.segments
        .filter(isRecord)
        .filter(
          (s) =>
            finite(s.start) &&
            finite(s.end) &&
            s.start >= 0 &&
            s.end >= s.start &&
            text(s.text, 2000),
        )
        .slice(0, 300)
        .map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text) }));
    if (Array.isArray(p.video.chapters))
      page.video.chapters = p.video.chapters
        .filter(isRecord)
        .filter((c) => finite(c.start) && c.start >= 0 && text(c.title, 300))
        .slice(0, 100)
        .map((c) => ({ start: Number(c.start), title: String(c.title) }));
  }
  const task = value.task
    ? parseWorkspace({
        version: 1,
        tasks: [value.task],
        notes: [],
        events: [],
        activeTaskId: isRecord(value.task) ? value.task.id : null,
      }).tasks[0]
    : null;
  return {
    requestId: value.requestId,
    goal: value.goal,
    message: value.message,
    page,
    history,
    mode: value.mode as "browse" | "learn",
    task: task ?? null,
    ...(typeof value.screenshot === "string" ? { screenshot: value.screenshot } : {}),
  };
}
