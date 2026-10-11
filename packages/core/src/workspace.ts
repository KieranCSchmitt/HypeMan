/** User-owned task memory. Kept separate from the learner graph and model transcripts. */
export const WORKSPACE_KEY = "hypeman.workspace";
export type TaskStatus = "running" | "paused" | "completed" | "cancelled";
export interface TaskStep {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  completion?: {
    source: "page" | "user";
    evidence: string;
    url: string;
    at: number;
  };
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
  stepId?: string;
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
/** A verified outcome for one current milestone, rather than a generic action result. */
export interface TaskMilestoneProgress {
  eventId: string;
  taskId: string;
  stepId: string;
  source: "page" | "user";
  evidence: string;
  url: string;
  title: string;
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
export function parseTaskMilestoneProgress(value: unknown): TaskMilestoneProgress | null {
  if (!record(value)) return null;
  const bounded = (v: unknown, max: number, empty = false): v is string =>
    typeof v === "string" && v.length <= max && (empty || v.trim().length > 0);
  if (
    !bounded(value.eventId, 160) ||
    !bounded(value.taskId, 100) ||
    !bounded(value.stepId, 100) ||
    (value.source !== "page" && value.source !== "user") ||
    !bounded(value.evidence, 1000) ||
    !bounded(value.url, 4096, true) ||
    !bounded(value.title, 300, true)
  )
    return null;
  const url = safePageUrl(value.url);
  if ((value.source === "page" || value.url.trim()) && !url) return null;
  return {
    eventId: value.eventId.trim(),
    taskId: value.taskId.trim(),
    stepId: value.stepId.trim(),
    source: value.source,
    evidence: value.evidence.trim(),
    url,
    title: value.title.trim(),
  };
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
      .map((step, i): TaskStep => {
        const completion = record(step.completion) ? step.completion : null;
        const evidence = completion ? str(completion.evidence, 1000) : "";
        const url = completion ? safePageUrl(completion.url) : "";
        const validCompletion = completion && evidence &&
          (completion.source === "user" || (completion.source === "page" && url));
        return {
          id: str(step.id, 100) || `step-${i}`,
          title: str(step.title, 200),
          status: step.status === "done" ? "done" : step.status === "doing" ? "doing" : "todo",
          ...(step.status === "done" && validCompletion ? {
            completion: {
              source: completion.source as "page" | "user",
              evidence,
              url,
              at: stamp(completion.at),
            },
          } : {}),
        };
      })
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
      ...(str(raw.stepId, 100) ? { stepId: str(raw.stepId, 100) } : {}),
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

/** No default plan: a durable task must represent at least two distinct milestones. */
export function taskSteps(titles: readonly string[]): TaskStep[] {
  if (
    !Array.isArray(titles) || titles.length < 2 || titles.length > 20 ||
    !titles.every((title) => typeof title === "string" && title.trim() && title.length <= 200)
  )
    throw new Error("A project needs at least two explicit milestones.");
  const clean = titles.map((title) => title.trim().replace(/\s+/g, " "));
  if (new Set(clean.map((title) => title.toLocaleLowerCase())).size !== clean.length)
    throw new Error("Project milestones must describe distinct outcomes.");
  return clean.map(
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
    plan?: string[],
  ): Promise<BrowserTask> {
    goal = str(goal, 2000);
    if (!goal) return Promise.reject(new Error("Describe a task first."));
    let steps: TaskStep[];
    try {
      steps = taskSteps(plan ?? []);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.transaction((s) => {
      for (const t of s.tasks) if (t.status === "running") t.status = "paused";
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
  intent(taskId: string, tabId: number | null, _nextAction: string): Promise<void> {
    return this.transaction((s) => {
      const task = s.tasks.find(
        (t) =>
          t.id === taskId && t.id === s.activeTaskId && t.status === "running" && t.tabId === tabId,
      );
      if (!task) throw new Error("This tab does not own the task.");
      task.nextStep = task.steps.find((step) => step.status !== "done")?.title ?? task.nextStep;
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
      // A successful action, or even an agent's "done", cannot prove a milestone.
      // Only completeStep can advance the plan using step-specific evidence.
    });
  }
  completeStep(input: TaskMilestoneProgress, tabId: number | null): Promise<BrowserTask> {
    const event = parseTaskMilestoneProgress(input);
    if (!event) return Promise.reject(new Error("A milestone needs valid completion evidence."));
    return this.transaction((s) => {
      const task = s.tasks.find((t) => t.id === event.taskId);
      const previous = s.events.find((e) => e.id === event.eventId);
      if (previous) {
        if (task && task.tabId === tabId && previous.taskId === task.id && previous.action === "milestone" &&
          previous.stepId === event.stepId)
          return task;
        throw new Error("This completion event belongs to a different action.");
      }
      if (!task || task.id !== s.activeTaskId || task.status !== "running" || task.tabId !== tabId)
        throw new Error("This tab does not own the running project.");
      const step = task.steps.find((candidate) => candidate.status !== "done");
      if (!step || step.id !== event.stepId || step.status !== "doing")
        throw new Error("Only the current project milestone can be completed.");
      const at = this.now();
      step.status = "done";
      step.completion = { source: event.source, evidence: event.evidence, url: event.url, at };
      task.updatedAt = at;
      if (event.url) task.lastPage = { url: event.url, title: event.title };
      s.events = [...s.events.slice(-999), {
        id: event.eventId,
        taskId: task.id,
        stepId: step.id,
        at,
        action: "milestone",
        summary: event.evidence.slice(0, 500),
        ok: true,
        url: event.url,
      }];
      const next = task.steps.find((candidate) => candidate.status !== "done");
      if (next) {
        next.status = "doing";
        task.nextStep = next.title;
      } else {
        task.status = "completed";
        task.nextStep = "Completed";
        s.activeTaskId = null;
      }
      return task;
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
