/** Evidence, rather than page visits, drives learning estimates. */
export const LEARNING_KEY = "burrow.learning";
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
  steps: { title: string; concept: string; done: boolean }[];
  createdAt: number;
}
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
  if (!object(value)) return g;
  // Legacy graph snapshots remain readable; exposure is never promoted to demonstrated skill.
  const rawNodes = Array.isArray(value.nodes)
    ? value.nodes
    : object(value.nodes)
      ? Object.values(value.nodes)
      : [];
  for (const raw of rawNodes.slice(-1000)) {
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
          })),
      });
    }
  g.seenEvents = Array.isArray(value.seenEvents)
    ? value.seenEvents.filter((v): v is string => typeof v === "string").slice(-2000)
    : [];
  return g;
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
      if (node.lastPractice && event.at - node.lastPractice >= 6 * 60 * 60 * 1000) node.recalls++;
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
