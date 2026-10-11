import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTaskAssessmentRequest, type TaskAssessmentRequest } from "@core";
import { assessTask, groundedAssessment } from "./task-assessment";
import { createGateway } from "./index";
import { loadConfig } from "./config";
import type { Providers } from "./providers";

const input = (): TaskAssessmentRequest => ({
  requestId: "assessment-1",
  task: {
    id: "project-1", goal: "Research sources then draft a report", status: "running",
    steps: [
      { id: "step-1", title: "Research sources", status: "doing" },
      { id: "step-2", title: "Draft a report", status: "todo" },
    ],
    lastPage: null, nextStep: "Research sources", tabId: 1, createdAt: 1, updatedAt: 1,
  },
  page: {
    url: "https://example.com/sources", title: "Sources", headings: ["Sources"],
    text: "Your source list has been saved. Three credible sources are attached to the project.",
    errors: [], successes: [], selection: "", elements: [], frames: { count: 0, inaccessible: 0 }, capturedAt: 2, revision: 3,
  },
});
const answer = { stepId: "step-1", completed: true, evidence: "Your source list has been saved." };

describe("read-only project progress", () => {
  it("accepts only a current milestone with a verbatim visible quote", async () => {
    const request = input();
    const signal = new AbortController().signal;
    const providers = { json: vi.fn(async () => ({ ...answer, next: "Ready to draft the report together?" })) } as unknown as Providers;
    expect(await assessTask(request, providers, false, signal)).toEqual({ ...answer, next: "Ready to draft the report together?" });
    expect(providers.json).toHaveBeenCalledTimes(1);
    const [instructions, context, usedSignal] = (providers.json as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(instructions).toContain("read-only");
    expect(context.current).toEqual({ id: "step-1", title: "Research sources" });
    expect(context.next).toBe("Draft a report");
    expect(usedSignal).toBe(signal);
  });
  it("refuses invented evidence, later milestones, actions, and malformed provider decisions", () => {
    const request = input();
    for (const value of [
      { ...answer, evidence: "The report has been published." },
      { ...answer, evidence: "saved" },
      { ...answer, evidence: "" },
      { ...answer, stepId: "step-2" },
      { ...answer, action: "click", target: "publish" },
      { ...answer, completed: "true" },
      { ...answer, next: { action: "navigate" } },
      { ...answer, completed: false },
      null,
    ]) expect(groundedAssessment(value, request)).toEqual({ stepId: "step-1", completed: false, evidence: "" });
    request.page.text = "The visible page has no confirmation.";
    request.page.successes = [answer.evidence];
    expect(groundedAssessment(answer, request).completed).toBe(false);
  });
  it("does not infer a consequential milestone from an old visible confirmation", async () => {
    const request = input();
    request.task.steps[0].title = "Confirm the workshop registration";
    request.page.text = "Registration confirmed";
    request.page.successes = [request.page.text];
    const providers = { json: vi.fn(async () => ({ ...answer, evidence: request.page.text })) } as unknown as Providers;
    expect(await assessTask(request, providers, false, new AbortController().signal)).toMatchObject({ completed: false });
    expect(providers.json).not.toHaveBeenCalled();
    expect(groundedAssessment({ ...answer, evidence: request.page.text }, request).completed).toBe(false);
  });
  it("requires the fresh observation to match both the milestone and the exact current source", async () => {
    const request = input();
    request.task.steps[0].title = "Confirm the workshop registration";
    request.page.text = "Registration confirmed. Changes saved successfully.";
    request.completion = { kind: "registration", evidence: "Registration confirmed.", url: request.page.url };
    const valid = { ...answer, evidence: "Registration confirmed." };
    expect(groundedAssessment(valid, request).completed).toBe(true);
    expect(groundedAssessment({ ...valid, evidence: "Changes saved successfully." }, request).completed).toBe(false);
    request.completion.kind = "account";
    expect(groundedAssessment(valid, request).completed).toBe(false);
    request.completion.kind = "registration";
    request.completion.url = "https://example.com/earlier-registration";
    expect(groundedAssessment(valid, request).completed).toBe(false);
  });
  it("keeps draft preparation separate from a consequential submission", () => {
    const request = input();
    request.task.steps[0].title = "Prepare the workshop registration";
    request.page.text = "Sample attendee: Alex Morgan · alex@example.com";
    expect(groundedAssessment({ ...answer, evidence: request.page.text }, request).completed).toBe(true);
  });
  it("refuses a same-kind receipt belonging to another named milestone subject", async () => {
    const request = input();
    request.task.steps[0].title = "Register for Pottery Basics";
    request.page.text = "Registration confirmed for Photography Workshop";
    request.completion = { kind: "registration", subject: "Photography Workshop", evidence: request.page.text, url: request.page.url };
    const providers = { json: vi.fn(async () => ({ ...answer, evidence: request.page.text })) } as unknown as Providers;
    expect(await assessTask(request, providers, false, new AbortController().signal)).toMatchObject({ completed: false });
    expect(providers.json).not.toHaveBeenCalled();
    request.completion.subject = "Pottery Basics";
    expect(groundedAssessment({ ...answer, evidence: request.page.text }, request).completed).toBe(false);
    request.page.text = request.completion.evidence = "Registration confirmed";
    expect(groundedAssessment({ ...answer, evidence: request.page.text }, request).completed).toBe(true);
    expect(parseTaskAssessmentRequest(request)?.completion?.subject).toBe("Pottery Basics");
  });
  it("does not assess paused, completed, or future milestones", () => {
    const request = input();
    request.task.status = "paused";
    expect(groundedAssessment(answer, request).completed).toBe(false);
    request.task.status = "running";
    request.task.steps[0].status = "todo";
    request.task.steps[1].status = "doing";
    expect(groundedAssessment(answer, request).completed).toBe(false);
  });
  it("propagates cancellation before and after model inference", async () => {
    const controller = new AbortController();
    const providers = { json: vi.fn(async () => { controller.abort(); return answer; }) } as unknown as Providers;
    await expect(assessTask(input(), providers, false, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(providers.json).toHaveBeenCalledTimes(1);
    await expect(assessTask(input(), providers, false, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(providers.json).toHaveBeenCalledTimes(1);
  });
  it("uses visible demo markers without treating ordinary live pages as fixtures", async () => {
    const request = input();
    request.page.url = "http://127.0.0.1:8787/demo/project/";
    request.page.text = "Project step completed: Research sources";
    const providers = { json: vi.fn() } as unknown as Providers;
    expect(await assessTask(request, providers, true, new AbortController().signal)).toEqual({
      stepId: "step-1", completed: true, evidence: request.page.text,
    });
    request.page.url = "https://example.com/project/";
    expect((await assessTask(request, providers, true, new AbortController().signal)).completed).toBe(false);
    expect(providers.json).not.toHaveBeenCalled();
  });
});

describe("project assessment request validation", () => {
  it("preserves a valid running project and sanitized top-frame page", () => {
    expect(parseTaskAssessmentRequest(input())).toEqual(input());
  });
  it("rejects malformed, non-project, out-of-order, and executable input", () => {
    const cases = [
      (r: any) => { r.action = { type: "click", target: "submit" }; },
      (r: any) => { r.requestId = ""; },
      (r: any) => { r.task.status = "paused"; },
      (r: any) => { r.task.steps.pop(); },
      (r: any) => { r.task.steps[1].id = "step-1"; },
      (r: any) => { r.task.steps[1].title = "Research sources"; },
      (r: any) => { r.task.steps[0].status = "todo"; r.task.steps[1].status = "doing"; },
      (r: any) => { r.task.steps[1].status = "doing"; },
      (r: any) => { r.page.url = "chrome://extensions"; },
      (r: any) => { r.page.url = "https://user:secret@example.com/"; },
      (r: any) => { r.page.text = "x".repeat(30_001); },
    ];
    for (const change of cases) {
      const request = input(); change(request);
      expect(parseTaskAssessmentRequest(request)).toBeNull();
    }
  });
});

const gateways: ReturnType<typeof createGateway>[] = [];
afterEach(async () => { await Promise.all(gateways.splice(0).map((gateway) => gateway.close())); });
async function start(assessor?: NonNullable<Parameters<typeof createGateway>[1]["assessTask"]>) {
  const gateway = createGateway(loadConfig({ DEMO_MODE: "1", PORT: "0" }), { token: "project-test-token", assessTask: assessor });
  gateways.push(gateway);
  const port = await gateway.listen();
  const post = (path: string, value: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer project-test-token" }, body: JSON.stringify(value),
  });
  return { post };
}
describe("project assessment HTTP boundary", () => {
  it("validates requests and grounds injectable assessor results before replying", async () => {
    const assessor = vi.fn(async () => answer);
    const { post } = await start(assessor);
    const valid = await post("/api/task/assess", input());
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual(answer);
    const malformed = { ...input(), task: { ...input().task, steps: [] } };
    expect((await post("/api/task/assess", malformed)).status).toBe(400);
    expect(assessor).toHaveBeenCalledTimes(1);
    assessor.mockResolvedValue({ ...answer, evidence: "Invented success marker" });
    const invalid = await post("/api/task/assess", input());
    expect(await invalid.json()).toEqual({ stepId: "step-1", completed: false, evidence: "" });
  });
  it("cancels read-only assessments through the shared request-id boundary", async () => {
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    let signal: AbortSignal | undefined;
    const { post } = await start(async (_input, activeSignal) => {
      signal = activeSignal;
      started();
      return new Promise((_resolve, reject) => activeSignal.addEventListener("abort", () => reject(activeSignal.reason), { once: true }));
    });
    const assessment = post("/api/task/assess", input());
    await waiting;
    expect((await post("/api/cancel", { requestId: "assessment-1" })).status).toBe(200);
    expect(signal?.aborted).toBe(true);
    expect((await assessment).status).toBe(499);
  });
});
