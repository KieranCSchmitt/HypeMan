// Canonical HypeMan settings; the worker validates imported local records.
export const SETTINGS_KEY = "hypeman.settings";
export interface Settings {
  version: 2;
  serverUrl: string;
  serverToken: string;
  characterName: string;
  character: string;
  proactiveEnabled: boolean;
  learningEnabled: boolean;
  screenshotEnabled: boolean;
  tabContextEnabled: boolean;
  trustedInput: boolean;
  hiddenOnHosts: string[];
  reducedMotion: "auto" | "on" | "off";
  videoCompanion: "ask" | "on" | "off";
  onboarded: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  serverUrl: "http://localhost:8787",
  serverToken: "",
  characterName: "HypeMan",
  character: "hypeman",
  proactiveEnabled: true,
  learningEnabled: false,
  screenshotEnabled: false,
  tabContextEnabled: false,
  trustedInput: false,
  hiddenOnHosts: [],
  reducedMotion: "auto",
  videoCompanion: "ask",
  onboarded: false,
};
export function parseSettings(value: unknown): Settings {
  const settings = { ...DEFAULT_SETTINGS, hiddenOnHosts: [] as string[] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return settings;
  const raw = value as Record<string, unknown>;
  for (const key of [
    "proactiveEnabled",
    "learningEnabled",
    "screenshotEnabled",
    "tabContextEnabled",
    "trustedInput",
    "onboarded",
  ] as const)
    if (typeof raw[key] === "boolean") settings[key] = raw[key];
  if (typeof raw.serverUrl === "string") {
    try {
      const u = new URL(raw.serverUrl);
      if (/^https?:$/.test(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
        settings.serverUrl = u.origin;
    } catch {
      /* local default */
    }
  }
  if (typeof raw.serverToken === "string")
    settings.serverToken = raw.serverToken.trim().slice(0, 512);
  if (typeof raw.characterName === "string" && raw.characterName.trim()) {
    const name = raw.characterName.trim().slice(0, 60);
    settings.characterName = name;
  }
  if (typeof raw.character === "string" && /^(hypeman|custom:[a-zA-Z0-9_-]+)$/.test(raw.character))
    settings.character = raw.character;
  if (raw.reducedMotion === "auto" || raw.reducedMotion === "on" || raw.reducedMotion === "off")
    settings.reducedMotion = raw.reducedMotion;
  if (raw.videoCompanion === "ask" || raw.videoCompanion === "on" || raw.videoCompanion === "off")
    settings.videoCompanion = raw.videoCompanion;
  if (Array.isArray(raw.hiddenOnHosts))
    settings.hiddenOnHosts = [
      ...new Set(
        raw.hiddenOnHosts
          .filter((v): v is string => typeof v === "string" && /^[\w.-]+(?::\d+)?$/.test(v))
          .map((v) => v.toLowerCase()),
      ),
    ].slice(0, 500);
  return settings;
}
export function isPaused(settings: Settings, url: string): boolean {
  try {
    return settings.hiddenOnHosts.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}
