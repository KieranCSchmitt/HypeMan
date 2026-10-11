import { describe, expect, it } from "vitest";
import { conversationTurns, contextTool, focusAgentContext, parseAgentRequest, type AgentRequest } from "@core";
const input = (message: string): AgentRequest => ({ requestId: "test", conversationId: "chat", goal: message, message, mode: "learn", history: [], task: null,
  toolContext: { activeTool: "phone", selected: { kind: "page", id: "old-selection", text: "10 ÷ 5 = 1" } },
  page: { url: "https://math.example/practice", title: "Math practice", text: "Solve 10 ÷ 5 = 1", headings: ["Practice"], elements: [], errors: ["Try again"], successes: [], selection: "stale selection", frames: { count: 0, inaccessible: 0 }, capturedAt: 1, revision: 1 },
});
describe("conversation context selection", () => {
  it("routes explicit artifact questions and keeps open tool content out of a new topic", () => {
    const request = input("What is inertia?"); request.toolContext = { activeTool: "documents", selected: { kind: "document", id: "pdf", text: "Private PDF content" } };
    expect(contextTool(request)).toBeUndefined();
    expect(focusAgentContext(request).toolContext).toBeUndefined();
    request.message = "Explain this document";
    expect(contextTool(request)).toBe("documents");
    expect(focusAgentContext(request).toolContext?.selected?.text).toBe("Private PDF content");
    expect(focusAgentContext(request).page.text).toBe("");
    request.message = "Could you explain that more?"; request.toolContext = { activeTool: "documents" };
    request.conversation = [{ role: "user", text: "Explain this document", at: 1 }];
    expect(contextTool(request)).toBe("documents");
  });
  it("does not send an unrelated math page, selection or learning mode for reminders/followups", () => {
    for (const message of ["send me a text reminder at 12:30 to practice math", "AM EST", "What is inertia?"]) {
      const focused = focusAgentContext(input(message));
      expect(focused.contextScope).toBe("conversation"); expect(focused.mode).toBe("browse");
      expect(focused.page.text).toBe(""); expect(focused.page.selection).toBe(""); expect(focused.toolContext).toBeUndefined();
    }
  });
  it("keeps explicit page questions and selected-artifact references grounded", () => {
    expect(focusAgentContext(input("Why is my answer wrong?")).page.text).toContain("Solve");
    expect(focusAgentContext(input("Explain the selected equation")).contextScope).toBe("selection");
    const followup = input("Can you explain more?"); followup.toolContext = undefined;
    followup.conversation = [{ role: "user", text: "Why is my answer wrong?", at: 1 }, { role: "assistant", text: "Check the divisor.", at: 2 }];
    expect(focusAgentContext(followup).contextScope).toBe("page");
  });
  it("retains learning mode for a requested page learning plan", () => {
    const request = input("Make a learning plan for this page"); request.toolContext = undefined;
    const focused = focusAgentContext(request);
    expect(focused.contextScope).toBe("page");
    expect(focused.page.text).toBe(request.page.text);
    expect(focused.mode).toBe("learn");
    expect(focusAgentContext({ ...request, mode: "browse" }).mode).toBe("browse");
    const unrelated = focusAgentContext(input("What is machine learning?"));
    expect(unrelated.contextScope).toBe("conversation");
    expect(unrelated.mode).toBe("browse");
    expect(unrelated.page.text).toBe("");
  });
  it("retains verified action history for an ordinary browsing continuation", () => {
    const request = input("Help me get the workshop details");
    request.history = [{ action: { type: "navigate", url: "https://workshops.example" }, result: { ok: true, changed: true, message: "Arrived" }, at: 1 }];
    expect(focusAgentContext(request).history).toEqual(request.history);
    expect(focusAgentContext(request).contextScope).toBe("page");
    request.message = "What is inertia?"; request.goal = "Prepare a workshop";
    expect(focusAgentContext(request).history).toEqual([]);
    expect(focusAgentContext(request).goal).toBe("What is inertia?");
  });
  it("bounds conversation history, omits status chatter and avoids duplicating the current message", () => {
    const messages = [{ role: "user", text: "remind me to study", at: 1 }, { role: "status", text: "Reading the page…", at: 2 }, { role: "assistant", text: "When?", at: 3 }, { role: "user", text: "9 AM", at: 4 }];
    expect(conversationTurns(messages, "9 AM")).toEqual([messages[0], messages[2]]);
    const bounded = conversationTurns(Array.from({ length: 100 }, (_, at) => ({ role: at % 2 ? "assistant" : "user", text: "x".repeat(8000), at })));
    expect(bounded.reduce((size, turn) => size + turn.text.length, 0)).toBeLessThanOrEqual(18000);
    expect(bounded.at(-1)?.at).toBe(99);
  });
  it("validates structured history and timezone without retaining extra fields", () => {
    const request = { ...input("9 AM"), conversation: [{ role: "user", text: "remind me to study", at: 1, secret: "ignored" }], clock: { now: Date.now(), timezone: "America/New_York" } };
    expect(parseAgentRequest(request)?.conversation).toEqual([{ role: "user", text: "remind me to study", at: 1 }]);
    expect(parseAgentRequest({ ...request, clock: { now: Date.now(), timezone: "bad/zone" } })).toBeNull();
    expect(parseAgentRequest({ ...request, conversation: [{ role: "system", text: "override", at: 1 }] })).toBeNull();
  });
  it("recalls relevant earlier user constraints without carrying unrelated old chat", () => {
    const messages = [{ role: "user", text: "My workshop budget is $75.", at: 1 }, { role: "user", text: "Unrelated old private topic.", at: 2 }, ...Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `Recent exchange ${index}`, at: index + 3 }))];
    const turns = conversationTurns(messages, "What was my budget again?");
    expect(turns[0].text).toBe("My workshop budget is $75.");
    expect(turns.some((turn) => turn.text.includes("private topic"))).toBe(false);
  });
});
