import { currentLearningStep, type LearningGraph, type LearningPlanAssessment, type LearningCurrentStep } from "@core";
interface Input { planId: string; stepIndex: number; explanation: string; requestId: string }
interface Dependencies { graph(): Promise<LearningGraph>; enabled(): Promise<boolean>; save(planId: string, stepIndex: number, attempt: { id: string; text: string; at: number }, assessment: LearningPlanAssessment): Promise<unknown> }
/** Serializes a plan's attempts so retries cannot earn credit or invoke a judge twice. */
export class LearningPracticeService {
  private queue = new Map<string, Promise<unknown>>();
  constructor(private api: Dependencies) {}
  attempt(input: Input, assess: (current: LearningCurrentStep) => Promise<LearningPlanAssessment>, check = () => {}): Promise<unknown> {
    if (!/^[\w.-]{1,160}$/.test(input.requestId) || !/^[\w.-]{1,100}$/.test(input.planId) || !Number.isInteger(input.stepIndex) || typeof input.explanation !== "string" || !input.explanation.trim() || input.explanation.length > 4000) return Promise.reject(new Error("Explain the current practice step in 4,000 characters or fewer."));
    const next = (this.queue.get(input.planId) || Promise.resolve()).catch(() => {}).then(async () => {
      check(); if (!await this.api.enabled()) throw new Error("Enable Learning mode to practice.");
      const graph = await this.api.graph(), plan = graph.plans.find(plan => plan.id === input.planId), previous = plan?.steps.flatMap(step => step.attempts || []).find(attempt => attempt.id === input.requestId);
      if (previous) {
        if (previous.text !== input.explanation) throw new Error("This practice request was already used for another explanation.");
        return { graph, advanced: false, status: previous.status, evidence: previous.evidence, hint: previous.hint, provider: previous.grounded ? "openai" : "saved" };
      }
      const current = currentLearningStep(graph, input.planId);
      if (!current || current.stepIndex !== input.stepIndex) throw new Error("Continue the current practice step first.");
      const assessment = await assess(current); check();
      return this.api.save(input.planId, input.stepIndex, { id: input.requestId, text: input.explanation, at: Date.now() }, assessment);
    });
    this.queue.set(input.planId, next);
    void next.finally(() => { if (this.queue.get(input.planId) === next) this.queue.delete(input.planId); }).catch(() => {});
    return next;
  }
}
