import type { BrowserTask, SourceNote } from "./workspace";
import type { ToolAction, SelectedContent } from "./tools";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PageTarget {
  id: string;
  role: string;
  name: string;
  tag: string;
  value?: string;
  href?: string;
  disabled: boolean;
  sensitive: boolean;
  rect: Rect;
}
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
export interface VideoState {
  id: string;
  title: string;
  time: number;
  duration: number;
  paused: boolean;
  rate: number;
  segments?: TranscriptSegment[];
  chapters?: { start: number; title: string }[];
}
export interface PageSnapshot {
  url: string;
  title: string;
  headings: string[];
  text: string;
  elements: PageTarget[];
  errors: string[];
  successes: string[];
  selection: string;
  frames: { count: number; inaccessible: number };
  capturedAt: number;
  revision: number;
  video?: VideoState;
}
export type SketchShape =
  | { type: "line" | "arrow"; x: number; y: number; toX: number; toY: number }
  | { type: "circle"; x: number; y: number; radius: number }
  | { type: "label"; x: number; y: number; text: string };
export type Action =
  | ToolAction
  | { type: "say"; text: string }
  | { type: "point"; target: string; quote?: string }
  | { type: "click"; target: string; trusted?: boolean }
  | { type: "type"; target: string; text: string }
  | { type: "select"; target: string; value: string }
  | { type: "scroll"; target?: string; amount?: number }
  | { type: "navigate"; url: string; newTab?: boolean }
  | { type: "key"; key: string; target?: string }
  | { type: "video"; command: "play" | "pause" | "seek" | "speed"; value?: number }
  | { type: "sketch"; title: string; lines: string[]; shapes?: SketchShape[] }
  | { type: "plan"; goal: string; steps: string[] }
  | { type: "ask"; question: string }
  | { type: "finish"; summary: string }
  | { type: "note"; text: string; excerpt?: string }
  | { type: "wait"; ms: number }
  | {
      type: "pointer";
      command: "hover" | "doubleClick" | "rightClick" | "drag";
      target: string;
      toTarget?: string;
    }
  | { type: "switchTab"; tabId: number }
  | { type: "back" }
  | { type: "observe"; target?: string };
export interface ActionResult {
  ok: boolean;
  changed: boolean;
  message: string;
  error?: string;
  url?: string;
  navigation?: boolean;
}
export interface HistoryEntry {
  action: Action;
  result: ActionResult;
  at: number;
}
export interface AgentRequest {
  surface?: "conversation";
  conversationId?: string;
  toolContext?: { activeTool?: string | null; selected?: SelectedContent | null };
  /** Chat turns are separate from untrusted webpage text and verified browser actions. */
  conversation?: ConversationTurn[];
  clock?: { now: number; timezone: string };
  contextScope?: "conversation" | "page" | "selection" | "task";
  requestId: string;
  goal: string;
  message: string;
  page: PageSnapshot;
  history: HistoryEntry[];
  task?: BrowserTask | null;
  mode: "browse" | "learn";
  /** Source-backed findings captured on earlier pages in this project. */
  sources?: SourceNote[];
  screenshot?: string;
}
export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  at: number;
}
export interface AgentReply {
  contextScope?: AgentRequest["contextScope"];
  action: Action;
  say?: string;
  done?: boolean;
  /** Local denotes native browser commands, never local model inference. */
  provider: "demo" | "openai" | "local";
  error?: string;
}
/** Read-only assessment of the single current milestone in a durable project. */
export interface TaskAssessmentRequest {
  requestId: string;
  task: BrowserTask;
  page: PageSnapshot;
}
export interface TaskAssessment {
  completed: boolean;
  stepId: string;
  /** An exact visible page excerpt; empty when completion is not established. */
  evidence: string;
  next?: string;
}
export interface Capability {
  available: boolean;
  mode: "live" | "demo" | "unavailable" | "local";
  reason?: string;
}
export interface Health {
  ok: boolean;
  version: string;
  demoMode: boolean;
  authRequired: boolean;
  capabilities: Record<string, Capability>;
  error?: string;
}
/** Display-only account information. OAuth credentials stay in the local gateway. */
export interface ChatGPTProfile {
  id: string;
  label: string;
  email?: string;
  connected: boolean;
  sharing: boolean;
}
export interface ChatGPTStatus {
  connected: boolean;
  sharing: boolean;
  activeProfileId: string | null;
  profiles: ChatGPTProfile[];
  pending: boolean;
  error?: string;
  warning?: string;
  models?: { slug: string; displayName: string }[];
  model?: string;
}
export interface SessionHandoff {
  conversationId?: string;
  fromUrl?: string;
  action?: Action;
  taskId?: string | null;
  goal: string;
  history: HistoryEntry[];
  step: number;
  at?: number;
}
export interface RuntimeEvent {
  type: string;
  [key: string]: unknown;
}
