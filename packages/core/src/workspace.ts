/** User-owned task memory. Kept separate from the learner graph and model transcripts. */
export const WORKSPACE_KEY = "burrow.workspace";
export type TaskStatus = "running" | "paused" | "completed" | "cancelled";
export interface TaskStep {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
}
export interface BrowserTask {
  id: string;
  goal: string;
  status: TaskStatus;
  steps: TaskStep[];
  lastPage: { url: string; title: string } | null;
  nextStep: string;
  createdAt: number;
  updatedAt: number;
  tabId: number | null;
}
export interface SourceNote {
  id: string;
  text: string;
  excerpt: string;
  url: string;
  title: string;
  taskId?: string;
  createdAt: number;
  updatedAt: number;
}
export interface TaskActionEvent {
  id: string;
  taskId: string;
  at: number;
  action: string;
  summary: string;
  ok: boolean;
  url: string;
}
export interface CompanionSnapshot {
  version: 1;
  tasks: BrowserTask[];
  notes: SourceNote[];
  events: TaskActionEvent[];
  activeTaskId: string | null;
}
export interface TaskProgress {
  eventId: string;
  taskId?: string;
  action: string;
  summary: string;
  ok: boolean;
  url: string;
  title: string;
  done?: boolean;
  changed?: boolean;
}
export interface NoteInput {
  id?: string;
  text: string;
  excerpt: string;
  url: string;
  title: string;
  taskId?: string;
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const stamp = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
export function safePageUrl(value: unknown): string {
  try {
    const url = new URL(str(value, 4096));
    if (!/^https?:$/.test(url.protocol)) return "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return "";
  }
}
export const emptyWorkspace = (): CompanionSnapshot => ({
  version: 1,
  tasks: [],
  notes: [],
  events: [],
  activeTaskId: null,
});

/** Validate persisted/imported data before it can become executable state. */
export function parseWorkspace(value: unknown): CompanionSnapshot {
  const clean = emptyWorkspace();
  if (!record(value) || value.version !== 1) return clean;
  for (const raw of (Array.isArray(value.tasks) ? value.tasks : []).slice(-100)) {
    if (!record(raw) || !str(raw.id, 100) || !str(raw.goal, 2000)) continue;
    const status = raw.status;
    if (
      status !== "running" &&
      status !== "paused" &&
      status !== "completed" &&
      status !== "cancelled"
    )
      continue;
    const steps: TaskStep[] = (Array.isArray(raw.steps) ? raw.steps : [])
      .filter(record)
      .slice(0, 20)
      .map(
        (step, i): TaskStep => ({
          id: str(step.id, 100) || `step-${i}`,
          title: str(step.title, 200),
          status: step.status === "done" ? "done" : step.status === "doing" ? "doing" : "todo",
        }),
      )
      .filter((s) => s.title);
    const page = record(raw.lastPage) ? safePageUrl(raw.lastPage.url) : "";
    clean.tasks.push({
      id: str(raw.id, 100),
      goal: str(raw.goal, 2000),
      status,
      steps,
      lastPage:
        page && record(raw.lastPage) ? { url: page, title: str(raw.lastPage.title, 300) } : null,
      nextStep: str(raw.nextStep, 300),
      createdAt: stamp(raw.createdAt),
      updatedAt: stamp(raw.updatedAt),
      tabId: Number.isInteger(raw.tabId) && Number(raw.tabId) >= 0 ? Number(raw.tabId) : null,
    });
  }
  clean.tasks = [...new Map(clean.tasks.map((t) => [t.id, t])).values()];
  for (const raw of (Array.isArray(value.notes) ? value.notes : []).slice(-500)) {
    if (!record(raw) || !str(raw.id, 100) || !str(raw.text, 4000) || !safePageUrl(raw.url))
      continue;
    clean.notes.push({
      id: str(raw.id, 100),
      text: str(raw.text, 4000),
      excerpt: str(raw.excerpt, 4000),
      url: safePageUrl(raw.url),
      title: str(raw.title, 300),
      ...(str(raw.taskId, 100) ? { taskId: str(raw.taskId, 100) } : {}),
      createdAt: stamp(raw.createdAt),
      updatedAt: stamp(raw.updatedAt),
    });
  }
  clean.notes = [...new Map(clean.notes.map((n) => [n.id, n])).values()];
  for (const raw of (Array.isArray(value.events) ? value.events : []).slice(-1000)) {
    if (
      !record(raw) ||
      !str(raw.id, 160) ||
      !str(raw.taskId, 100) ||
      !str(raw.action, 80) ||
      typeof raw.ok !== "boolean"
    )
      continue;
    clean.events.push({
      id: str(raw.id, 160),
      taskId: str(raw.taskId, 100),
      at: stamp(raw.at),
      action: str(raw.action, 80),
      summary: str(raw.summary, 500),
      ok: raw.ok,
      url: safePageUrl(raw.url),
    });
  }
  clean.events = [...new Map(clean.events.map((e) => [e.id, e])).values()];
  // A corrupt snapshot cannot give multiple tasks execution ownership.
  const active = clean.tasks.find((t) => t.id === value.activeTaskId && t.status === "running");
  clean.activeTaskId = active?.id ?? null;
  for (const task of clean.tasks)
    if (task.status === "running" && task !== active) task.status = "paused";
  return clean;
}

export function taskSteps(goal: string): TaskStep[] {
  const titles = /workshop/i.test(goal)
    ? [
        "Compare workshops under the budget",
        "Open the selected workshop",
        "Prepare registration",
        "Confirm registration",
      ]
    : ["Understand the page", "Work through the task", "Verify the result"];
  return titles.map(
    (title, i): TaskStep => ({ id: `step-${i + 1}`, title, status: i === 0 ? "doing" : "todo" }),
  );
}

export interface WorkspaceStore {
  load(): Promise<unknown>;
  save(value: CompanionSnapshot): Promise<void>;
}
/** Serial transactions: acknowledge only after durable save, never lose a concurrent note or task. */
export class WorkspaceHost {
  private state: CompanionSnapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private store: WorkspaceStore,
    private now = Date.now,
    private id: () => string = () => crypto.randomUUID(),
  ) {}
  private transaction<T>(fn: (state: CompanionSnapshot) => T, write = true): Promise<T> {
    const operation = this.queue.then(async () => {
      const current = this.state ?? parseWorkspace(await this.store.load());
      const next = structuredClone(current);
      const result = fn(next);
      if (write) await this.store.save(next);
      this.state = next;
      return structuredClone(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  snapshot(): Promise<CompanionSnapshot> {
    return this.transaction((s) => s, false);
  }
  recover(): Promise<void> {
    return this.transaction((s) => {
      for (const t of s.tasks)
        if (t.status === "running") {
          t.status = "paused";
          t.updatedAt = this.now();
          t.tabId = null;
        }
      s.activeTaskId = null;
    });
  }
  start(
    goal: string,
    tabId: number | null,
    page?: { url: string; title: string },
  ): Promise<BrowserTask> {
    goal = str(goal, 2000);
    if (!goal) return Promise.reject(new Error("Describe a task first."));
    return this.transaction((s) => {
      for (const t of s.tasks) if (t.status === "running") t.status = "paused";
      const steps = taskSteps(goal);
      const t: BrowserTask = {
        id: this.id(),
        goal,
        status: "running",
        steps,
        lastPage:
          page && safePageUrl(page.url)
            ? { url: safePageUrl(page.url), title: str(page.title, 300) }
            : null,
        nextStep: steps[0].title,
        createdAt: this.now(),
        updatedAt: this.now(),
        tabId,
      };
      s.tasks = [...s.tasks.slice(-99), t];
      s.activeTaskId = t.id;
      return t;
    });
  }
  resume(id: string, tabId: number | null): Promise<BrowserTask> {
    return this.transaction((s) => {
      const task = s.tasks.find((t) => t.id === id);
      if (!task || task.status === "completed" || task.status === "cancelled")
        throw new Error("This task cannot be resumed.");
      for (const t of s.tasks) if (t.status === "running") t.status = "paused";
      task.status = "running";
      task.tabId = tabId;
      task.updatedAt = this.now();
      s.activeTaskId = id;
      return task;
    });
  }
  pause(id?: string, cancel = false): Promise<void> {
    return this.transaction((s) => {
      const task = s.tasks.find((t) => t.id === (id ?? s.activeTaskId));
      if (!task || task.status === "completed" || task.status === "cancelled") return;
      task.status = cancel ? "cancelled" : "paused";
      task.updatedAt = this.now();
      if (s.activeTaskId === task.id) s.activeTaskId = null;
    });
  }
  intent(taskId: string, tabId: number | null, nextStep: string): Promise<void> {
    return this.transaction((s) => {
      const task = s.tasks.find(
        (t) =>
          t.id === taskId && t.id === s.activeTaskId && t.status === "running" && t.tabId === tabId,
      );
      if (!task) throw new Error("This tab does not own the task.");
      task.nextStep = str(nextStep, 300);
      task.updatedAt = this.now();
    });
  }
  progress(event: TaskProgress, tabId: number | null): Promise<void> {
    return this.transaction((s) => {
      if (!event.eventId || s.events.some((e) => e.id === event.eventId)) return;
      const task = s.tasks.find((t) => t.id === (event.taskId ?? s.activeTaskId));
      if (!task || task.id !== s.activeTaskId || task.status !== "running" || task.tabId !== tabId)
        return;
      const url = safePageUrl(event.url);
      if (url) task.lastPage = { url, title: str(event.title, 300) };
      task.tabId = tabId;
      task.updatedAt = this.now();
      s.events = [
        ...s.events.slice(-999),
        {
          id: str(event.eventId, 160),
          taskId: task.id,
          at: this.now(),
          action: str(event.action, 80),
          summary: str(event.summary, 500),
          ok: event.ok === true,
          url,
        },
      ];
      if (event.done && event.ok) {
        task.status = "completed";
        task.steps.forEach((step) => (step.status = "done"));
        task.nextStep = "Completed";
        s.activeTaskId = null;
      } else if (event.ok && event.changed) {
        // An input event alone is not evidence that a whole planned step was completed.
        // Keep the plan open until the result is verified, and retain the latest evidence.
        task.nextStep = `Last verified: ${str(event.summary, 260)}`;
      }
    });
  }
  saveNote(input: NoteInput): Promise<SourceNote> {
    if (!str(input.text, 4000) || !safePageUrl(input.url))
      return Promise.reject(new Error("A note needs text and an http(s) source."));
    return this.transaction((s) => {
      const previous = input.id ? s.notes.find((n) => n.id === input.id) : undefined;
      if (input.id && !previous) throw new Error("Note no longer exists.");
      const note: SourceNote = {
        id: previous?.id ?? this.id(),
        text: str(input.text, 4000),
        excerpt: str(input.excerpt, 4000),
        url: safePageUrl(input.url),
        title: str(input.title, 300),
        ...(input.taskId ? { taskId: str(input.taskId, 100) } : {}),
        createdAt: previous?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      s.notes = [...s.notes.filter((n) => n.id !== note.id).slice(-499), note];
      return note;
    });
  }
  removeNote(id: string): Promise<void> {
    return this.transaction((s) => {
      s.notes = s.notes.filter((n) => n.id !== id);
    });
  }
}
