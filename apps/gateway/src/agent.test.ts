import { describe, expect, it, vi } from "vitest";
import type { AgentRequest, PageTarget } from "@core";
import { decide, demoDecision } from "./agent";
import type { Providers } from "./providers";
const target = (id: string, name: string, value?: string): PageTarget => ({
  id,
  name,
  value,
  role: value === undefined ? "button" : "textbox",
  tag: value === undefined ? "button" : "input",
  disabled: false,
  sensitive: false,
  rect: { x: 10, y: 10, width: 100, height: 30 },
});
const input = (
  path = "",
  message = "find a beginner workshop under $75, compare two options, prepare registration",
): AgentRequest => ({
  requestId: "test",
  goal: message,
  message,
  history: [],
  mode: "browse",
  page: {
    url: `http://127.0.0.1:8787/__test/workshops/${path}`,
    title: "Workshops",
    text: "Pottery Basics $60. Printmaking $70. Both beginner workshops.",
    elements: [target("compare", "Compare workshops")],
    headings: [],
    errors: [],
    successes: [],
    selection: "",
    frames: { count: 0, inaccessible: 0 },
    capturedAt: Date.now(),
    revision: 1,
  },
});
describe("explicit demonstration intent", () => {
  it("keeps summarize and point requests read-only even with an active registration goal", () => {
    const summary = input("register.html");
    summary.message = "summarize this page";
    expect(demoDecision(summary).action.type).toBe("say");
    const point = input();
    point.message = "where is Compare workshops";
    expect(demoDecision(point).action).toEqual({ type: "point", target: "compare" });
  });
  it("compares from the source before choosing, saves notes, then prepares known sample fields", () => {
    const comparison = input("compare.html");
    comparison.history = [{
      action: { type: "plan", goal: comparison.goal, steps: ["Compare workshops", "Prepare registration"] },
      result: { ok: true, changed: false, message: "Project planned" }, at: Date.now(),
    }];
    comparison.page.elements = [target("pottery", "Choose Pottery Basics")];
    const note = demoDecision(comparison).action;
    expect(note).toMatchObject({ type: "note", excerpt: comparison.page.text });
    comparison.history = [
      { action: note, result: { ok: true, changed: true, message: "Saved" }, at: Date.now() },
    ];
    expect(demoDecision(comparison).action).toEqual({ type: "click", target: "pottery" });
    const registration = input("register.html");
    registration.history = comparison.history;
    registration.page.elements = [
      target("name", "Full name", ""),
      target("email", "Email", ""),
      target("submit", "Submit registration"),
    ];
    expect(demoDecision(registration).action).toEqual({
      type: "type",
      target: "name",
      text: "Alex Morgan",
    });
    registration.page.elements[0].value = "Alex Morgan";
    registration.page.elements[1].value = "alex@example.com";
    expect(demoDecision(registration).action).toEqual({ type: "click", target: "submit" });
  });
  it("does not turn a comparison-only task into registration", () => {
    const comparison = input("compare.html", "compare beginner workshops under $75");
    comparison.history = [
      {
        action: { type: "note", text: "Workshop comparison: sources" },
        result: { ok: true, changed: true, message: "Saved" },
        at: Date.now(),
      },
    ];
    expect(demoDecision(comparison).action.type).toBe("finish");
  });
  it("waits at meaningful project milestones before preparing or submitting", () => {
    const comparison = input("compare.html");
    comparison.task = {
      id: "workshop-project", goal: comparison.goal, status: "running",
      steps: [
        { id: "step-1", title: "Compare two beginner workshops under $75", status: "doing" },
        { id: "step-2", title: "Prepare registration for the chosen workshop", status: "todo" },
        { id: "step-3", title: "Review and confirm the registration", status: "todo" },
      ],
      lastPage: null, nextStep: "Compare two beginner workshops under $75", tabId: 1, createdAt: 1, updatedAt: 1,
    };
    comparison.history = [{ action: { type: "note", text: "Workshop comparison: fixture" },
      result: { ok: true, changed: true, message: "Saved" }, at: 1 }];
    expect(demoDecision(comparison).action.type).toBe("ask");
    const registration = input("register.html");
    registration.task = structuredClone(comparison.task);
    registration.task.steps[0].status = "done";
    registration.task.steps[1].status = "doing";
    registration.page.elements = [target("name", "Full name", "Alex Morgan"), target("email", "Email", "alex@example.com"), target("submit", "Submit registration")];
    expect(demoDecision(registration).action.type).toBe("ask");
    registration.task.steps[1].status = "done";
    registration.task.steps[2].status = "doing";
    expect(demoDecision(registration).action).toEqual({ type: "click", target: "submit" });
  });
  it("increases learning support across requested hint rungs without solving the user's problem", () => {
    const request = input();
    request.mode = "learn";
    request.goal = "Solve 3x + 7 = 22";
    request.page.text = "Solve 3x + 7 = 22";
    const hints = [1, 2, 3, 4].map((rung) => {
      request.message = `Learning support rung ${rung} of 4: give the next hint`;
      const action = demoDecision(request).action;
      expect(action.type).toBe("say");
      return action.type === "say" ? action.text : "";
    });
    expect(new Set(hints).size).toBe(4);
    expect(hints[2]).toContain("2y + 4 = 10");
    expect(hints.join(" ")).not.toContain("x = 5");
  });
});
describe("project planning boundary", () => {
  it("repairs an invalid video discovery action once and validates the replacement before execution", async () => {
    const request = input("", "pull up a video to show me how to do this");
    request.page.title = "Missing subtraction";
    const json = vi.fn().mockResolvedValueOnce({ action: "video", command: "search", query: "missing subtraction" })
      .mockResolvedValueOnce({ action: "navigate", url: "https://www.youtube.com/results?search_query=missing%20subtraction", newTab: true, done: false });
    const result = await decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
    expect(result.action).toEqual({ type: "navigate", url: "https://www.youtube.com/results?search_query=missing%20subtraction", newTab: true });
    expect(json).toHaveBeenCalledTimes(2);
    expect(json.mock.calls[1][0]).toContain("nothing executed");
    expect(json.mock.calls[1][1]).toMatchObject({ message: request.message, page: { title: "Missing subtraction" } });
  });
  it("bounds invalid decision recovery to one repair and honors cancellation", async () => {
    const request = input("", "find a tutorial video");
    const json = vi.fn().mockResolvedValue({ action: "video", command: "search" });
    await expect(decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal)).rejects.toThrow("invalid browser action");
    expect(json).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); json.mockReset().mockImplementation(async () => { controller.abort(); return { action: "video", command: "search" }; });
    await expect(decide(request, { json, provider: "openai" } as unknown as Providers, false, controller.signal)).rejects.toBeDefined();
    expect(json).toHaveBeenCalledOnce();
  });
  it("plans real workshop outcomes once before browsing", () => {
    const request = input();
    const first = demoDecision(request);
    expect(first.action).toEqual({ type: "plan", goal: request.goal, steps: [
      "Compare two beginner workshops under $75",
      "Prepare registration for the chosen workshop",
      "Review and confirm the registration",
    ] });
    request.history = [{ action: first.action, result: { ok: true, changed: false, message: "Planned" }, at: 1 }];
    expect(demoDecision(request).action).toEqual({ type: "click", target: "compare" });
  });
  it("plans an explicit project after destination observation without repeating its saved plan", () => {
    const request = input();
    request.history = [{ action: { type: "observe" }, result: { ok: true, changed: false,
      message: "Destination page observed after browser dispatch", url: request.page.url }, at: 1 }];
    const first = demoDecision(request);
    expect(first.action).toMatchObject({ type: "plan", steps: [
      "Compare two beginner workshops under $75", "Prepare registration for the chosen workshop", "Review and confirm the registration",
    ] });
    request.history.push({ action: first.action, result: { ok: true, changed: false, message: "Project planned" }, at: 2 });
    expect(demoDecision(request).action).toEqual({ type: "click", target: "compare" });
  });
  it.each(["click Compare workshops", "summarize this page"])("does not plan ordinary assistance after arrival: %s", (message) => {
    const request = input("", message);
    request.history = [{ action: { type: "observe" }, result: { ok: true, changed: false,
      message: "Destination page observed after browser dispatch", url: request.page.url }, at: 1 }];
    expect(demoDecision(request).action.type).toBe(message.startsWith("click") ? "click" : "say");
  });
  it("does not restart project planning after a changed browser action", () => {
    const request = input();
    request.history = [{ action: { type: "click", target: "compare" }, result: { ok: true, changed: true, message: "Opened comparison" }, at: 1 }];
    expect(demoDecision(request).action.type).not.toBe("plan");
  });
  it("handles explicit non-learning projects even with learning preference enabled", () => {
    const request = input("", "Research source material then draft the report on Google Docs");
    request.mode = "learn";
    expect(demoDecision(request).action).toEqual({ type: "plan", goal: request.goal, steps: [
      "Research source material", "draft the report on Google Docs",
    ] });
  });
  it("leaves questions, explanations, single controls, and learning hints without projects", () => {
    for (const message of ["summarize this page", "where is Compare workshops", "click Compare workshops", "What is pottery?"]) {
      expect(demoDecision(input("", message)).action.type).not.toBe("plan");
    }
    const request = input("", "Learning support rung 1 of 4: give a hint");
    request.mode = "learn";
    expect(demoDecision(request).action.type).toBe("say");
  });
  it("does not turn repeated goals or internal browser work into milestone plans", async () => {
    const providers = { provider: "openai", json: vi.fn(async () => ({
      action: "plan", goal: "Open a page", steps: ["Understand the page", "Open the page", "Verify the result"], done: false,
    })) } as unknown as Providers;
    const reply = await decide(input("", "Open a page"), providers, false, new AbortController().signal);
    expect(reply.action.type).toBe("say");
    expect(providers.json).toHaveBeenCalledTimes(1);
  });
});
it("rejects malformed or stale provider actions before a browser can execute them", async () => {
  const providers = {
    provider: "openai",
    json: vi.fn(async () => ({ action: { type: "click", target: "missing" } })),
  } as unknown as Providers;
  await expect(
    decide(input(), providers, false, new AbortController().signal),
  ).rejects.toMatchObject({ code: "stale_target" });
  (providers.json as ReturnType<typeof vi.fn>).mockResolvedValue({
    action: {
      type: "sketch",
      title: "oops",
      lines: [],
      shapes: [{ type: "circle", x: "bad", y: 0 }],
    },
  });
  await expect(
    decide(input(), providers, false, new AbortController().signal),
  ).rejects.toMatchObject({ code: "invalid_provider_output" });
});
it("adapts flat provider decisions and keeps explicit screenshots outside textual history", async () => {
  const providers = {
    provider: "openai",
    json: vi.fn(async () => ({
      action: "click",
      target: "compare",
      say: "Opening the comparison.",
      done: false,
    })),
  } as unknown as Providers;
  const request = { ...input(), screenshot: "data:image/png;base64,YQ==" };
  const signal = new AbortController().signal;
  await expect(decide(request, providers, false, signal)).resolves.toEqual({
    action: { type: "click", target: "compare" },
    say: "Opening the comparison.",
    done: false,
    provider: "openai",
  });
  const [, context, usedSignal, image] = (providers.json as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(context).not.toHaveProperty("screenshot");
  expect(usedSignal).toBe(signal);
  expect(image).toBe(request.screenshot);
});

describe("browser outcome review", () => {
  const searched = (message: string): AgentRequest => {
    const request = input("", message);
    request.page = {
      ...request.page, url: "https://jobs.example/search?q=customer+support+remote+full+time&location=New+York",
      title: "Customer support jobs", text: "Customer support jobs in New York. Date posted. Job type.",
      elements: [target("date", "Date posted"), target("job", "Customer Support Associate")],
    };
    request.contextScope = "page";
    request.history = [{ action: { type: "navigate", url: request.page.url },
      result: { ok: true, changed: true, message: "Search results loaded", url: request.page.url }, at: 1 }];
    return request;
  };
  it("reviews a changed search before returning a claim that silently dropped a retained filter", async () => {
    const request = searched("Use that fallback: search customer support remote full time, keep New York and last 7 days. Open the best matching listing and tell me its pay, schedule and required experience. Don't apply.");
    request.conversation = [
      { role: "user", text: "Find full-time remote support jobs in New York, posted in the last 7 days.", at: 1 },
      { role: "assistant", text: "I will keep all your filters.", at: 2 },
    ];
    const proposed = { action: "say", text: "The filtered results are ready. Next: open a matching job.", done: true };
    const json = vi.fn().mockResolvedValueOnce(proposed)
      .mockResolvedValueOnce({ action: "click", target: "date", say: "Restoring the seven-day window before checking a listing.", done: false });
    const result = await decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
    expect(result).toMatchObject({ action: { type: "click", target: "date" }, done: false });
    expect(json).toHaveBeenCalledTimes(2);
    const [reviewInstructions, reviewContext] = json.mock.calls[1];
    expect(reviewInstructions).toContain("retained filters again after navigation");
    expect(reviewInstructions).toContain("actual listing/source facts already establish qualification");
    expect(reviewContext).toMatchObject({
      message: request.message, goal: request.goal, page: request.page, history: request.history,
      conversation: request.conversation, proposedReply: { action: { type: "say", text: proposed.text }, done: true },
    });
    // The gateway gives the next decision back to the browser; it never rewrites site URLs.
    expect(result.action.type).not.toBe("navigate");
  });
  it("keeps a completed comparison when source facts establish the constraints without filter controls", async () => {
    const request = searched("Compare two full-time remote New York support jobs posted in the last 7 days, including pay and required experience.");
    request.page.text = "A: Remote, New York, full-time, posted today, $25/hour, 0–1 years. B: Remote, New York, full-time, posted yesterday, $27/hour, no experience required.";
    request.page.elements = [];
    const proposed = { action: "say", text: "A pays $25/hour with 0–1 years; B pays $27/hour with no experience required. Both meet your location, remote, full-time and posting-window requirements.", done: true };
    const json = vi.fn().mockResolvedValue(proposed);
    const result = await decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
    expect(result).toMatchObject({ action: { type: "say", text: proposed.text }, done: true });
    expect(json).toHaveBeenCalledTimes(2);
  });
  it("checks finish claims too and carries date steering into a remaining comparison action", async () => {
    const request = searched("Actually return November 10. Keep nonstop both ways and depart after 9am. Show the two cheapest roundtrips; stop before booking.");
    request.page = { ...request.page, url: "https://travel.example/results", title: "Flights",
      text: "Option A: November 6–10, nonstop both ways, outbound 10am, $297. Another flight option.",
      elements: [target("other", "Another flight option")] };
    const json = vi.fn().mockResolvedValueOnce({ action: "finish", summary: "The updated flight comparison is complete.", done: true })
      .mockResolvedValueOnce({ action: "click", target: "other", done: false });
    const result = await decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
    expect(result).toMatchObject({ action: { type: "click", target: "other" }, done: false });
    expect(json.mock.calls[1][1]).toMatchObject({ message: request.message, page: request.page });
    expect(json).toHaveBeenCalledTimes(2);
  });
  it("does not mistake a summary followed by an authorized browser outcome for a read-only request", async () => {
    const request = searched("Summarize these results and open the best matching job.");
    const json = vi.fn().mockResolvedValueOnce({ action: "say", text: "The results list customer support jobs.", done: true })
      .mockResolvedValueOnce({ action: "click", target: "job", done: false });
    const result = await decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
    expect(result).toMatchObject({ action: { type: "click", target: "job" }, done: false });
    expect(json).toHaveBeenCalledTimes(2);
  });
  it("preserves a real blocker and verified partial answer without another review loop", async () => {
    const request = searched("Open the best matching job and compare it with one other qualifying listing.");
    request.page.text = "Sign in to view the job description.";
    const proposed = { action: "say", text: "The results loaded, but descriptions require sign-in. I cannot verify pay or experience yet; sign in to finish the comparison.", done: true };
    const json = vi.fn().mockResolvedValue(proposed);
    const result = await decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
    expect(result.action).toEqual({ type: "say", text: proposed.text });
    expect(json).toHaveBeenCalledTimes(2);
  });
  it("leaves standalone answers, explicit summaries, essential questions and tool-only chains alone", async () => {
    const ordinary = input("", "What is a read timeout?");
    const summary = searched("Summarize this page");
    const conversation = searched("Explain the difference"); conversation.contextScope = "conversation";
    const toolOnly = searched("What did you find?"); toolOnly.history = [{ action: { type: "tool", tool: "notes", operation: "find", args: { query: "support jobs" } },
      result: { ok: true, changed: false, message: "Found two notes" }, at: 1 }];
    const failed = searched("Finish applying the filters"); failed.history[0].result.ok = false;
    for (const request of [ordinary, summary, conversation, toolOnly, failed]) {
      const json = vi.fn().mockResolvedValue({ action: "say", text: "Source-backed answer.", done: true });
      await decide(request, { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
      expect(json).toHaveBeenCalledOnce();
    }
    const json = vi.fn().mockResolvedValue({ action: "ask", question: "Which of these two verified options do you prefer?", done: true });
    await decide(searched("Compare the results, then ask me to choose."), { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal);
    expect(json).toHaveBeenCalledOnce();
  });
  it("rejects an invalid or stale review rather than publishing the unverified original reply", async () => {
    const proposed = { action: "say", text: "All requested filters are applied.", done: true };
    for (const [reviewed, code] of [
      [{ action: "select", target: "date", value: 7 }, "invalid_provider_output"],
      [{ action: "click", target: "old-date-filter", done: false }, "stale_target"],
    ] as const) {
      const json = vi.fn().mockResolvedValueOnce(proposed).mockResolvedValueOnce(reviewed);
      await expect(decide(searched("Keep the date filter and open a matching job."), { json, provider: "openai" } as unknown as Providers, false, new AbortController().signal))
        .rejects.toMatchObject({ code });
      expect(json).toHaveBeenCalledTimes(2);
    }
  });
  it("honors cancellation before reviewing or accepting a completed answer", async () => {
    for (const abortCall of [1, 2]) {
      const controller = new AbortController();
      let calls = 0;
      const json = vi.fn().mockImplementation(async () => {
        if (++calls === abortCall) controller.abort();
        return calls === 1 ? { action: "say", text: "The results are ready.", done: true }
          : { action: "click", target: "job", done: false };
      });
      await expect(decide(searched("Keep the filters and open a matching job."), { json, provider: "openai" } as unknown as Providers, false, controller.signal)).rejects.toBeDefined();
      expect(json).toHaveBeenCalledTimes(abortCall);
    }
  });
});
