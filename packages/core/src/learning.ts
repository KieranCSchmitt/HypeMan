/** Evidence, rather than page visits, drives learning estimates. */
export const LEARNING_KEY = "hypeman.learning";
// A successful return after a full day away starts a new retrieval session;
// repeated practice within that day does not earn additional spacing credit.
const RETRIEVAL_SESSION_GAP_MS = 24 * 60 * 60 * 1000;
export interface LearningNode {
  id: string;
  label: string;
  exposures: number;
  attempts: number;
  correct: number;
  hints: number;
  explanations: number;
  recalls: number;
  lastSeen: number;
  lastPractice: number;
  evidence: string[];
}
export interface LearningPlan {
  id: string;
  goal: string;
  steps: { title: string; concept: string; done: boolean; exercise?: string; attempts?: LearningPlanAttempt[] }[];
  createdAt: number;
}
export interface LearningPlanAttempt {
  id: string; text: string; evidence: string; status: "correct" | "needs-work" | "uncertain";
  hint: string; at: number; grounded: boolean;
}
export interface LearningCurrentStep { plan: LearningPlan; stepIndex: number; step: LearningPlan["steps"][number] }
export interface LearningPlanAssessment { status: "correct" | "needs-work" | "uncertain"; hint: string; evidence: string; provider: string }
export interface LearningGraph {
  version: 1;
  nodes: LearningNode[];
  plans: LearningPlan[];
  seenEvents: string[];
}
export interface LearningEvent {
  id: string;
  concept: string;
  kind: "exposure" | "attempt" | "hint" | "explanation";
  correct?: boolean;
  evidence?: string;
  at: number;
}
export const emptyLearningGraph = (): LearningGraph => ({
  version: 1,
  nodes: [],
  plans: [],
  seenEvents: [],
});
const labelId = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
const integer = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseLearningGraph(value: unknown): LearningGraph {
  const g = emptyLearningGraph();
  if (!object(value) || value.version !== 1 || !Array.isArray(value.nodes)) return g;
  for (const raw of value.nodes.slice(-1000)) {
    if (!object(raw) || typeof raw.label !== "string" || !raw.label.trim()) continue;
    const label = raw.label.trim().slice(0, 120),
      id = labelId(label);
    if (!id || g.nodes.some((n) => n.id === id)) continue;
    g.nodes.push({
      id,
      label,
      exposures: integer(raw.exposures),
      attempts: integer(raw.attempts),
      correct: Math.min(integer(raw.correct), integer(raw.attempts)),
      hints: integer(raw.hints),
      explanations: integer(raw.explanations),
      recalls: integer(raw.recalls),
      lastSeen: integer(raw.lastSeen),
      lastPractice: integer(raw.lastPractice),
      evidence: Array.isArray(raw.evidence)
        ? raw.evidence
            .filter((e): e is string => typeof e === "string")
            .slice(-8)
            .map((e) => e.slice(0, 500))
        : [],
    });
  }
  if (Array.isArray(value.plans))
    for (const raw of value.plans.slice(-40)) {
      if (
        !object(raw) ||
        typeof raw.id !== "string" ||
        typeof raw.goal !== "string" ||
        !Array.isArray(raw.steps)
      )
        continue;
      g.plans.push({
        id: raw.id.slice(0, 100),
        goal: raw.goal.slice(0, 1000),
        createdAt: integer(raw.createdAt),
        steps: raw.steps
          .filter(object)
          .filter((s) => typeof s.title === "string" && typeof s.concept === "string")
          .slice(0, 20)
          .map((s) => ({
            title: String(s.title).slice(0, 200),
            concept: String(s.concept).slice(0, 120),
            done: s.done === true,
            ...(typeof s.exercise === "string" ? { exercise: s.exercise.slice(0, 2000) } : {}),
            ...(Array.isArray(s.attempts) ? { attempts: s.attempts.filter(object).filter((a) => typeof a.id === "string" && typeof a.text === "string" && typeof a.evidence === "string" && typeof a.hint === "string" && ["correct", "needs-work", "uncertain"].includes(String(a.status)) && Number.isFinite(a.at))
              .slice(-20).map((a) => ({ id: String(a.id).slice(0, 160), text: String(a.text).slice(0, 4000), evidence: String(a.evidence).slice(0, 1000), hint: String(a.hint).slice(0, 2000), status: a.status as LearningPlanAttempt["status"], at: Number(a.at), grounded: a.grounded === true })) } : {}),
          })),
      });
    }
  g.seenEvents = Array.isArray(value.seenEvents)
    ? value.seenEvents.filter((v): v is string => typeof v === "string").slice(-2000)
    : [];
  return g;
}
export function currentLearningStep(graph: LearningGraph, planId?: string): LearningCurrentStep | null {
  const plan = planId ? graph.plans.find((item) => item.id === planId) : [...graph.plans].reverse().find((item) => item.steps.some((step) => !step.done));
  if (!plan) return null;
  const stepIndex = plan.steps.findIndex((step) => !step.done);
  if (stepIndex < 0) return null;
  return { plan, stepIndex, step: { ...plan.steps[stepIndex], exercise: plan.steps[stepIndex].exercise || `Explain ${plan.steps[stepIndex].concept} in your own words and give an example.` } };
}
/** Only the current step and exact evidence from a live assessment can advance a plan. */
export function recordPlanAttempt(graph: LearningGraph, planId: string, stepIndex: number, attempt: { id: string; text: string; at: number }, assessment: LearningPlanAssessment): { graph: LearningGraph; advanced: boolean } {
  if (!/^[\w.-]{1,160}$/.test(attempt.id) || !attempt.text.trim() || attempt.text.length > 4000 || !Number.isFinite(attempt.at) || attempt.at < 0 ||
    !["correct", "needs-work", "uncertain"].includes(assessment.status) || typeof assessment.hint !== "string" || assessment.hint.length > 2000 || typeof assessment.evidence !== "string" || assessment.evidence.length > 1000)
    throw new Error("Invalid practice attempt.");
  const saved = graph.plans.find((plan) => plan.id === planId);
  if (saved?.steps.some((step) => step.attempts?.some((item) => item.id === attempt.id))) return { graph, advanced: false };
  const current = currentLearningStep(graph, planId);
  if (!current || current.stepIndex !== stepIndex) throw new Error("Continue the current practice step before checking another step.");
  const grounded = assessment.provider === "openai" && assessment.status !== "uncertain" && !!assessment.evidence.trim() && attempt.text.includes(assessment.evidence);
  const next = structuredClone(graph), step = next.plans.find((plan) => plan.id === planId)!.steps[stepIndex];
  step.attempts = [...(step.attempts || []).slice(-19), { ...attempt, status: grounded ? assessment.status : "uncertain", hint: grounded ? assessment.hint : "I could not verify this attempt from a live assessment. Try explaining the current exercise again.", evidence: grounded ? assessment.evidence : "", grounded }];
  step.done = grounded && assessment.status === "correct";
  const updated = grounded ? recordLearning(next, { id: attempt.id, concept: step.concept, kind: "attempt", correct: step.done, evidence: assessment.evidence, at: attempt.at }) : next;
  return { graph: updated, advanced: step.done };
}
export function recordLearning(graph: LearningGraph, event: LearningEvent): LearningGraph {
  const g = structuredClone(graph);
  if (!event.id || g.seenEvents.includes(event.id) || !Number.isFinite(event.at)) return g;
  const label = event.concept.trim().slice(0, 120),
    id = labelId(label);
  if (!id) return g;
  let node = g.nodes.find((n) => n.id === id);
  if (!node) {
    node = {
      id,
      label,
      exposures: 0,
      attempts: 0,
      correct: 0,
      hints: 0,
      explanations: 0,
      recalls: 0,
      lastSeen: 0,
      lastPractice: 0,
      evidence: [],
    };
    g.nodes = [...g.nodes.slice(-999), node];
  }
  if (event.kind === "exposure") node.exposures++;
  if (event.kind === "hint") node.hints++;
  if (event.kind === "explanation" && event.correct) node.explanations++;
  if (event.kind === "attempt") {
    node.attempts++;
    if (event.correct) {
      node.correct++;
      if (node.lastPractice && event.at - node.lastPractice >= RETRIEVAL_SESSION_GAP_MS)
        node.recalls++;
    }
    node.lastPractice = Math.max(node.lastPractice, event.at);
  }
  node.lastSeen = Math.max(node.lastSeen, event.at);
  if (event.evidence) node.evidence = [...node.evidence.slice(-7), event.evidence.slice(0, 500)];
  g.seenEvents = [...g.seenEvents.slice(-1999), event.id];
  return g;
}
export function learningEstimate(
  node: LearningNode,
  now = Date.now(),
): { precision: number | null; retention: number | null; due: boolean; evidenceCount: number } {
  const precision = node.attempts >= 3 ? node.correct / node.attempts : null;
  const evidenceCount = node.attempts + node.explanations;
  const days = Math.max(0, now - node.lastPractice) / 86400000;
  const retention =
    precision === null || !node.lastPractice
      ? null
      : precision * Math.exp(-days / Math.min(90, 2 * 2 ** Math.min(node.recalls, 5)));
  return { precision, retention, due: retention !== null && retention < 0.6, evidenceCount };
}
