import { config as loadEnv } from "dotenv";
loadEnv({ quiet: true });
export interface GatewayConfig {
  port: number;
  demo: boolean;
  model: string;
  transcriptKey: string;
  deadlineMs: number;
}
const bounded = (value: string | undefined, fallback: number, min: number, max: number) =>
  value && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    port: Math.floor(bounded(env.PORT, 8787, 0, 65535)),
    demo: /^(1|true)$/i.test(env.DEMO_MODE ?? ""),
    model: env.CHATGPT_MODEL || env.LLM_MODEL || "gpt-6-astra",
    transcriptKey: env.SUPADATA_API_KEY || "",
    deadlineMs: bounded(env.REQUEST_DEADLINE_MS, 90_000, 1000, 300_000),
  };
}
