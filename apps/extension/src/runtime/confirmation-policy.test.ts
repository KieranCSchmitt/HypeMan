// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "@core";
import { execute, StaleTargetError, type ExecuteContext } from "./executor";
import { Highlight } from "./overlay";
import { PageObserver } from "./page";
import { captureActionApproval, checkPolicy, ConfirmationChangedError } from "./policy";
import type { RuntimeApi } from "./types";

const highlights: Highlight[] = [];
beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { highlights.splice(0).forEach((highlight) => highlight.dispose()); vi.restoreAllMocks(); });
function fixture(markup: string, selector = "button") {
  document.body.innerHTML = markup;
  const observer = new PageObserver();
  const page = observer.snapshot();
  const node = document.querySelector(selector)!;
  const target = observer.describe(node).id;
  return { observer, page, node, action: { type: "click", target } as Action };
}
function execution(f: ReturnType<typeof fixture>) {
  const host = document.createElement("div"); document.body.append(host);
  const highlight = new Highlight(host.attachShadow({ mode: "open" })); highlights.push(highlight);
  const request = vi.fn(async (_message: unknown, _signal?: AbortSignal) => ({ ok: true }));
  const context: ExecuteContext = { observer: f.observer, page: f.page, highlight,
    api: { request: request as RuntimeApi["request"], subscribe: () => () => {} },
    signal: new AbortController().signal, allowed: () => true, reducedMotion: true, trustedInput: true,
    approval: captureActionApproval(f.action, f.page, f.observer),
    sketch: vi.fn(), plan: vi.fn(), note: vi.fn(async () => {}) };
  return { context, request };
}

describe("reviewed submission integrity", () => {
  it("does not submit a changed sibling answer even though the submit target is unchanged", async () => {
    const f = fixture('<form><input name="answer" value="7"><button>Try it!</button></form>');
    const { context, request } = execution(f);
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submitted);
    document.querySelector("input")!.value = "6";
    await expect(execute(f.action, context)).rejects.toBeInstanceOf(ConfirmationChangedError);
    expect(submitted).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    const fresh = captureActionApproval(f.action, f.observer.snapshot(), f.observer);
    expect(fresh.isCurrent(f.action)).toBe(true);
  });
  it.each(["checkbox", "select", "hidden", "destination", "method", "submitter override"])(
    "invalidates approval when %s changes", (changed) => {
      const f = fixture('<form action="/register" method="post"><input type="checkbox" name="terms" checked><select name="session"><option value="am">Morning</option><option value="pm">Evening</option></select><input type="hidden" name="event" value="1"><button>Register</button></form>');
      const approval = captureActionApproval(f.action, f.page, f.observer);
      expect(approval.isCurrent(f.action)).toBe(true);
      if (changed === "checkbox") document.querySelector<HTMLInputElement>("input")!.checked = false;
      if (changed === "select") document.querySelector("select")!.value = "pm";
      if (changed === "hidden") document.querySelector<HTMLInputElement>('input[type="hidden"]')!.value = "2";
      if (changed === "destination") document.querySelector("form")!.action = "/different-event";
      if (changed === "method") document.querySelector("form")!.method = "get";
      if (changed === "submitter override") f.node.setAttribute("formaction", "/different-event");
      expect(approval.isCurrent(f.action)).toBe(false);
    },
  );
  it("checks full values beyond the observed/visible-review truncation", () => {
    const f = fixture('<form><textarea name="message"></textarea><button>Send</button></form>');
    const field = document.querySelector("textarea")!; field.value = "a".repeat(600) + "original";
    const approval = captureActionApproval(f.action, f.observer.snapshot(), f.observer);
    field.value = "a".repeat(600) + "changed";
    expect(approval.isCurrent(f.action)).toBe(false);
    expect(Object.keys(approval).sort()).toEqual(["isCurrent", "target"]);
  });
  it("protects a consequential button without a native form using observed page fields", () => {
    const f = fixture('<label>Answer<input value="7"></label><button>Submit</button>');
    const approval = captureActionApproval(f.action, f.page, f.observer);
    document.querySelector("input")!.value = "6";
    expect(approval.isCurrent(f.action)).toBe(false);
  });
  it("detects private-field changes locally without adding their values to the review", () => {
    const f = fixture('<form method="post"><input type="password" name="password" value="private-original"><button>Register</button></form>');
    const approval = captureActionApproval(f.action, f.page, f.observer);
    expect(checkPolicy(f.action, f.page, f.observer).confirmation).not.toContain("private-original");
    document.querySelector("input")!.value = "private-updated";
    expect(approval.isCurrent(f.action)).toBe(false);
    expect(JSON.stringify(approval)).not.toContain("private-");
  });
  it("keeps an approved untargeted Enter bound to the reviewed field after confirmation takes focus", async () => {
    const f = fixture('<form method="post"><input name="answer" value="7"><button>Submit</button></form>');
    document.querySelector("input")!.focus(); f.action = { type: "key", key: "Enter" };
    const { context } = execution(f);
    const confirmation = document.createElement("button"); confirmation.textContent = "Confirm"; document.body.append(confirmation); confirmation.focus();
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submitted);
    await execute(f.action, context);
    expect(submitted).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.querySelector("input"));
  });
  it("rechecks after asynchronous handoff persistence before activating", async () => {
    const f = fixture('<form><input name="answer" value="7"><button>Submit</button></form>');
    const { context, request } = execution(f);
    const clicked = vi.fn(); f.node.addEventListener("click", clicked);
    request.mockImplementation(async () => { document.querySelector("input")!.value = "6"; return { ok: true }; });
    await expect(execute(f.action, context)).rejects.toBeInstanceOf(ConfirmationChangedError);
    expect(clicked).not.toHaveBeenCalled();
  });
  it("rechecks after pointer/focus handlers and before the actual click", async () => {
    const f = fixture('<form><input name="answer" value="7"><button>Submit</button></form>');
    const { context } = execution(f);
    const clicked = vi.fn(); f.node.addEventListener("click", clicked);
    f.node.addEventListener("mousedown", () => { document.querySelector("input")!.value = "6"; });
    await expect(execute(f.action, context)).rejects.toBeInstanceOf(ConfirmationChangedError);
    expect(clicked).not.toHaveBeenCalled();
  });
  it("marks post-mutation staleness so recovery cannot treat typing as unexecuted", async () => {
    const f = fixture('<input name="answer" value="7">', "input");
    f.action = { type: "type", target: f.observer.describe(f.node).id, text: "8" };
    const { context } = execution(f); delete context.approval;
    f.node.addEventListener("input", () => f.node.replaceWith(f.node.cloneNode()));
    await expect(execute(f.action, context)).rejects.toMatchObject({ name: "StaleTargetError", acted: true });
  });
  it("executes unchanged approved state locally, avoiding an unguarded trusted transport", async () => {
    const f = fixture('<form><input name="answer" value="7"><button>Submit</button></form>');
    f.action = { ...f.action, trusted: true } as Action;
    const { context, request } = execution(f);
    const submitted = vi.fn((event: Event) => { event.preventDefault(); document.body.dataset.submitted = "yes"; });
    document.querySelector("form")!.addEventListener("submit", submitted);
    const outcome = await execute(f.action, context);
    expect(outcome.ok).toBe(true); expect(submitted).toHaveBeenCalledOnce();
    expect(request.mock.calls.some(([message]) => (message as unknown as { type: string }).type === "input")).toBe(false);
  });
  it("throws typed stale-target errors for ordinary retargeted controls", async () => {
    const f = fixture("<button>Compare options</button>");
    const { context } = execution(f); delete context.approval;
    f.node.textContent = "Delete account";
    await expect(execute(f.action, context)).rejects.toBeInstanceOf(StaleTargetError);
  });
});

describe("public read-only search confirmation", () => {
  it.each(["Submit application", "Submit order"])("retains confirmation for %s inside a GET search form", (label) => {
    const f = fixture(`<form role="search" action="/results" method="get"><input type="search" name="q"><button>${label}</button></form>`);
    expect(checkPolicy(f.action, f.page, f.observer).confirmation).toBeTruthy();
  });
  it.each(["Submit", "Submit search"])("allows the search-only %s control inside a public GET search form", (label) => {
    const f = fixture(`<form role="search" action="/results" method="get"><input type="search" name="q"><button>${label}</button></form>`);
    expect(checkPolicy(f.action, f.page, f.observer).confirmation).toBeUndefined();
  });
  it.each(["click", "Enter"])("allows an observed GET search using %s", (activation) => {
    const f = fixture('<form action="/search" method="get"><input type="search" name="q" value="desk lamp"><button>Submit search</button></form>');
    const action: Action = activation === "click" ? f.action : { type: "key", target: f.observer.describe(document.querySelector("input")!).id, key: "Enter" };
    expect(checkPolicy(action, f.page, f.observer)).toEqual({ allowed: true });
  });
  it("recognizes the browser's default GET method only with observed search semantics", () => {
    const f = fixture('<form role="search"><input type="search"><button>Search</button></form>');
    expect(checkPolicy(f.action, f.page, f.observer).confirmation).toBeUndefined();
    const ordinary = fixture('<form><input name="name"><button>Continue</button></form>');
    expect(checkPolicy(ordinary.action, ordinary.page, ordinary.observer).confirmation).toBeTruthy();
  });
  it.each([
    '<form role="search" method="post"><input type="search"><button>Search</button></form>',
    '<form role="search" method="get"><input type="search"><button formmethod="post">Search</button></form>',
    '<form role="search" method="post"><input type="search"><button type="button">Search</button></form>',
    '<form role="search" action="/delete" method="get"><input type="search"><button>Search</button></form>',
    '<form role="search" action="/account/search" method="get"><input type="search"><button>Search</button></form>',
    '<form role="search" action="/orders/confirm" method="get"><input type="search"><button>Search</button></form>',
    '<form role="search" action="/search?action=delete" method="get"><input type="search"><button>Search</button></form>',
    '<form role="search" method="get"><input type="password"><button>Search</button></form>',
    '<form role="search" method="get"><input type="search"><button>Search and publish</button></form>',
    '<button>Search</button>',
  ])("retains confirmation for an unknown, private or consequential search: %s", (markup) => {
    const f = fixture(markup);
    expect(checkPolicy(f.action, f.page, f.observer).confirmation).toBeTruthy();
  });
  it("does not waive a POST Enter submission merely because its field says search", () => {
    const f = fixture('<form role="search" method="post"><input type="search" name="q"><button>Search</button></form>', "input");
    const action: Action = { type: "key", target: f.action.type === "click" ? f.action.target : "", key: "Enter" };
    expect(checkPolicy(action, f.page, f.observer).confirmation).toBeTruthy();
  });
});

describe("native navigation handoff", () => {
  const handoff = { conversationId: "test-chat", goal: "Compare options", history: [], step: 1, at: 1 };
  it("routes an ordinary observed _blank link explicitly so noopener cannot lose its conversation", async () => {
    const f = fixture('<a href="https://example.com/product/1" target="_blank" rel="noopener">Compare lamp</a>', "a");
    const { context, request } = execution(f); context.handoff = handoff; delete context.approval;
    const clicked = vi.fn(); f.node.addEventListener("click", clicked);
    const outcome = await execute(f.action, context);
    expect(outcome).toMatchObject({ navigation: true, url: "https://example.com/product/1" });
    expect(request).toHaveBeenCalledExactlyOnceWith({ type: "nav.navigate", url: "https://example.com/product/1", newTab: true, handoff }, context.signal);
    expect(clicked).not.toHaveBeenCalled();
  });
  it.each([false, true])("preserves an uncancelled native form submit but clears a prevented submit (%s)", async (prevented) => {
    const f = fixture('<form action="/results" method="get"><input name="q" value="lamps"><button>Search</button></form>');
    const { context, request } = execution(f); context.handoff = handoff;
    const form = document.querySelector("form")!;
    vi.spyOn(f.node as HTMLButtonElement, "click").mockImplementation(() => {
      f.node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const submit = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: f.node as HTMLButtonElement });
      if (prevented) submit.preventDefault();
      form.dispatchEvent(submit);
    });
    const outcome = await execute(f.action, context);
    expect(outcome.navigation).toBe(!prevented);
    expect(outcome.navigationPending).toBe(prevented ? undefined : true);
    const session = request.mock.calls.map(([message]) => message as { type: string; handoff: unknown }).filter((message) => message.type === "session.set");
    expect(session.map((message) => message.handoff)).toEqual(prevented ? [handoff, null] : [handoff]);
    expect(outcome.url).not.toContain("lamps");
  });
  it.each([false, true])("registers a narrow new-tab link intent and clears it if prevented (%s)", async (prevented) => {
    const f = fixture('<a href="https://example.com/product/1" target="_blank">Compare lamp</a>', "a");
    const { context, request } = execution(f); context.handoff = handoff;
    vi.spyOn(f.node as HTMLAnchorElement, "click").mockImplementation(() => {
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      if (prevented) click.preventDefault();
      f.node.dispatchEvent(click);
    });
    const outcome = await execute(f.action, context);
    expect(outcome.navigation).toBe(!prevented);
    const calls = request.mock.calls.map(([message]) => message as { type: string; handoff: unknown; nativeNavigation?: unknown });
    expect(calls[0]).toMatchObject({ type: "session.set", handoff, nativeNavigation: {
      url: "https://example.com/product/1", target: "new-tab", at: expect.any(Number),
    } });
    expect(calls.filter((message) => message.handoff === null)).toHaveLength(prevented ? 1 : 0);
  });
  it("does not issue a second native submit when an Enter handler has already submitted", async () => {
    const f = fixture('<form action="/results"><input name="q" value="lamps"><button>Search</button></form>', "input");
    f.action = { type: "key", target: f.observer.describe(f.node).id, key: "Enter" };
    const { context, request } = execution(f); context.handoff = handoff;
    const form = document.querySelector("form")!;
    const submitted = vi.spyOn(form, "requestSubmit").mockImplementation(() => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    });
    f.node.addEventListener("keydown", () => form.requestSubmit());
    const outcome = await execute(f.action, context);
    expect(submitted).toHaveBeenCalledOnce(); expect(outcome.navigation).toBe(true);
    expect(request.mock.calls.map(([message]) => message).filter((message) => (message as { handoff?: unknown }).handoff === null)).toHaveLength(0);
  });
});
