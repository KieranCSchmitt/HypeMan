import { describe, expect, it } from "vitest";
import { boardObjectBounds, editBoard, emptyBoard, moveBoardObject, parseBoardDocument, parseBoardObject, undoBoard, type BoardObject } from "./board";
const label = (id: string, text: string, source: "user" | "assistant" = "assistant"): BoardObject => ({ id, kind: "equation", source, x: 60, y: 60, color: "#1b1f3b", fontSize: 26, text });

describe("shared whiteboard document", () => {
  it("undoes an assistant transaction without erasing earlier user ink, with durable redo", () => {
    const ink: BoardObject = { id: "ink", kind: "stroke", source: "user", x: 20, y: 30, color: "#000000", size: 3, points: [{ x: 0, y: 0 }, { x: 20, y: 50 }] };
    const initial = editBoard(emptyBoard(), { upsert: [ink] }, 1);
    const diagram = editBoard(initial, { upsert: [label("one", "2x + 4 = 10"), label("two", "2x = 6")], title: "Worked example" }, 2);
    const undone = undoBoard(diagram, "undo", 3);
    expect(undone.objects).toEqual([ink]); expect(undone.title).toBe("Whiteboard"); expect(undone.revision).toBe(3);
    const restored = undoBoard(parseBoardDocument(JSON.parse(JSON.stringify(undone)))!, "redo", 4);
    expect(restored.objects).toEqual(diagram.objects); expect(restored.title).toBe("Worked example"); expect(restored.revision).toBe(4);
  });
  it("keeps stable IDs and order through updates, delete/clear, undo, and a new edit", () => {
    const first = editBoard(emptyBoard(), { upsert: [label("one", "x=1"), label("two", "y=2"), label("three", "z=3")] });
    const updated = editBoard(first, { upsert: [label("two", "y=4")] });
    expect(updated.objects.map((object) => object.id)).toEqual(["one", "two", "three"]);
    const cleared = editBoard(updated, { remove: ["one", "two", "three"] });
    expect(undoBoard(cleared, "undo").objects).toEqual(updated.objects);
    const afterUndo = undoBoard(updated, "undo");
    const branch = editBoard(afterUndo, { remove: ["one"] });
    expect(branch.redo).toEqual([]); expect(undoBoard(branch, "undo").objects).toEqual(first.objects);
  });
  it("validates persisted geometry and history without allowing unbounded or duplicate scene objects", () => {
    const valid = editBoard(emptyBoard(), { upsert: [label("one", "\\frac{1}{2}")] });
    expect(parseBoardDocument(valid)).toEqual(valid);
    expect(parseBoardDocument({ ...valid, objects: [valid.objects[0], valid.objects[0]] })).toBeNull();
    expect(parseBoardDocument({ ...valid, revision: -1 })).toBeNull();
    expect(parseBoardDocument({ ...valid, undo: [{ ...valid.undo[0], changes: [{ ...valid.undo[0].changes[0], after: { ...valid.objects[0], id: "wrong" } }] }] })).toBeNull();
    expect(parseBoardObject({ ...valid.objects[0], x: Infinity })).toBeNull();
    expect(parseBoardObject({ ...valid.objects[0], color: "url(example.com)" })).toBeNull();
    expect(() => editBoard(valid, { upsert: [{ ...valid.objects[0], text: "a".repeat(4001) } as BoardObject] })).toThrow("Invalid board object");
  });
  it("moves connectors at both endpoints and bounds offset user strokes", () => {
    const arrow: BoardObject = { id: "arrow", kind: "arrow", source: "assistant", x: 10, y: 20, toX: 100, toY: 90, color: "#000000", size: 3 };
    expect(moveBoardObject(arrow, 5, -10)).toMatchObject({ id: "arrow", x: 15, y: 10, toX: 105, toY: 80 });
    expect(boardObjectBounds({ id: "stroke", kind: "stroke", source: "user", x: 100, y: 200, points: [{ x: -20, y: 10 }, { x: 60, y: 80 }], color: "#000000", size: 2 })).toEqual({ x: 80, y: 210, width: 80, height: 70 });
  });
  it("does not create history for an unchanged scene and bounds undo retention", () => {
    let board = emptyBoard();
    expect(editBoard(board, { remove: ["absent"] })).toBe(board);
    for (let i = 0; i < 45; i++) board = editBoard(board, { upsert: [label("one", `x=${i}`)] }, i);
    expect(board.undo).toHaveLength(40); expect(board.revision).toBe(45);
    expect(parseBoardDocument(board)).not.toBeNull();
  });
});
