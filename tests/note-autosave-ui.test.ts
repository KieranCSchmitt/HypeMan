// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceNote } from "@core";
import { NoteCard } from "../apps/extension/src/ui/common";
import { request } from "../apps/extension/src/bridge";
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ message: (error: unknown) => error instanceof Error ? error.message : String(error), relativeTime: () => "now", host: () => "example.com" }));
vi.mock("../apps/extension/src/ui/WorkbenchContext", () => ({ useWorkbench: () => ({ selected: null, selectContent: vi.fn() }) }));
let root: Root, container: HTMLDivElement;
const note: SourceNote = { id: "source-note", text: "Original note", title: "Workshop finding", excerpt: "Clay included", url: "https://example.com/workshop", createdAt: 1, updatedAt: 1 };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); vi.mocked(request).mockReset().mockResolvedValue(null); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function edit(value: string) { await act(async () => { const editor = container.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, value); editor.dispatchEvent(new Event("input", { bubbles: true })); }); }
describe("note autosave lifecycle", () => {
  it("finishes an edit before the direct delete action removes the note", async () => {
    const remove = vi.fn(async () => { await request({ type: "note.remove", id: note.id }); });
    await act(async () => root.render(createElement(NoteCard, { note, refresh: vi.fn().mockResolvedValue(undefined), onDelete: remove })));
    await edit("Last edit before deletion");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Delete note"]')!.click());
    expect(vi.mocked(request).mock.calls.map(([input]) => input.type)).toEqual(["note.save", "note.remove"]);
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(vi.mocked(request).mock.calls.map(([input]) => input.type)).toEqual(["note.save", "note.remove"]);
  });
  it("saves the latest direct edit when notes close before the debounce and without blur", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(createElement(NoteCard, { note, refresh })));
    await edit("First draft");
    await edit("Latest finding before Escape closes notes");
    expect(request).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(request).toHaveBeenCalledExactlyOnceWith({ type: "note.save", note: { ...note, text: "Latest finding before Escape closes notes" } });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
