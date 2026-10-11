import {
  SETTINGS_KEY,
  LEARNING_KEY,
  WORKSPACE_KEY,
  parseSettings,
  parseLearningGraph,
  parseWorkspace,
  isRecord,
} from "@core";

interface StoragePort {
  get(keys: null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** Import recognizable local records by schema, without retaining former brand namespaces.
 * Persist the validated copy before retiring a source key so interrupted upgrades are safe.
 */
export async function upgradeLocalStorage(area: StoragePort): Promise<void> {
  const stored = await area.get(null);
  const writes: Record<string, unknown> = {};
  const retired: string[] = [];
  const priority = ([key, value]: [string, unknown]) =>
    (isRecord(value) && typeof value.version === "number" && Number.isFinite(value.version)
      ? value.version : 0) * 10 + (key.endsWith(".learning") ? 1 : 0);
  // Prefer newer schemas and explicit learning records over older graph imports.
  for (const [key, value] of Object.entries(stored).sort((a, b) => priority(b) - priority(a))) {
    const match = /^([a-z][a-z0-9_-]{0,63})\.(settings|workspace|learning|graph|characters)$/i.exec(key);
    if (!match || match[1] === "hypeman") continue;
    const kind = match[2];
    let target: string, clean: unknown;
    if (kind === "settings" && isRecord(value) && typeof value.serverUrl === "string") {
      target = SETTINGS_KEY;
      clean = parseSettings({
        ...value,
        ...(typeof value.character === "string" && value.character.startsWith("custom:")
          ? {} : { characterName: "HypeMan" }),
      });
    } else if (kind === "workspace" && isRecord(value) && value.version === 1 &&
      Array.isArray(value.tasks) && Array.isArray(value.notes) && Array.isArray(value.events)) {
      target = WORKSPACE_KEY;
      clean = parseWorkspace(value);
    } else if ((kind === "learning" || kind === "graph") && isRecord(value) &&
      (Array.isArray(value.nodes) || isRecord(value.nodes))) {
      target = LEARNING_KEY;
      clean = parseLearningGraph(value);
    } else if (kind === "characters" && Array.isArray(value)) {
      target = "hypeman.characters";
      clean = value.filter((entry) => isRecord(entry) && typeof entry.id === "string" &&
        typeof entry.name === "string" && typeof entry.image === "string" &&
        /^data:image\/(png|webp);base64,/.test(entry.image) && entry.image.length <= 2_000_000)
        .slice(-8);
    } else continue;
    if (stored[target] === undefined && writes[target] === undefined) writes[target] = clean;
    retired.push(key);
  }
  if (Object.keys(writes).length) await area.set(writes);
  if (retired.length) await area.remove(retired);
}

/** Keep tab handoffs across a service-worker update in the same browser session. */
export async function upgradeSessionStorage(area: StoragePort): Promise<void> {
  const stored = await area.get(null);
  const writes: Record<string, unknown> = {};
  const retired: string[] = [];
  for (const [key, value] of Object.entries(stored)) {
    const match = /^([a-z][a-z0-9_-]{0,63})\.(session|tab\.\d+)$/i.exec(key);
    if (!match || match[1] === "hypeman" ||
      (match[2] === "session" ? value !== true : !isRecord(value))) continue;
    const target = `hypeman.${match[2]}`;
    if (stored[target] === undefined && writes[target] === undefined) writes[target] = value;
    retired.push(key);
  }
  if (Object.keys(writes).length) await area.set(writes);
  if (retired.length) await area.remove(retired);
}
