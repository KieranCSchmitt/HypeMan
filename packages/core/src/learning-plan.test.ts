import { describe, expect, it } from "vitest";
import { currentLearningStep, emptyLearningGraph, parseLearningGraph, recordPlanAttempt, type LearningPlanAssessment } from "./learning";
const graph = () => ({ ...emptyLearningGraph(), plans: [{ id: "route", goal: "Fractions", createdAt: 1, steps: [{ title: "Recall", concept: "Fractions", exercise: "Explain 1/2 with an example.", done: false }, { title: "Apply", concept: "Fractions", done: false }] }] });
const attempt = { id: "a1", text: "One half means one of two equal parts.", at: 10 };
const assessment: LearningPlanAssessment = { status: "correct", hint: "Now try a new example.", evidence: "one of two equal parts", provider: "openai" };
describe("persisted executable practice", () => {
  it("advances only the current step with grounded live evidence and preserves it on reload", () => {
    expect(currentLearningStep(graph())?.step.exercise).toBe("Explain 1/2 with an example.");
    const result = recordPlanAttempt(graph(), "route", 0, attempt, assessment);
    const saved = parseLearningGraph(JSON.parse(JSON.stringify(result.graph)));
    expect(result.advanced).toBe(true); expect(currentLearningStep(saved)?.stepIndex).toBe(1);
    expect(saved.nodes[0]).toMatchObject({ attempts: 1, correct: 1, evidence: [assessment.evidence] });
    expect(saved.plans[0].steps[0].attempts?.[0]).toMatchObject({ grounded: true, text: attempt.text });
    expect(recordPlanAttempt(saved, "route", 0, attempt, assessment)).toEqual({ graph: saved, advanced: false });
  });
  it("keeps demo, uncertain and ungrounded judgments from awarding progress", () => {
    for (const patch of [{ provider: "demo" }, { status: "uncertain" as const }, { evidence: "invented quote" }]) {
      const result = recordPlanAttempt(graph(), "route", 0, attempt, { ...assessment, ...patch });
      expect(result.advanced).toBe(false); expect(result.graph.nodes).toEqual([]); expect(result.graph.plans[0].steps[0].attempts?.[0].grounded).toBe(false);
    }
    expect(() => recordPlanAttempt(graph(), "route", 1, attempt, assessment)).toThrow("current practice");
  });
});
