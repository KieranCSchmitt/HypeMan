import {
  SETTINGS_KEY,
  LEARNING_KEY,
  parseSettings,
  parseLearningGraph,
  recordLearning,
  type Settings,
  type LearningEvent,
  type LearningGraph,
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
    const next = parseLearningGraph({ ...current, plans: [...current.plans.slice(-39), plan] });
    await chrome.storage.local.set({ [LEARNING_KEY]: next });
    return next;
  });
}
export function clearLearning(): Promise<void> {
  return transaction(() => chrome.storage.local.remove(LEARNING_KEY));
}
