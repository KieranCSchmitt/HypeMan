import { boardObjectBounds, moveBoardObject, type BoardObject } from "../../../../packages/core/src/board";

/** Prose containing an equals sign is still prose, rather than an entire TeX equation. */
export function isBoardEquation(text: string): boolean {
  if (/^\s*(?:\$|\\\(|\\\[)/.test(text)) return true;
  const variables = text.replace(/\\(?:text|operatorname|mathrm|begin|end)\{[^}]*\}/g, "").replace(/\\[a-zA-Z]+/g, "").replace(/\b(?:sin|cos|tan|log|lim|max|min|det|mod)\b/g, "");
  return !/[a-zA-Z]{3,}/.test(variables) && /(?:[=<>+\-*/×÷−^_]|\\[a-zA-Z]+|\b(?:sin|cos|tan|log|lim|max|min|det|mod)\b|\b[a-zA-Z]\(|\d+[a-zA-Z]|^\s*[a-zA-Z0-9]\s*$)/.test(text);
}

/** New assistant labels must not cover other text; diagram geometry keeps its relative positions. */
export function placeBoardLabels(objects: BoardObject[], existing: BoardObject[] = []): BoardObject[] {
  const occupied = existing.filter(object => object.kind === "text" || object.kind === "equation").map(boardObjectBounds);
  return objects.map(object => {
    if (object.kind !== "text" && object.kind !== "equation") return object;
    let placed = object;
    for (let attempt = 0; attempt <= occupied.length; attempt++) {
      const box = boardObjectBounds(placed);
      const collisions = occupied.filter(other => box.x < other.x + other.width + 8 && box.x + box.width + 8 > other.x && box.y < other.y + other.height + 16 && box.y + box.height + 16 > other.y);
      if (!collisions.length) break;
      placed = moveBoardObject(placed, 0, Math.max(...collisions.map(other => other.y + other.height)) + 20 - placed.y) as typeof placed;
    }
    occupied.push(boardObjectBounds(placed)); return placed;
  });
}

/** Repair older assistant labels on hydration without moving user ink or writing over the saved original. */
export function restoreBoardLabels(objects: BoardObject[]): BoardObject[] {
  const assistant = objects.filter(object => object.source === "assistant").map(object =>
    object.kind === "equation" && !isBoardEquation(object.text) ? { ...object, kind: "text" as const } : object);
  const repaired = new Map(placeBoardLabels(assistant, objects.filter(object => object.source === "user")).map(object => [object.id, object]));
  return objects.map(object => repaired.get(object.id) || object);
}
