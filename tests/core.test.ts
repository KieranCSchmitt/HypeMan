import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceHost,
  emptyWorkspace,
  parseWorkspace,
  safePageUrl,
  emptyLearningGraph,
  recordLearning,
  learningEstimate,
  parseLearningGraph,
  parseAgentRequest,
  parseAction,
  parseSettings,
  isPaused,
  type CompanionSnapshot,
  type WorkspaceStore,
  type AgentRequest,
} from "@core";
function memory(initial: unknown = emptyWorkspace()) {
  let stored = structuredClone(initial),
    failing = false;
  const store: WorkspaceStore = {
    load: async () => structuredClone(stored),
    save: vi.fn(async (next) => {
      if (failing) throw new Error("Storage full");
      await Promise.resolve();
      stored = structuredClone(next);
    }),
  };
  let sequence = 0,
    time = 1000;
  return {
    store,
    host: new WorkspaceHost(
      store,
      () => ++time,
      () => `id-${++sequence}`,
    ),
    fail: (value: boolean) => {
      failing = value;
    },
    persisted: () => structuredClone(stored) as CompanionSnapshot,
  };
}
const note = (text: string) => ({
  text,
  excerpt: "Original source excerpt",
  url: "https://example.com/workshop",
  title: "Workshop",
});
const milestones = ["Compare two workshops", "Prepare the selected registration"];
describe("durable task workspace", () => {
  it("serializes concurrent saves without dropping notes or task changes", async () => {
    const { host, persisted, store } = memory();
    const [first, a, b, second] = await Promise.all([
      host.start("Compare workshops", 1, undefined, milestones),
      host.saveNote(note("First fact")),
      host.saveNote(note("Second fact")),
      host.start("Another task", 2, undefined, milestones),
    ]);
    const state = await host.snapshot();
    expect(state.notes.map((item) => item.text)).toEqual(["First fact", "Second fact"]);
    expect(state.activeTaskId).toBe(second.id);
    expect(state.tasks.find((task) => task.id === first.id)?.status).toBe("paused");
    expect(state.tasks.filter((task) => task.status === "running")).toHaveLength(1);
    expect(persisted()).toEqual(state);
    expect(store.save).toHaveBeenCalledTimes(4);
    expect(a.id).not.toBe(b.id);
    state.notes[0].text = "mutated external copy";
    expect((await host.snapshot()).notes[0].text).toBe("First fact");
  });
  it("rolls back in-memory state on failed durable writes and allows later transactions", async () => {
    const { host, fail, persisted } = memory();
    const saved = await host.saveNote(note("Durable fact"));
    const before = await host.snapshot();
    fail(true);
    await expect(host.saveNote({ ...note("Rejected edit"), id: saved.id })).rejects.toThrow(
      "Storage full",
    );
    expect(await host.snapshot()).toEqual(before);
    expect(persisted()).toEqual(before);
    fail(false);
    await host.saveNote({ ...note("Successful edit"), id: saved.id });
    expect((await host.snapshot()).notes[0].text).toBe("Successful edit");
  });
  it("requires explicit resume after restart while preserving the last page and next step", async () => {
    const { host, store } = memory();
    const task = await host.start("Compare workshops", 4, {
      url: "https://example.com/start",
      title: "Start",
    }, milestones);
    await host.progress(
      {
        eventId: "verified-1",
        action: "click",
        summary: "Comparison opened",
        ok: true,
        changed: true,
        url: "https://example.com/compare",
        title: "Comparison",
      },
      4,
    );
    const restarted = new WorkspaceHost(store);
    await restarted.recover();
    const state = await restarted.snapshot();
    expect(state.activeTaskId).toBeNull();
    expect(state.tasks[0]).toMatchObject({
      status: "paused",
      tabId: null,
      lastPage: { url: "https://example.com/compare" },
      nextStep: milestones[0],
    });
    await restarted.resume(task.id, 8);
    expect((await restarted.snapshot()).tasks[0]).toMatchObject({ status: "running", tabId: 8 });
  });
  it("deduplicates verified action events and rejects events owned by a different tab or paused task", async () => {
    const { host } = memory();
    const task = await host.start("Workshop registration", 4, undefined, milestones);
    const event = {
      eventId: "same-action",
      taskId: task.id,
      action: "type",
      summary: "Prepared name",
      ok: true,
      changed: true,
      url: "https://example.com/form",
      title: "Form",
    };
    await host.progress(event, 4);
    await host.progress(event, 4);
    expect((await host.snapshot()).events).toHaveLength(1);
    await host.progress({ ...event, eventId: "wrong-owner", summary: "Foreign update" }, 99);
    const owned = await host.snapshot();
    expect(owned.events).toHaveLength(1);
    expect(owned.tasks[0].tabId).toBe(4);
    await host.pause();
    await host.progress({ ...event, eventId: "after-pause", done: true }, 4);
    expect((await host.snapshot()).tasks[0].status).toBe("paused");
  });
  it("requires every milestone to have its own completion evidence", async () => {
    const { host } = memory();
    const task = await host.start("Workshop", 2, undefined, milestones);
    await host.progress(
      {
        eventId: "failed",
        taskId: task.id,
        action: "finish",
        summary: "No confirmation",
        ok: false,
        done: true,
        url: "https://example.com",
        title: "Example",
      },
      2,
    );
    expect((await host.snapshot()).tasks[0].status).toBe("running");
    await host.progress(
      {
        eventId: "done",
        taskId: task.id,
        action: "finish",
        summary: "Registration confirmed",
        ok: true,
        done: true,
        url: "https://example.com",
        title: "Example",
      },
      2,
    );
    expect((await host.snapshot()).tasks[0].status).toBe("running");
    for (const step of task.steps) await host.completeStep({
      eventId: `complete-${step.id}`, taskId: task.id, stepId: step.id,
      source: "user", evidence: `User confirmed: ${step.title}`,
      url: "https://example.com", title: "Example",
    }, 2);
    const state = await host.snapshot();
    expect(state.tasks[0].status).toBe("completed");
    expect(state.activeTaskId).toBeNull();
    expect(state.tasks[0].steps.every((step) => step.status === "done")).toBe(true);
    await expect(host.resume(task.id, 2)).rejects.toThrow("cannot be resumed");
  });
  it("keeps note capture provenance and creation time through edits, export, and removal", async () => {
    const { host } = memory();
    const first = await host.saveNote(note("Price is $60"));
    const edited = await host.saveNote({ ...note("Price includes materials"), id: first.id });
    expect(edited).toMatchObject({
      id: first.id,
      createdAt: first.createdAt,
      url: first.url,
      title: first.title,
      excerpt: first.excerpt,
    });
    expect(edited.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(JSON.parse(JSON.stringify(await host.snapshot())).notes[0]).toEqual(edited);
    await host.removeNote(first.id);
    expect((await host.snapshot()).notes).toEqual([]);
    await expect(host.saveNote({ ...note("bad"), url: "javascript:alert(1)" })).rejects.toThrow();
  });
  it("sanitizes malformed persisted state and cannot restore multiple execution owners", () => {
    const { persisted } = memory();
    const base = {
      id: "a",
      goal: "goal",
      status: "running",
      steps: [],
      lastPage: { url: "javascript:alert(1)", title: "bad" },
      createdAt: Infinity,
      updatedAt: -1,
      tabId: "4",
    };
    const state = parseWorkspace({
      version: 1,
      activeTaskId: "a",
      tasks: [base, { ...base, id: "b" }, { id: "invalid" }],
      notes: [{ ...note("bad"), id: "x", url: "data:text/html,x" }],
      events: [{ id: "event", taskId: "a", action: "click", ok: "true" }],
    });
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks.filter((task) => task.status === "running")).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({
      lastPage: null,
      createdAt: 0,
      updatedAt: 0,
      tabId: null,
    });
    expect(state.notes).toEqual([]);
    expect(state.events).toEqual([]);
    expect(parseWorkspace({ version: 999, tasks: [base] })).toEqual(emptyWorkspace());
    expect(safePageUrl("https://user:secret@example.com/path")).toBe("https://example.com/path");
  });
});
describe("evidence-backed learning", () => {
  it("never promotes exposure or hints into demonstrated accuracy and deduplicates events", () => {
    let graph = emptyLearningGraph();
    for (let index = 0; index < 20; index++)
      graph = recordLearning(graph, {
        id: `view-${index}`,
        concept: "Fractions",
        kind: "exposure",
        at: index + 1,
      });
    const hint = { id: "hint", concept: "Fractions", kind: "hint" as const, at: 100 };
    graph = recordLearning(graph, hint);
    graph = recordLearning(graph, hint);
    expect(graph.nodes[0]).toMatchObject({ exposures: 20, hints: 1, attempts: 0 });
    expect(learningEstimate(graph.nodes[0])).toMatchObject({
      precision: null,
      retention: null,
      evidenceCount: 0,
    });
  });
  it("derives accuracy and spaced recall from actual attempts and grounded explanations", () => {
    let graph = emptyLearningGraph();
    for (let index = 0; index < 3; index++)
      graph = recordLearning(graph, {
        id: `attempt-${index}`,
        concept: "Fractions",
        kind: "attempt",
        correct: true,
        at: 1000 + index * 25 * 60 * 60 * 1000,
        evidence: "I divided both parts by two.",
      });
    graph = recordLearning(graph, {
      id: "explanation",
      concept: "Fractions",
      kind: "explanation",
      correct: true,
      at: graph.nodes[0].lastPractice + 1000,
      evidence: "Equal parts describe the same whole.",
    });
    const node = graph.nodes[0];
    expect(node).toMatchObject({ attempts: 3, correct: 3, recalls: 2, explanations: 1 });
    expect(learningEstimate(node, node.lastPractice)).toMatchObject({
      precision: 1,
      retention: 1,
      evidenceCount: 4,
    });
    expect(learningEstimate(node, node.lastPractice + 100 * 86400000).due).toBe(true);
    expect(graph.nodes[0].evidence).toContain("Equal parts describe the same whole.");
  });
  it.each([
    [12 * 60 * 60 * 1000, 0],
    [24 * 60 * 60 * 1000 - 1, 0],
    [24 * 60 * 60 * 1000, 1],
    [24 * 60 * 60 * 1000 + 1, 1],
  ])("counts a successful retrieval after %i milliseconds away as %i recalls", (gap, recalls) => {
    const first = recordLearning(emptyLearningGraph(), {
      id: "first",
      concept: "Fractions",
      kind: "attempt",
      correct: true,
      at: 1000,
    });
    const returned = recordLearning(first, {
      id: "return",
      concept: "Fractions",
      kind: "attempt",
      correct: true,
      at: 1000 + gap,
    });
    expect(first.nodes[0].recalls).toBe(0);
    expect(returned.nodes[0]).toMatchObject({ attempts: 2, correct: 2, recalls });
  });
  it("does not count a failed return or its immediate correction as a daily retrieval", () => {
    let graph = recordLearning(emptyLearningGraph(), {
      id: "first",
      concept: "Fractions",
      kind: "attempt",
      correct: true,
      at: 1000,
    });
    graph = recordLearning(graph, {
      id: "failed-return",
      concept: "Fractions",
      kind: "attempt",
      correct: false,
      at: 1000 + 24 * 60 * 60 * 1000,
    });
    graph = recordLearning(graph, {
      id: "corrected",
      concept: "Fractions",
      kind: "attempt",
      correct: true,
      at: 2000 + 24 * 60 * 60 * 1000,
    });
    expect(graph.nodes[0]).toMatchObject({ attempts: 3, correct: 2, recalls: 0 });
  });
  it("preserves a canonical HypeMan graph and its retention estimate after loading", () => {
    const graph = recordLearning(emptyLearningGraph(), {
      id: "saved-attempt",
      concept: "Fractions",
      kind: "attempt",
      correct: true,
      at: 1000,
      evidence: "I divided both parts by two.",
    });
    Object.assign(graph.nodes[0], { attempts: 4, correct: 3, recalls: 2, explanations: 1 });
    graph.plans.push({
      id: "saved-plan",
      goal: "Practice fractions",
      steps: [{ title: "Compare equal parts", concept: "Fractions", done: true }],
      createdAt: 1000,
    });
    const restored = parseLearningGraph(JSON.parse(JSON.stringify(graph)));
    expect(restored).toEqual(graph);
    expect(learningEstimate(restored.nodes[0], 1000 + 24 * 60 * 60 * 1000))
      .toEqual(learningEstimate(graph.nodes[0], 1000 + 24 * 60 * 60 * 1000));
    expect(recordLearning(restored, {
      id: "saved-attempt", concept: "Fractions", kind: "attempt", correct: true, at: 1000,
    })).toEqual(graph);
  });
  it.each([
    { nodes: [] },
    { version: 2, nodes: [] },
    { version: "1", nodes: [] },
    { version: 1, nodes: { fractions: { label: "Fractions", attempts: 2 } } },
  ])("rejects an unsupported learning snapshot: %j", (snapshot) => {
    expect(parseLearningGraph(snapshot)).toEqual(emptyLearningGraph());
  });
  it("constrains corrupt counters in a HypeMan version 1 snapshot", () => {
    const graph = parseLearningGraph({
      version: 1,
      nodes: [
        {
          label: "Fractions",
          exposures: 100,
          attempts: 2,
          correct: 99,
          recalls: Infinity,
          evidence: ["Seen in a source", null],
        },
      ],
    });
    expect(graph.nodes[0]).toMatchObject({
      label: "Fractions",
      correct: 2,
      recalls: 0,
      evidence: ["Seen in a source"],
    });
  });
});
describe("wire and preference validation", () => {
  const input: AgentRequest = {
    requestId: "parse-test",
    goal: "Read the page",
    message: "Read the page",
    mode: "browse",
    history: [],
    page: {
      url: "https://example.com",
      title: "Example",
      text: "Public content",
      headings: [],
      elements: [
        {
          id: "sensitive",
          role: "textbox",
          name: "Password",
          tag: "input",
          sensitive: true,
          disabled: false,
          value: "secret",
          rect: { x: 0, y: 0, width: 20, height: 10 },
        },
      ],
      errors: [],
      successes: [],
      selection: "",
      frames: { count: 0, inaccessible: 0 },
      capturedAt: 10,
      revision: 1,
    },
  };
  it("redacts sensitive field values and rejects malformed messages and target IDs", () => {
    expect(parseAgentRequest(input)?.page.elements[0]).not.toHaveProperty("value");
    expect(
      parseAgentRequest({
        ...input,
        page: { ...input.page, elements: [...input.page.elements, ...input.page.elements] },
      }),
    ).toBeNull();
    expect(
      parseAgentRequest({ ...input, history: [{ action: { type: "click", target: 5 } }] }),
    ).toBeNull();
    expect(parseAgentRequest({})).toBeNull();
    expect(parseAction({ type: "navigate", url: "javascript:alert(1)" })).toBeNull();
    expect(parseAction({ type: "type", target: "", text: "bad" })).toBeNull();
  });
  it("accepts bounded explicit screenshots and rejects non-image or oversized context", () => {
    const screenshot = "data:image/png;base64,YQ==";
    expect(parseAgentRequest({ ...input, screenshot })?.screenshot).toBe(screenshot);
    expect(parseAgentRequest({ ...input, screenshot: "https://example.com/image.png" })).toBeNull();
    expect(
      parseAgentRequest({ ...input, screenshot: "data:image/svg+xml;base64,YQ==" }),
    ).toBeNull();
    expect(
      parseAgentRequest({ ...input, screenshot: "data:image/png;base64," + "A".repeat(2_000_000) }),
    ).toBeNull();
  });
  it("keeps settings local and makes paused-site checks explicit", () => {
    const settings = parseSettings({
      serverUrl: "https://attacker.example",
      hiddenOnHosts: ["EXAMPLE.COM", "example.com", "javascript:bad"],
      learningEnabled: "true",
      reducedMotion: "on",
      unexpected: true,
    });
    expect(settings).not.toHaveProperty("unexpected");
    expect(settings.serverUrl).toBe("http://localhost:8787");
    expect(settings.learningEnabled).toBe(false);
    expect(settings.hiddenOnHosts).toEqual(["example.com"]);
    expect(isPaused(settings, "https://example.com/page")).toBe(true);
    expect(settings.reducedMotion).toBe("on");
  });

});

describe("conversation tool contract", () => {
  it("allows named local tool operations without arbitrary execution", () => {
    expect(parseAction({ type: "tool", tool: "board", operation: "add", args: { objects: [{ kind: "equation", text: "x=2", x: 30, y: 60 }] } })?.type).toBe("tool");
    expect(parseAction({ type: "tool", tool: "browser", operation: "evaluate", args: { code: "alert(1)" } })).toBeNull();
    expect(parseAction({ type: "tool", tool: "phone", operation: "sendTo", args: { recipient: "someone" } })).toBeNull();
    expect(parseAction({ type: "tool", tool: "board", operation: "add", args: { text: "x".repeat(60001) } })).toBeNull();
  });
  it("preserves conversation and PDF note provenance without fake URLs", () => {
    const state = parseWorkspace({ version: 1, notes: [
      { id: "n1", text: "A useful explanation", url: "", origin: { kind: "conversation", conversationId: "chat-1" } },
      { id: "n2", text: "Document excerpt", excerpt: "Exact passage", url: "", origin: { kind: "document", conversationId: "chat-1", documentId: "pdf-1", page: 3 } },
      { id: "bad", text: "No source", url: "" },
    ] });
    expect(state.notes.map((note) => note.id)).toEqual(["n1", "n2"]);
    expect(state.notes[1]?.origin?.page).toBe(3);
    expect(state.notes.every((note) => note.url === "")).toBe(true);
  });
});
