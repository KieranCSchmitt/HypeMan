import { describe, expect, it, vi } from "vitest";
import { emptyLearningGraph, recordPlanAttempt, type LearningGraph, type LearningPlanAssessment } from "@core";
import { LearningPracticeService } from "./learning-practice";
describe("practice request idempotency", () => {
  it("serializes concurrent retries and reuses persisted evidence after restart", async () => {
    let graph: LearningGraph = { ...emptyLearningGraph(), plans: [{ id: "plan", goal: "Fractions", createdAt: 1, steps: [{ title: "Half", concept: "Fractions", exercise: "Explain one half.", done: false }] }] };
    const api = { graph: async () => graph, enabled: async () => true, save: async (planId: string, stepIndex: number, attempt: { id: string; text: string; at: number }, assessment: LearningPlanAssessment) => { const result = recordPlanAttempt(graph, planId, stepIndex, attempt, assessment); graph = result.graph; return result; } };
    const service = new LearningPracticeService(api), input = { planId: "plan", stepIndex: 0, explanation: "One half is one of two equal parts.", requestId: "retry" };
    const assess = vi.fn(async current => { expect(current.step.exercise).toBe("Explain one half."); return { provider: "openai", status: "correct" as const, evidence: "one of two equal parts", hint: "Try another example." }; });
    await Promise.all([service.attempt(input, assess), service.attempt(input, assess)]);
    expect(assess).toHaveBeenCalledTimes(1); expect(graph.nodes[0].attempts).toBe(1);
    expect(await new LearningPracticeService(api).attempt(input, assess)).toMatchObject({ advanced: false, status: "correct" }); expect(assess).toHaveBeenCalledTimes(1);
    await expect(service.attempt({ ...input, explanation: "Changed answer" }, assess)).rejects.toThrow("already used");
  });
});
