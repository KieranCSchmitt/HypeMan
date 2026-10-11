// Canonical HypeMan settings; the worker validates imported local records.
export const SETTINGS_KEY = "hypeman.settings";
export const AVATAR_SKINS = ["hypeman", "glitch", "rally", "orbit", "breeze", "spark"] as const;
export type AvatarSkin = (typeof AVATAR_SKINS)[number];
export interface Settings {
  version: 2;
  serverUrl: string;
  serverToken: string;
  proactiveEnabled: boolean;
  learningEnabled: boolean;
  screenshotEnabled: boolean;
  tabContextEnabled: boolean;
  trustedInput: boolean;
  hiddenOnHosts: string[];
  reducedMotion: "auto" | "on" | "off";
  avatarSkin: AvatarSkin;
  videoCompanion: "ask" | "on" | "off";
  onboarded: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  serverUrl: "http://localhost:8787",
  serverToken: "",
  proactiveEnabled: false,
  learningEnabled: false,
  screenshotEnabled: false,
  tabContextEnabled: false,
  trustedInput: false,
  hiddenOnHosts: [],
  reducedMotion: "auto",
  avatarSkin: "hypeman",
  videoCompanion: "ask",
  onboarded: false,
};
export function parseSettings(value: unknown): Settings {
  const settings = { ...DEFAULT_SETTINGS, hiddenOnHosts: [] as string[] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return settings;
  const raw = value as Record<string, unknown>;
  if (AVATAR_SKINS.includes(raw.avatarSkin as AvatarSkin)) settings.avatarSkin = raw.avatarSkin as AvatarSkin;
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
