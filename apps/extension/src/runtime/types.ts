import type { Action, BrowserTask, RuntimeEvent, Settings, VideoState, ToolAction, SelectedContent, TranscriptSegment } from "@core";
export interface RuntimeApi {
  request<T = unknown>(
    message: { type: string; [key: string]: unknown },
    signal?: AbortSignal,
  ): Promise<T>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}
export interface RuntimeMessage {
  id: string;
  role: "user" | "assistant" | "status";
  text: string;
  at: number;
}
export interface CompanionSnapshot {
  conversationId?: string;
  phase: "idle" | "thinking" | "acting" | "confirming" | "paused" | "error";
  status: string;
  messages: RuntimeMessage[];
  confirmation: { message: string } | null;
  task: BrowserTask | null;
  video: (VideoState & { available?: boolean; summary?: string }) | null;
  learning: {
    enabled: boolean;
    hintLevel: number;
    plan: string[];
    teaching: { concept: string; heard: string } | null;
    /** Revealed assistance only. Speculative replies stay in the session cache. */
    autoHint: { id: string; text: string; kind?: "hint" | "explanation" } | null;
  };
  sketch: Extract<Action, { type: "sketch" }> | null;
  settings: Settings;
  reducedMotion: boolean;
  screenshotAttached: boolean;
}
export interface CompanionRuntime {
  setConversationId?(id: string): void;
  setToolHandler?(handler: ((action: ToolAction) => Promise<string | void>) | null): void;
  setSelectedContent?(selected: SelectedContent | null): void;
  attachImage?(image: string | null): void;
  attachVideoCaptions?(segments: TranscriptSegment[] | null): void;
  start(): Promise<void>;
  send(message: string): Promise<void>;
  confirm(answer: boolean): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CompanionSnapshot;
  setSettings(settings: Settings): void;
  pinSelection(text?: string): Promise<void>;
  attachScreenshot(image: string | null): void;
  teach(yes: boolean): void;
  suspend(): void;
  resume(): Promise<void>;
  dispose(): void;
}
