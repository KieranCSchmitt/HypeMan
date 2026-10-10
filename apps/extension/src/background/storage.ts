import {
  SETTINGS_KEY,
  LEARNING_KEY,
  parseSettings,
  parseLearningGraph,
  recordLearning,
  type Settings,
  type LearningEvent,
  type LearningGraph,
  type CharacterAsset,
} from "@core";
/** One queue serializes read-modify-write operations, including settings and learner evidence. */
let queue: Promise<unknown> = Promise.resolve();
function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.catch(() => undefined);
  return next;
}
export async function settings(): Promise<Settings> {
  const data = await chrome.storage.local.get([SETTINGS_KEY, "pip.settings"]);
  return parseSettings(data[SETTINGS_KEY] ?? data["pip.settings"]);
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
  const raw = await chrome.storage.local.get([LEARNING_KEY, "pip.graph"]);
  return parseLearningGraph(raw[LEARNING_KEY] ?? raw["pip.graph"]);
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
export async function characters(): Promise<CharacterAsset[]> {
  const raw = (await chrome.storage.local.get("burrow.characters"))["burrow.characters"];
  return Array.isArray(raw)
    ? raw
        .filter(
          (v): v is CharacterAsset =>
            v &&
            typeof v.id === "string" &&
            typeof v.name === "string" &&
            typeof v.image === "string" &&
            /^data:image\/(png|webp);base64,/.test(v.image),
        )
        .slice(-8)
    : [];
}
export function saveCharacter(input: unknown): Promise<CharacterAsset> {
  return transaction(async () => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid character");
    const c = input as Record<string, unknown>;
    if (
      typeof c.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      typeof c.image !== "string" ||
      c.image.length > 2_000_000 ||
      !/^data:image\/(png|webp);base64,/.test(c.image)
    )
      throw new Error("Choose a PNG or WebP character under 1.5 MB.");
    const character = {
      id: c.id,
      name: c.name.trim().slice(0, 60),
      image: c.image,
      createdAt: Date.now(),
    };
    const all = await characters();
    await chrome.storage.local.set({
      "burrow.characters": [...all.filter((v) => v.id !== c.id).slice(-7), character],
    });
    return character;
  });
}
export function removeCharacter(id: unknown): Promise<void> {
  return transaction(async () => {
    if (typeof id !== "string") throw new Error("Choose a character.");
    await chrome.storage.local.set({
      "burrow.characters": (await characters()).filter((c) => c.id !== id),
    });
    const current = await settings();
    if (current.character === `custom:${id}`)
      await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, character: "hypeman" } });
  });
}
