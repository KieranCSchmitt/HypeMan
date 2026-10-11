import {
  SETTINGS_KEY,
  LEARNING_KEY,
  parseSettings,
  parseLearningGraph,
  recordLearning,
  currentLearningStep,
  recordPlanAttempt,
  type Settings,
  type LearningEvent,
  type LearningGraph,
  type LearningPlanAssessment,
} from "@core";
/** One queue serializes read-modify-write operations, including settings and learner evidence. */
let queue: Promise<unknown> = Promise.resolve();
function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.catch(() => undefined);
  return next;
}
export async function settings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return parseSettings(data[SETTINGS_KEY]);
}
export function patchSettings(patch: unknown): Promise<Settings> {
  return transaction(async () => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw new Error("Invalid settings");
    const next = parseSettings({ ...(await settings()), ...patch });
    if (next.trustedInput && !(await chrome.permissions.contains({ permissions: ["debugger"] })))
      throw new Error("Enable real input from the permissions button first.");
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
}
/** A server address change and its private connection must be committed in the same queue. */
export function saveConnection(token: string, serverUrl: string): Promise<void> {
  return transaction(async () => {
    const current = await settings();
    if (current.serverUrl !== serverUrl)
      throw new Error("The local server changed. Retry the connection.");
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, serverToken: token } });
  });
}
export async function graph(): Promise<LearningGraph> {
  const raw = await chrome.storage.local.get(LEARNING_KEY);
  return parseLearningGraph(raw[LEARNING_KEY]);
}
export function learn(event: LearningEvent): Promise<LearningGraph> {
  return transaction(async () => {
    if (!(await settings()).learningEnabled)
      throw new Error("Enable Learning mode to record evidence.");
    if (
      !event ||
      typeof event.id !== "string" ||
      !event.id ||
      event.id.length > 160 ||
      typeof event.concept !== "string" ||
      event.concept.length > 500 ||
      !["exposure", "attempt", "hint", "explanation"].includes(event.kind) ||
      !Number.isFinite(event.at) ||
      event.at < 0 ||
      (event.correct !== undefined && typeof event.correct !== "boolean") ||
      (event.evidence !== undefined &&
        (typeof event.evidence !== "string" || event.evidence.length > 8000))
    )
      throw new Error("Invalid learning evidence");
    const next = recordLearning(await graph(), event);
    await chrome.storage.local.set({ [LEARNING_KEY]: next });
    return next;
  });
}
export function savePlan(plan: unknown): Promise<LearningGraph> {
  return transaction(async () => {
    if (!(await settings()).learningEnabled) throw new Error("Enable Learning mode to save plans.");
    const current = await graph();
    const parsed = parseLearningGraph({ version: 1, nodes: [], plans: [plan] }).plans[0];
    if (!parsed?.id || !parsed.goal.trim() || !parsed.steps.length || parsed.steps.some((step) => !step.title.trim() || !step.concept.trim())) throw new Error("Give a valid learning goal and practice steps.");
    if (current.plans.some((item) => item.id === parsed.id)) return current;
    parsed.steps = parsed.steps.map((step) => ({ ...step, done: false, attempts: [], exercise: step.exercise || `Explain ${step.concept} in your own words and give an example.` }));
    const next = { ...current, plans: [...current.plans.slice(-39), parsed] };
    await chrome.storage.local.set({ [LEARNING_KEY]: next });
    return next;
  });
}
export async function currentPractice(planId?: string) { return currentLearningStep(await graph(), planId); }
export function savePracticeAttempt(planId: string, stepIndex: number, attempt: { id: string; text: string; at: number }, assessment: LearningPlanAssessment) {
  return transaction(async () => {
    if (!(await settings()).learningEnabled) throw new Error("Enable Learning mode to save practice.");
    const result = recordPlanAttempt(await graph(), planId, stepIndex, attempt, assessment);
    await chrome.storage.local.set({ [LEARNING_KEY]: result.graph });
    const saved = result.graph.plans.find(plan => plan.id === planId)?.steps.flatMap(step => step.attempts || []).find(item => item.id === attempt.id);
    return { ...result, provider: assessment.provider, status: saved?.status || "uncertain", evidence: saved?.evidence || "", hint: saved?.hint || "Try the current exercise again." };
  });
}
export function mergeLearning(value: LearningGraph): Promise<number> {
  return transaction(async () => {
    const current = await graph(), ids = new Set(current.plans.map(plan => plan.id));
    const plans = value.plans.filter(plan => !ids.has(plan.id));
    if (current.plans.length + plans.length > 40) throw new Error("Restore exceeds the saved learning-plan limit.");
    const nodeIds = new Set(current.nodes.map(node => node.id));
    if (current.nodes.length + value.nodes.filter(node => !nodeIds.has(node.id)).length > 1000) throw new Error("Restore exceeds the saved learning evidence limit.");
    const next = parseLearningGraph({ ...current, plans: [...current.plans, ...plans], nodes: [...current.nodes, ...value.nodes.filter(node => !nodeIds.has(node.id))], seenEvents: [...new Set([...current.seenEvents, ...value.seenEvents])] });
    await chrome.storage.local.set({ [LEARNING_KEY]: next }); return plans.length;
  });
}
export function clearLearning(): Promise<void> {
  return transaction(() => chrome.storage.local.remove(LEARNING_KEY));
}
