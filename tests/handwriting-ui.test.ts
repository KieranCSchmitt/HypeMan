// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InkReview } from "@core";
import { request } from "../apps/extension/src/bridge";
import { Board } from "../apps/extension/src/ui/Board";
import { WorkbenchContext, type ToolHandler, type WorkbenchState } from "../apps/extension/src/ui/WorkbenchContext";

vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
let root: Root, container: HTMLDivElement, handler: ToolHandler;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.mocked(request).mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), scale: vi.fn(), translate: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,YQ==");
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("conversational handwriting review", () => {
  it("renders evidence-linked questions and sends current readback on a second chat check", async () => {
    const review: InkReview = { readback: ["1/2 + 1/4", "= 2/6"], legibility: "readable", observations: ["You are combining two fractions."],
      issues: [{ evidence: "= 2/6", concern: "The parts have different sizes.", question: "Can both fractions use equal-sized parts?" }], nextStep: "Sketch matching fraction strips.", provider: "demo" };
    vi.mocked(request).mockImplementation(async (message) => message.type === "artifact.get" ? null : review);
    const workbench: WorkbenchState = { conversationId: "fractions", selected: null, selectContent: vi.fn(), openTool: vi.fn(), send: vi.fn(), executeTool: vi.fn(),
      register: (_tool, callback) => { handler = callback; return () => {}; } };
    await act(async () => root.render(createElement(WorkbenchContext.Provider, { value: workbench }, createElement(Board, {}))));
    await act(async () => { await handler("check", {}); });
    expect(container.querySelector(".ink-feedback blockquote")?.textContent).toBe("= 2/6");
    expect(container.textContent).toContain("Can both fractions use equal-sized parts?");
    expect(container.textContent).toContain("Demonstration feedback");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Export board"]')?.disabled).toBe(false);
    await act(async () => { await handler("check", {}); });
    expect(request).toHaveBeenLastCalledWith({ type: "api", path: "/api/ink", body: {
      image: "data:image/png;base64,YQ==", previousLines: review.readback, goal: "",
    } }, expect.any(AbortSignal));
  });
});
