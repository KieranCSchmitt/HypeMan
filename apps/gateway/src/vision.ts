import { GatewayError } from "./errors";
import { isNumber, isObject, isText, stringList, type JsonObject } from "./media";
import { Providers } from "./providers";
import type { GatewayConfig } from "./config";

const box = (value: unknown) =>
  isObject(value) &&
  ["x", "y", "width", "height"].every((key) => isNumber(value[key], 0, 1)) &&
  Number(value.x) + Number(value.width) <= 1.01 &&
  Number(value.y) + Number(value.height) <= 1.01;
export async function vision(
  path: string,
  input: JsonObject,
  providers: Providers,
  config: GatewayConfig,
  signal: AbortSignal,
) {
  if (path === "/api/character") {
    if (config.demo)
      return {
        name: String(input.description || "Pixel sidekick").slice(0, 40),
        palette: ["#00e5ff", "#ff5fd2", "#7b5cff", "#f5f7ff", "#1b1f3b"],
        description: "Labeled demo palette; no image recognition performed.",
        provider: "demo",
      };
    const raw = await providers.json(
      'Inspect the uploaded character drawing. Return JSON {"name":string,"palette":["#rrggbb"],"description":string}. Choose 4–8 contrasting colors for a tiny pixel sprite. Respect the user description. Do not pretend to have generated an image; this endpoint suggests a palette and character name only.',
      { description: input.description || "" },
      signal,
      String(input.image),
    );
    if (
      !isText(raw.name, 80) ||
      !isText(raw.description, 2000) ||
      !Array.isArray(raw.palette) ||
      raw.palette.length < 2 ||
      raw.palette.length > 10 ||
      !raw.palette.every((color) => typeof color === "string" && /^#[a-f0-9]{6}$/i.test(color))
    )
      throw new GatewayError(
        502,
        "Character service returned invalid colors. Your character was not changed.",
      );
    return { ...raw, provider: providers.provider };
  }
  if (path === "/api/notebook") {
    if (config.demo)
      return {
        lines: [
          { text: "3x + 5 = 20", box: { x: 0.15, y: 0.2, width: 0.55, height: 0.1 } },
          { text: "3x = 25", box: { x: 0.15, y: 0.4, width: 0.4, height: 0.1 } },
        ],
        uncertain: false,
        provider: "demo",
        source: "Scripted notebook fixture; not camera transcription",
      };
    const raw = await providers.vision(
      'Transcribe only the handwriting visible in the last image. Never complete, correct, or infer covered writing. Return JSON {"lines":[{"text":string,"box":{"x":number,"y":number,"width":number,"height":number}}],"uncertain":boolean}. Boxes are fractions 0..1 of the frame. Preserve mistakes and incomplete lines. Blank, unreadable, or covered handwriting means lines empty and uncertain true. The previous lines are a stability hint, never evidence of current content.',
      { previousLines: input.previousLines || [] },
      String(input.image),
      signal,
    );
    if (
      !Array.isArray(raw.lines) ||
      raw.lines.length > 60 ||
      !raw.lines.every((line) => isObject(line) && isText(line.text, 1000) && box(line.box)) ||
      typeof raw.uncertain !== "boolean"
    )
      throw new GatewayError(
        502,
        "Notebook vision returned invalid data. Nothing was transcribed.",
      );
    return { lines: raw.lines, uncertain: raw.uncertain, provider: providers.provider };
  }
  if (config.demo)
    return {
      lines: ["3x + 5 = 20", "3x = 25"],
      status: "off",
      line: 2,
      box: { x: 0.15, y: 0.4, width: 0.4, height: 0.1 },
      hint: "Demo hint: check the sign when moving the five.",
      note: ["A similar move:", "2y + 4 = 12", "Subtract 4 from both sides"],
      provider: "demo",
      source: "Scripted tablet fixture; not handwriting analysis",
    };
  const raw = await providers.vision(
    'The last image is handwritten working; optional earlier image is the task. Return JSON {"lines":[string],"status":"ok"|"off"|"unclear","line":number|null,"box":{"x":number,"y":number,"width":number,"height":number}|null,"hint":string,"note":[string]}. Read actual ink exactly. Diagnose off only for a specific confidently readable error. Messy, slow or unfinished is not wrong. Unreadable means unclear. Boxes are fractions 0..1. Give one Socratic hint with detail appropriate to rung (1 question, 2 identify issue, 3 analogous move); never the answer or corrected line. A chalk note uses at most 4 short lines and different numbers from the task; omit when uncertain. Previous lines are hints, never evidence.',
    { previousLines: input.previousLines || [], rung: input.rung || 1 },
    String(input.image),
    signal,
    input.context as string | undefined,
  );
  if (
    !stringList(raw.lines, 60) ||
    !["ok", "off", "unclear"].includes(String(raw.status)) ||
    !(raw.line === null || isNumber(raw.line, 1, 60)) ||
    !(raw.box === null || box(raw.box)) ||
    !isText(raw.hint, 2000) ||
    !stringList(raw.note, 6)
  )
    throw new GatewayError(502, "Tablet vision returned invalid data. No judgement was made.");
  // Uncertain OCR cannot accuse the user of an error or supply a fabricated annotation.
  return {
    ...raw,
    ...(raw.status === "unclear" ? { line: null, box: null, note: [] } : {}),
    provider: providers.provider,
  };
}
