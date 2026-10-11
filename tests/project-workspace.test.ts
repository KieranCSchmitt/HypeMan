import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceHost,
  emptyWorkspace,
  parseTaskMilestoneProgress,
  parseWorkspace,
  taskSteps,
  type CompanionSnapshot,
  type TaskMilestoneProgress,
  type WorkspaceStore,
} from "@core";

function workspace() {
  let saved: CompanionSnapshot = emptyWorkspace();
  let time = 1_000;
  let sequence = 0;
  const store: WorkspaceStore = {
    load: async () => structuredClone(saved),
    save: vi.fn(async (value) => { saved = structuredClone(value); }),
  };
  const host = new WorkspaceHost(store, () => ++time, () => `task-${++sequence}`);
  return { host, store, saved: () => structuredClone(saved) };
}
const plan = ["Compare two workshops within the budget", "Prepare the selected registration"];
function outcome(taskId: string, stepId = "step-1", eventId = "outcome-1"): TaskMilestoneProgress {
  return {
    eventId,
    taskId,
    stepId,
    source: "page",
    evidence: "Two workshops compared: $45 and $60.",
    url: "https://example.com/compare",
    title: "Workshop comparison",
  };
}

describe("multi-step project workspace", () => {
  it("requires an explicit distinct multi-step plan without creating or pausing tasks on invalid requests", async () => {
    const { host, store } = workspace();
    const task = await host.start("Find and prepare a workshop", 7, undefined, plan);
    const before = await host.snapshot();
    for (const steps of [undefined, [], ["Explain this"], ["Research", " Research "]]) {
      await expect(host.start("Explain this", 7, undefined, steps)).rejects.toThrow(/milestones/);
      expect(await host.snapshot()).toEqual(before);
    }
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(task.steps.map((step) => step.title)).toEqual(plan);
    expect(task.steps.map((step) => step.status)).toEqual(["doing", "todo"]);
    expect(task.nextStep).toBe(plan[0]);
    await host.intent(task.id, 7, "Click the first search result");
    expect((await host.snapshot()).tasks[0].nextStep).toBe(plan[0]);
  });

  it("does not infer projects merely because a request contains workshop or task wording", async () => {
    const { host } = workspace();
    await expect(host.start("What does workshop mean?", 1)).rejects.toThrow();
    await expect(host.start("Summarize this task", 1)).rejects.toThrow();
    expect((await host.snapshot()).tasks).toEqual([]);
    expect(() => taskSteps(["", "Second outcome"])).toThrow();
    expect(() => taskSteps(["Same outcome", "same  outcome"])).toThrow();
    expect(() => taskSteps(["x".repeat(201), "Second outcome"])).toThrow();
    expect(() => taskSteps(Array.from({ length: 21 }, (_, index) => `Outcome ${index}`))).toThrow();
  });

  it("keeps ordinary action completion separate from project milestone evidence", async () => {
    const { host } = workspace();
    const task = await host.start("Find and prepare a workshop", 7, undefined, plan);
    await host.progress({
      eventId: "agent-finished",
      taskId: task.id,
      action: "finish",
      summary: "Looks done",
      ok: true,
      done: true,
      changed: true,
      url: "https://example.com",
      title: "Example",
    }, 7);
    const state = await host.snapshot();
    expect(state.tasks[0].status).toBe("running");
    expect(state.tasks[0].steps.map((step) => step.status)).toEqual(["doing", "todo"]);
    expect(state.tasks[0].nextStep).toBe(plan[0]);
    expect(state.activeTaskId).toBe(task.id);
    expect(state.events).toHaveLength(1);
  });

  it("advances exactly one milestone and persists its source evidence before finishing the final milestone", async () => {
    const { host, saved } = workspace();
    const task = await host.start("Find and prepare a workshop", 7, undefined, plan);
    const first = await host.completeStep(outcome(task.id), 7);
    expect(first.status).toBe("running");
    expect(first.steps.map((step) => step.status)).toEqual(["done", "doing"]);
    expect(first.steps[0].completion).toMatchObject({
      source: "page", evidence: outcome(task.id).evidence, url: "https://example.com/compare",
    });
    expect(first.nextStep).toBe(plan[1]);
    expect((await host.snapshot()).activeTaskId).toBe(task.id);
    expect(saved().tasks[0]).toEqual(first);
    const final = await host.completeStep({
      ...outcome(task.id, "step-2", "outcome-2"),
      source: "user", evidence: "I filled out the registration and am ready to review.",
    }, 7);
    expect(final.status).toBe("completed");
    expect(final.nextStep).toBe("Completed");
    expect(final.steps.every((step) => step.status === "done" && step.completion)).toBe(true);
    const state = await host.snapshot();
    expect(state.activeTaskId).toBeNull();
    expect(state.events.map((event) => [event.action, event.stepId])).toEqual([
      ["milestone", "step-1"], ["milestone", "step-2"],
    ]);
    expect(await host.completeStep({
      ...outcome(task.id, "step-2", "outcome-2"),
      source: "user", evidence: "I filled out the registration and am ready to review.",
    }, 7)).toEqual(final);
    expect((await host.snapshot()).events).toHaveLength(2);
  });

  it("deduplicates retries without advancing twice and rejects out-of-order or foreign-tab evidence", async () => {
    const { host } = workspace();
    const task = await host.start("Find and prepare a workshop", 7, undefined, plan);
    await expect(host.completeStep(outcome(task.id, "step-2"), 7)).rejects.toThrow(/current/);
    await expect(host.completeStep(outcome(task.id), 8)).rejects.toThrow(/own/);
    const first = await host.completeStep(outcome(task.id), 7);
    expect(await host.completeStep(outcome(task.id), 7)).toEqual(first);
    expect((await host.snapshot()).events).toHaveLength(1);
    await expect(host.completeStep(outcome(task.id, "step-2"), 7)).rejects.toThrow(/different action/);
    await host.pause();
    await expect(host.completeStep(outcome(task.id, "step-2", "after-pause"), 7)).rejects.toThrow(/running/);
  });

  it("retains milestone evidence across restart and requires resume for further progress", async () => {
    const { host, store } = workspace();
    const task = await host.start("Find and prepare a workshop", 7, undefined, plan);
    await host.completeStep(outcome(task.id), 7);
    const restarted = new WorkspaceHost(store);
    await restarted.recover();
    const paused = (await restarted.snapshot()).tasks[0];
    expect(paused.status).toBe("paused");
    expect(paused.nextStep).toBe(plan[1]);
    expect(paused.steps[0].completion?.evidence).toBe(outcome(task.id).evidence);
    await expect(restarted.completeStep(outcome(task.id, "step-2", "after-restart"), 7)).rejects.toThrow();
    await restarted.resume(task.id, 9);
    expect((await restarted.completeStep(outcome(task.id, "step-2", "after-restart"), 9)).status)
      .toBe("completed");
  });

  it("validates milestone messages and drops malformed persisted evidence while preserving legacy tasks", () => {
    const input = outcome("task-1");
    expect(parseTaskMilestoneProgress(input)).toEqual(input);
    for (const broken of [
      { ...input, evidence: " " }, { ...input, evidence: "x".repeat(1001) },
      { ...input, source: "model" }, { ...input, eventId: "" },
      { ...input, stepId: "" }, { ...input, taskId: 12 },
      { ...input, url: "javascript:alert(1)" }, { ...input, url: "" },
    ]) expect(parseTaskMilestoneProgress(broken)).toBeNull();
    expect(parseTaskMilestoneProgress({ ...input, source: "user", url: "" }))
      .toMatchObject({ source: "user", url: "" });
    const state = parseWorkspace({
      version: 1,
      activeTaskId: "legacy",
      tasks: [{
        id: "legacy", goal: "Legacy task", status: "running", tabId: 1,
        steps: [
          { id: "old-1", title: "Original first step", status: "done" },
          { id: "old-2", title: "Original second step", status: "doing", completion: input },
        ],
      }],
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].steps[0]).toEqual({ id: "old-1", title: "Original first step", status: "done" });
    expect(state.tasks[0].steps[1].completion).toBeUndefined();
  });
});
