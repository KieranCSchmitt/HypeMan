// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentLearningStep, DEFAULT_SETTINGS, emptyLearningGraph, emptyWorkspace, recordPlanAttempt } from "@core";
import { CompanionTools } from "../apps/extension/src/ui/CompanionTools";
import { request } from "../apps/extension/src/bridge";
const state = vi.hoisted(() => ({ handlers: new Map<string, (operation: string, args: Record<string, unknown>) => Promise<string | void>>() }));
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn() }));
vi.mock("../apps/extension/src/ui/hooks", () => ({ useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, learningEnabled: true }, patch: vi.fn() }), useWorkspace: () => ({ workspace: emptyWorkspace(), refresh: vi.fn(), error: "", loading: false }), message: (error: unknown) => error instanceof Error ? error.message : String(error), relativeTime: () => "", host: () => "", exportWorkspace: vi.fn(), setScreenshotAccess: vi.fn() }));
vi.mock("../apps/extension/src/ui/WorkbenchContext", () => ({ useWorkbench: () => ({ conversationId: "learning-test", selected: null, selectContent: vi.fn(), send: vi.fn().mockResolvedValue(undefined), executeTool: async (tool: string, operation: string, args: Record<string, unknown>) => state.handlers.get(tool)!(operation, args) }), useToolHandler: (tool: string, handler: (operation: string, args: Record<string, unknown>) => Promise<string | void>) => state.handlers.set(tool, handler) }));
let root: Root, container: HTMLDivElement;
let verdict: { status: string; hint: string; evidence: string; provider: string };
const explanation = "Subtract two from both sides to keep the equation balanced.";
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); state.handlers.clear(); verdict = { status: "correct", hint: "Explain the next step.", evidence: "Subtract two from both sides", provider: "openai" }; vi.mocked(request).mockReset().mockImplementation(async (input) => input.type === "graph.get" ? { nodes: [], edges: [], plans: [] } : input.type === "api" ? verdict : null); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function assess() { await act(async () => root.render(createElement(CompanionTools, { section: "learning", onClose: () => {} }))); let response: string | void; await act(async () => { response = await state.handlers.get("learning")!("teach", { concept: "Balanced equations", explanation }); }); return response!; }
describe("evidence-backed conversational learning", () => {
  it("keeps an answer bound to its displayed exercise when another window advances the plan", async () => {
    const graph = emptyLearningGraph(); graph.plans.push({ id: "shared-plan", goal: "Fractions", createdAt: 1, steps: [{ title: "Equal parts", concept: "Fractions", exercise: "Explain equal parts.", done: false }, { title: "Add fractions", concept: "Fractions", exercise: "Add one half and one quarter.", done: false }] });
    vi.mocked(request).mockImplementation(async (input) => input.type === "graph.get" ? structuredClone(graph) : input.type === "learn.current" ? currentLearningStep(graph, input.planId as string | undefined) : null);
    await act(async () => root.render(createElement(CompanionTools, { section: "learning", onClose: () => {} })));
    graph.plans[0].steps[0].done = true;
    await act(async () => { await expect(state.handlers.get("learning")!("attempt", { planId: "shared-plan", stepIndex: 0, explanation: "Equal parts have the same size." })).rejects.toThrow("exercise changed"); });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: "learn.step.attempt" }), expect.anything());
    expect(container.textContent).toContain("Step 2/2");
    graph.plans[0].steps[1].exercise = "Explain why quarters must be equal sized.";
    await act(async () => { await state.handlers.get("learning")!("continue", { planId: "shared-plan" }); });
    expect(container.textContent).toContain("Explain why quarters must be equal sized.");
  });
  it("reuses the same attempt ID after a lost response instead of assessing the next exercise", async () => {
    let graph = emptyLearningGraph(); graph.plans.push({ id: "retry-plan", goal: "Fractions", createdAt: 1, steps: [{ title: "Equal parts", concept: "Fractions", exercise: "Explain equal parts.", done: false }, { title: "Add fractions", concept: "Fractions", exercise: "Add one half and one quarter.", done: false }] });
    let recorded: Record<string, unknown> | undefined;
    vi.mocked(request).mockImplementation(async (input) => {
      if (input.type === "graph.get") return structuredClone(graph);
      if (input.type === "learn.current") return currentLearningStep(graph, input.planId as string | undefined);
      if (input.type === "learn.step.attempt") {
        if (recorded) return recorded;
        const assessment = { status: "correct" as const, hint: "Try the next exercise.", evidence: "equal parts", provider: "openai" };
        const result = recordPlanAttempt(graph, String(input.planId), Number(input.stepIndex), { id: String(input.requestId), text: String(input.explanation), at: Date.now() }, assessment);
        graph = result.graph; recorded = { ...result, ...assessment };
        throw new Error("Response lost after saving.");
      }
      return null;
    });
    await act(async () => root.render(createElement(CompanionTools, { section: "learning", onClose: () => {} })));
    const answer = { planId: "retry-plan", stepIndex: 0, explanation: "Fractions describe equal parts of a whole." };
    await act(async () => { await expect(state.handlers.get("learning")!("attempt", answer)).rejects.toThrow("Response lost"); });
    await act(async () => { await state.handlers.get("learning")!("attempt", answer); });
    const attempts = vi.mocked(request).mock.calls.filter(([input]) => input.type === "learn.step.attempt");
    expect(attempts).toHaveLength(2); expect(attempts[1][0].requestId).toBe(attempts[0][0].requestId);
    expect(attempts[1][0].stepIndex).toBe(0); expect(graph.plans[0].steps[0].attempts).toHaveLength(1);
    expect(container.textContent).toContain("Step 2/2");
  });
  it("advances a grounded attempt and resumes the durable next exercise", async () => {
    let graph = emptyLearningGraph(); graph.plans.push({ id: "fractions-plan", goal: "Fractions", createdAt: 1, steps: [{ title: "Equal parts", concept: "Fractions", exercise: "Explain equal parts.", done: false }, { title: "Add fractions", concept: "Common denominators", exercise: "Add one half and one quarter.", done: false }] });
    vi.mocked(request).mockImplementation(async (input) => {
      if (input.type === "graph.get") return structuredClone(graph);
      if (input.type === "learn.current") return currentLearningStep(graph, input.planId as string | undefined);
      if (input.type === "learn.step.attempt") { const assessment = { status: "correct" as const, hint: "Try the next exercise.", evidence: "equal parts", provider: "openai" }; const result = recordPlanAttempt(graph, String(input.planId), Number(input.stepIndex), { id: String(input.requestId), text: String(input.explanation), at: Date.now() }, assessment); graph = result.graph; return { ...result, ...assessment }; }
      return null;
    });
    await act(async () => root.render(createElement(CompanionTools, { section: "learning", onClose: () => {} })));
    expect(container.textContent).toContain("Step 1/2"); expect(container.textContent).toContain("Explain equal parts.");
    await act(async () => { await state.handlers.get("learning")!("attempt", { explanation: "Fractions describe equal parts of a whole." }); });
    expect(container.textContent).toContain("Step 2/2"); expect(container.textContent).toContain("Add one half and one quarter.");
    await act(async () => root.render(createElement(CompanionTools, { key: "reopen", section: "learning", onClose: () => {} })));
    expect(container.textContent).toContain("Step 2/2"); expect(graph.plans[0].steps[0].attempts?.[0].evidence).toBe("equal parts");
  });
  it("creates a saved practice plan directly and keeps review evidence in its own view", async () => {
    const graph = { plans: [] as Array<{ id: string; goal: string; steps: { title: string; concept: string; done: boolean }[] }>, nodes: [{ id: "fractions", label: "Fractions", attempts: 3, explanations: 0, correct: 3, lastPractice: Date.now(), recalls: 0, evidence: ["Explained equal-sized parts"] }] };
    vi.mocked(request).mockImplementation(async (input) => {
      if (input.type === "graph.get") return structuredClone(graph);
      if (input.type === "api") return { goal: "Fractions", steps: [{ title: "Find equal parts", concept: "Fractions" }] };
      if (input.type === "learn.plan") graph.plans.push(input.plan as typeof graph.plans[number]);
      return null;
    });
    await act(async () => root.render(createElement(CompanionTools, { section: "learning", onClose: () => {} })));
    await act(async () => {
      const field = container.querySelector<HTMLInputElement>('[aria-label="Practice goal"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Fractions"); field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "learn.plan", plan: expect.objectContaining({ goal: "Fractions" }) }), expect.any(AbortSignal));
    expect(container.textContent).toContain("Find equal parts");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Review")!.click());
    expect(container.textContent).toContain("3 practices"); expect(container.querySelector("details summary")?.textContent).toBe("Evidence");
    expect(container.textContent).not.toContain("Find equal parts");
  });
  it("records a real-provider assessment only with an exact evidence quote", async () => { expect(await assess()).toContain("supported"); expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: "learn.event", event: expect.objectContaining({ concept: "Balanced equations", correct: true, evidence: verdict.evidence }) }), expect.any(AbortSignal)); });
  it.each(["cancel", "unmount"])("does not grant learning credit from a late verdict after %s", async (reason) => {
    let finish!: (value: typeof verdict) => void;
    const original = vi.mocked(request).getMockImplementation()!;
    vi.mocked(request).mockImplementation((input, signal) => input.type === "api" ? new Promise((resolve) => { finish = resolve; }) : original(input, signal));
    await act(async () => root.render(createElement(CompanionTools, { section: "learning", onClose: () => {} })));
    const completion = state.handlers.get("learning")!("teach", { concept: "Balanced equations", explanation }).then(() => null, (error) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const signal = vi.mocked(request).mock.calls.find(([input]) => input.type === "api")![1]!;
    let failure: Error;
    await act(async () => { if (reason === "unmount") root.unmount(); else window.dispatchEvent(new Event("hypeman.cancel-tools")); finish(verdict); failure = await completion; });
    expect(signal.aborted).toBe(true); expect(failure!.name).toBe("AbortError");
    expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "learn.event")).toBe(false);
  });
  it.each(["demo", "uncertain", "ungrounded"])("keeps %s feedback out of practice evidence", async (kind) => { if (kind === "demo") verdict.provider = "demo"; if (kind === "uncertain") verdict.status = "uncertain"; if (kind === "ungrounded") verdict.evidence = "Add four to both sides"; const response = await assess(); expect(response).not.toContain("supported"); expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "learn.event")).toBe(false); });
});
