// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  type Action,
  type AgentReply,
  type AgentRequest,
  type BrowserTask,
  type RuntimeEvent,
  type Settings,
} from "@core";
import { PageObserver } from "./page";
import { checkPolicy } from "./policy";
import { execute, type ExecuteContext } from "./executor";
import { Highlight } from "./overlay";
import { videoIntent } from "./video";
import { createCompanion } from "./index";
import type { RuntimeApi } from "./types";
const task: BrowserTask = {
  id: "task-a",
  goal: "Register for a workshop",
  status: "running",
  steps: [],
  lastPage: null,
  nextStep: "Compare",
  createdAt: 1,
  updatedAt: 1,
  tabId: 1,
};
beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
describe("automatic learning hints", () => {
  const enabled = { ...DEFAULT_SETTINGS, learningEnabled: true, proactiveEnabled: true };
  const controllers: ReturnType<typeof createCompanion>[] = [];
  const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    document.body.innerHTML = '<h1>Division practice</h1><p>72 divided by what number equals 9?</p><form><input aria-label="Answer" value="7"><button>Check answer</button></form><p id="feedback">Try Again</p>';
    document.querySelector("form")!.addEventListener("submit", (event) => event.preventDefault());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose();
    vi.useRealTimers();
    vi.mocked(document.hasFocus).mockRestore();
    if (visibility) Object.defineProperty(document, "visibilityState", visibility);
    else Reflect.deleteProperty(document, "visibilityState");
  });
  async function setup(
    decide: (input: unknown, signal?: AbortSignal) => Promise<AgentReply> = async () => ({
      action: { type: "say", text: "Which multiplication fact connects the two visible numbers?" },
      provider: "demo",
    }),
    settings: Settings = enabled,
    workspace: () => unknown = () => ({ tasks: [], activeTaskId: null }),
  ) {
    const b = bridge(decide, (message) => {
      if (message.type === "settings.get") return settings;
      if (message.type === "workspace.get") return workspace();
      return undefined;
    });
    const controller = createCompanion(host(), b.api);
    controllers.push(controller);
    await controller.start();
    return { controller, ...b };
  }
  const inference = (request: ReturnType<typeof bridge>["request"]) =>
    request.mock.calls.filter(([message]) => message.type === "agent.decide");
  it("generates one grounded, read-only hint on existing feedback and records real hint evidence", async () => {
    const { controller, request } = await setup();
    await vi.advanceTimersByTimeAsync(300);
    expect(inference(request)).toHaveLength(1);
    const input = inference(request)[0][0].input as AgentRequest;
    expect(input).toMatchObject({ mode: "learn", task: null, history: [] });
    expect(input.message).toContain("rung 1 of 4");
    expect(input.message).toContain("Try Again");
    expect(input.page.text).toContain("72 divided by what number equals 9?");
    expect(input).not.toHaveProperty("screenshot");
    const hint = controller.getSnapshot().learning.autoHint!;
    expect(hint.text).toContain("multiplication fact");
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", task: null });
    expect(controller.getSnapshot().messages.at(-1)).toMatchObject({
      id: hint.id, role: "assistant", text: hint.text,
    });
    expect(request.mock.calls.some(([message]) => /^task\.|^session\.set|^browser\./.test(message.type))).toBe(false);
    expect(request.mock.calls.some(([message]) => message.type === "learn.event" &&
      (message.event as { kind: string; evidence: string }).kind === "hint" &&
      (message.event as { evidence: string }).evidence === hint.text)).toBe(true);
  });
  it("ignores self rendering and repeated mutations, but advances after a fresh attempt and cooldown", async () => {
    const { controller, request } = await setup();
    await vi.advanceTimersByTimeAsync(300);
    document.querySelector("h1")!.className = "animated";
    controller.getSnapshot();
    await vi.advanceTimersByTimeAsync(46_000);
    expect(inference(request)).toHaveLength(1);
    const answer = document.querySelector("input")!;
    answer.value = "6";
    answer.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(400);
    expect(inference(request)).toHaveLength(2);
    expect((inference(request)[1][0].input as AgentRequest).message).toContain("rung 2 of 4");
    expect(controller.getSnapshot().learning.hintLevel).toBe(2);
    document.getElementById("feedback")!.textContent = "";
    await vi.advanceTimersByTimeAsync(300);
    expect(controller.getSnapshot().learning.autoHint).toBeNull();
    document.getElementById("feedback")!.textContent = "Try Again";
    await vi.advanceTimersByTimeAsync(300);
    expect(inference(request)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(inference(request)).toHaveLength(3);
  });
  it.each(["learning off", "automatic hints off", "paused site", "hidden page", "unfocused window"])(
    "does not send page analysis when %s", async (condition) => {
      const settings = { ...enabled };
      if (condition === "learning off") settings.learningEnabled = false;
      if (condition === "automatic hints off") settings.proactiveEnabled = false;
      if (condition === "paused site") settings.hiddenOnHosts = [location.hostname];
      if (condition === "hidden page")
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      if (condition === "unfocused window") vi.mocked(document.hasFocus).mockReturnValue(false);
      const { request } = await setup(undefined, settings);
      await vi.advanceTimersByTimeAsync(1000);
      expect(inference(request)).toHaveLength(0);
    },
  );
  it.each(["disable", "pause", "hide", "suspend", "dispose", "stop", "page change"])(
    "cancels and discards a late hint after %s", async (condition) => {
      let resolve!: (value: AgentReply) => void;
      let signal: AbortSignal | undefined;
      const { controller, request } = await setup((_input, currentSignal) => {
        signal = currentSignal;
        return new Promise((done) => { resolve = done; });
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(inference(request)).toHaveLength(1);
      if (condition === "disable") controller.setSettings({ ...enabled, proactiveEnabled: false });
      if (condition === "pause") controller.setSettings({ ...enabled, hiddenOnHosts: [location.hostname] });
      if (condition === "hide") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      }
      if (condition === "suspend") controller.suspend();
      if (condition === "dispose") controller.dispose();
      if (condition === "stop") controller.stop();
      if (condition === "page change") {
        document.querySelector("h1")!.textContent = "A different question";
        await vi.advanceTimersByTimeAsync(300);
      }
      expect(signal?.aborted).toBe(true);
      resolve({ action: { type: "say", text: "A stale answer" }, provider: "demo" });
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.getSnapshot().messages.some((message) => message.text === "A stale answer")).toBe(false);
      expect(controller.getSnapshot().learning.autoHint).toBeNull();
    },
  );
  it("never executes a model action returned instead of a hint", async () => {
    const { controller, request } = await setup(async () => ({
      action: { type: "type", target: "untrusted-target", text: "8" },
      provider: "demo",
    }));
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector("input")!.value).toBe("7");
    expect(controller.getSnapshot().learning.autoHint).toBeNull();
    expect(controller.getSnapshot().messages.at(-1)?.text).toContain("read-only hint");
    expect(request.mock.calls.some(([message]) => message.type.startsWith("task."))).toBe(false);
  });
  it("prepares privately, preserves it through typing, and reveals without a second provider request", async () => {
    document.getElementById("feedback")!.textContent = "";
    const { controller, request } = await setup();
    await vi.advanceTimersByTimeAsync(1200);
    expect(inference(request)).toHaveLength(1);
    expect(controller.getSnapshot().messages).toEqual([]);
    expect(controller.getSnapshot().learning.hintLevel).toBe(0);
    expect(request.mock.calls.some(([message]) => message.type === "learn.event")).toBe(false);
    expect((inference(request)[0][0].input as AgentRequest).page.elements).toEqual([]);
    const answer = document.querySelector("input")!;
    answer.value = "6";
    answer.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(inference(request)).toHaveLength(1);
    document.querySelector("button")!.click();
    document.getElementById("feedback")!.textContent = "Try Again";
    await vi.advanceTimersByTimeAsync(400);
    expect(inference(request)).toHaveLength(1);
    expect(controller.getSnapshot().learning.autoHint?.text).toContain("multiplication fact");
    expect(controller.getSnapshot().learning.hintLevel).toBe(1);
  });
  it("reuses an in-flight preparation when wrong-answer feedback arrives", async () => {
    document.getElementById("feedback")!.textContent = "";
    let resolve!: (reply: AgentReply) => void;
    let signal: AbortSignal | undefined;
    const { controller, request } = await setup((_input, currentSignal) => {
      signal = currentSignal;
      return new Promise((done) => { resolve = done; });
    });
    await vi.advanceTimersByTimeAsync(1200);
    document.querySelector("button")!.click();
    document.getElementById("feedback")!.textContent = "Try Again";
    await vi.advanceTimersByTimeAsync(400);
    expect(inference(request)).toHaveLength(1);
    expect(signal?.aborted).toBe(false);
    resolve({ action: { type: "say", text: "A prepared hint" }, provider: "demo" });
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot().learning.autoHint?.text).toBe("A prepared hint");
  });
  it("resumes question preparation when a selection interrupts its debounce", async () => {
    document.getElementById("feedback")!.textContent = "";
    const { controller, request } = await setup();
    await vi.advanceTimersByTimeAsync(300);
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("h1")!);
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(200);
    selection.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(1200);
    expect(inference(request)).toHaveLength(1);
    expect((inference(request)[0][0].input as AgentRequest).mode).toBe("learn");
    expect(controller.getSnapshot().learning.autoHint).toBeNull();
  });
  it("explains stable selections with Learning off and clears the preview on deselection", async () => {
    document.body.innerHTML = '<h1>Plant energy</h1><p><span id="term">Photosynthesis</span> lets plants turn sunlight into food.</p>';
    const { controller, request } = await setup(async () => ({
      action: { type: "say", text: "Plants use sunlight to make food." }, provider: "demo",
    }), { ...enabled, learningEnabled: false });
    const select = () => {
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("term")!);
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    };
    select();
    await vi.advanceTimersByTimeAsync(700);
    expect(inference(request)).toHaveLength(1);
    expect(inference(request)[0][0].input).toMatchObject({ mode: "browse", task: null,
      page: { selection: "Photosynthesis", elements: [] } });
    expect(controller.getSnapshot().learning.autoHint?.kind).toBe("explanation");
    expect(request.mock.calls.some(([message]) => message.type === "learn.event" || message.type === "task.start")).toBe(false);
    document.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(controller.getSnapshot().learning.autoHint).toBeNull();
    select();
    await vi.advanceTimersByTimeAsync(700);
    expect(inference(request)).toHaveLength(1);
    expect(controller.getSnapshot().learning.autoHint?.kind).toBe("explanation");
  });
  it("cancels an automatic request as soon as the learner sends a message and keeps manual hints graduated", async () => {
    let resolve!: (reply: AgentReply) => void;
    let signal: AbortSignal | undefined;
    let calls = 0;
    const { controller, request } = await setup((_input, currentSignal) => {
      if (calls++) return Promise.resolve({ action: { type: "say", text: "A requested hint" }, provider: "demo" });
      signal = currentSignal;
      return new Promise((done) => { resolve = done; });
    });
    await vi.advanceTimersByTimeAsync(300);
    await controller.send("Give me a little hint");
    expect(signal?.aborted).toBe(true);
    resolve({ action: { type: "say", text: "Late automatic hint" }, provider: "demo" });
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot().messages.some((message) => message.text === "Late automatic hint")).toBe(false);
    expect(controller.getSnapshot().messages.at(-1)?.text).toBe("A requested hint");
    expect(controller.getSnapshot().learning.autoHint).toBeNull();
    expect(inference(request)).toHaveLength(2);
    expect(controller.getSnapshot().learning.hintLevel).toBe(1);
  });
  it("keeps another tab's running task in control and cancels when a task begins during inference", async () => {
    let active = true;
    let signal: AbortSignal | undefined;
    let resolve!: (reply: AgentReply) => void;
    const { controller, request, emit } = await setup((_input, currentSignal) => {
      signal = currentSignal;
      return new Promise((done) => { resolve = done; });
    }, enabled, () => ({ tasks: active ? [task] : [], activeTaskId: active ? task.id : null }));
    await vi.advanceTimersByTimeAsync(300);
    expect(inference(request)).toHaveLength(0);
    active = false;
    document.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(400);
    expect(inference(request)).toHaveLength(1);
    active = true;
    emit({ type: "workspace.changed" });
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    resolve({ action: { type: "say", text: "Do not interrupt the task" }, provider: "demo" });
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot().learning.autoHint).toBeNull();
  });
  it("reports unavailable inference without inventing a replacement hint", async () => {
    const { controller } = await setup(async () => {
      throw new Error("Local model is offline");
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(controller.getSnapshot().learning.autoHint).toBeNull();
    expect(controller.getSnapshot().messages.at(-1)?.text).toBe("Hints unavailable: Local model is offline");
    expect(controller.getSnapshot().messages.some((message) => message.role === "assistant")).toBe(false);
  });
});
function host() {
  const host = document.createElement("div");
  document.body.append(host);
  return host.attachShadow({ mode: "open" });
}
function bridge(
  decide?: (input: unknown, signal?: AbortSignal) => Promise<AgentReply>,
  extra?: (message: { type: string; [key: string]: unknown }) => unknown,
) {
  let listener: ((event: RuntimeEvent) => void) | null = null;
  const request = vi.fn(
    async (
      message: { type: string; [key: string]: unknown },
      signal?: AbortSignal,
    ): Promise<unknown> => {
      const custom = extra?.(message);
      if (custom !== undefined) return custom;
      if (message.type === "settings.get") return { ...DEFAULT_SETTINGS, reducedMotion: "on" };
      if (message.type === "session.get") return {};
      if (message.type === "task.start") return task;
      if (message.type === "workspace.get")
        return { version: 1, tasks: [task], notes: [], events: [], activeTaskId: task.id };
      if (message.type === "agent.decide") return await decide?.(message.input, signal);
      return { ok: true };
    },
  );
  const api: RuntimeApi = {
    request: request as RuntimeApi["request"],
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  return { api, request, emit: (event: RuntimeEvent) => listener?.(event) };
}
function executionContext() {
  const shadow = host();
  const observer = new PageObserver(document, shadow.host);
  const page = observer.snapshot();
  const b = bridge();
  const highlight = new Highlight(shadow);
  const context: ExecuteContext = {
    api: b.api,
    observer,
    highlight,
    page,
    signal: new AbortController().signal,
    allowed: () => true,
    reducedMotion: true,
    trustedInput: false,
    handoff: { taskId: task.id, goal: task.goal, history: [], step: 1, at: Date.now() },
    sketch: vi.fn(),
    plan: vi.fn(),
    note: vi.fn(async () => undefined),
  };
  return { context, request: b.request };
}
describe("page understanding", () => {
  it("keeps target identity, excludes UI, and redacts private field values", () => {
    document.body.innerHTML =
      '<h1>Registration</h1><label for="p">Verification code</label><input id="p" value="994411"><input aria-label="Name" value="Taylor"><button>Register</button>';
    const shadow = host();
    shadow.innerHTML = "<button>Private HypeMan UI</button>";
    const observer = new PageObserver(document, shadow.host);
    const first = observer.snapshot();
    const second = observer.snapshot();
    expect(first.elements.find((element) => element.name === "Verification code")).toMatchObject({
      sensitive: true,
    });
    expect(first.elements.find((element) => element.sensitive)).not.toHaveProperty("value");
    expect(first.text).not.toContain("994411");
    expect(first.text).not.toContain("Private HypeMan UI");
    expect(second.elements.map((element) => element.id)).toEqual(
      first.elements.map((element) => element.id),
    );
    document.querySelector("button")!.remove();
    expect(
      observer.resolve(first.elements.find((element) => element.name === "Register")!.id),
    ).toBeNull();
  });
  it("does not count negative or incorrect notices as success", () => {
    document.body.innerHTML =
      '<p role="status">Incorrect. Try again.</p><p role="alert">Registration not complete</p><p role="status">Registration confirmed</p>';
    const page = new PageObserver().snapshot();
    expect(page.errors).toHaveLength(2);
    expect(page.successes).toEqual(["Registration confirmed"]);
  });
  it("excludes text and controls hidden by ancestor CSS and bounds the target registry", () => {
    document.body.innerHTML =
      '<section style="display:none"><h1>Private hidden material</h1><button>Hidden button</button><p>Hidden secret</p></section><div style="opacity:0"><button>Transparent button</button></div><h1>Visible page</h1>' +
      "<button>Visible control</button>".repeat(200);
    const page = new PageObserver().snapshot();
    expect(page.text).not.toContain("Hidden secret");
    expect(page.headings).toEqual(["Visible page"]);
    expect(page.elements).toHaveLength(180);
    expect(page.elements.every((element) => element.name === "Visible control")).toBe(true);
  });
});
describe("action policy and execution", () => {
  it("preserves handoff for a native link while its next document is still loading", async () => {
    const destination = new URL("/demo/workshops/slow-compare.html", document.location.href).href;
    document.body.innerHTML = `<a href="${destination}">Compare workshops</a>`;
    const clicked = vi.fn();
    document.querySelector("a")!.addEventListener("click", clicked);
    const { context, request } = executionContext();
    try {
      const outcome = await execute(
        { type: "click", target: context.page.elements[0].id },
        context,
      );
      expect(clicked).toHaveBeenCalledTimes(1);
      // jsdom does not commit document navigation, reproducing a destination
      // that takes longer to load than the executor's observation interval.
      expect(document.location.href).toBe(context.page.url);
      expect(outcome).toMatchObject({
        ok: true,
        navigation: true,
        changed: false,
        url: destination,
      });
      expect(outcome.message).toMatch(/requested|destination/i);
      expect(
        request.mock.calls
          .filter(([message]) => message.type === "session.set")
          .map(([message]) => message.handoff),
      ).toEqual([context.handoff]);
    } finally {
      context.highlight.dispose();
    }
  });

  it("runs a prevented SPA link handler and clears handoff after observing its local route", async () => {
    const originalUrl = document.location.href;
    const destination = new URL("/demo/workshops/local-compare.html", originalUrl).href;
    document.body.innerHTML = `<a href="${destination}">Compare workshops</a><p id="view">Workshop list</p>`;
    const clicked = vi.fn((event: MouseEvent) => {
      event.preventDefault();
      window.history.pushState({}, "", destination);
      document.getElementById("view")!.textContent = "Two workshop options";
    });
    document.querySelector("a")!.addEventListener("click", clicked);
    const { context, request } = executionContext();
    try {
      const outcome = await execute(
        { type: "click", target: context.page.elements[0].id },
        context,
      );
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(clicked.mock.calls[0][0].defaultPrevented).toBe(true);
      expect(document.getElementById("view")!.textContent).toBe("Two workshop options");
      expect(outcome).toMatchObject({ ok: true, changed: true, url: destination });
      expect(
        request.mock.calls
          .filter(([message]) => message.type === "session.set")
          .map(([message]) => message.handoff),
      ).toEqual([context.handoff, null]);
    } finally {
      window.history.replaceState({}, "", originalUrl);
      context.highlight.dispose();
    }
  });

  it("runs ordinary button handlers without retaining a navigation handoff", async () => {
    document.body.innerHTML = '<button>Compare options</button><p id="view">Workshop list</p>';
    const clicked = vi.fn(() => {
      document.getElementById("view")!.textContent = "Two workshop options";
    });
    document.querySelector("button")!.addEventListener("click", clicked);
    const { context, request } = executionContext();
    try {
      const outcome = await execute(
        { type: "click", target: context.page.elements[0].id },
        context,
      );
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(outcome).toMatchObject({
        ok: true,
        navigation: false,
        changed: true,
        url: context.page.url,
      });
      expect(
        request.mock.calls
          .filter(([message]) => message.type === "session.set")
          .map(([message]) => message.handoff),
      ).toEqual([context.handoff, null]);
    } finally {
      context.highlight.dispose();
    }
  });

  it("confirms mixed labels and default form buttons and Enter, while leaving search safe", () => {
    document.body.innerHTML =
      '<form><input aria-label="Name"><button>Continue</button></form><button>Preview and publish</button><form role="search"><input type="search"><button>Search</button></form>';
    const observer = new PageObserver();
    const page = observer.snapshot();
    for (const name of ["Continue", "Preview and publish"]) {
      const target = page.elements.find((element) => element.name === name)!;
      expect(
        checkPolicy({ type: "click", target: target.id }, page, observer).confirmation,
      ).toBeTruthy();
    }
    const field = page.elements.find((element) => element.name === "Name")!;
    expect(
      checkPolicy({ type: "key", target: field.id, key: "Enter" }, page, observer).confirmation,
    ).toBeTruthy();
    const search = page.elements.find(
      (element) => element.name === "Search" && element.role === "button",
    )!;
    expect(
      checkPolicy({ type: "click", target: search.id }, page, observer).confirmation,
    ).toBeUndefined();
  });
  it("rejects retargeted controls and rechecks pause after animation before dispatch", async () => {
    document.body.innerHTML = "<button>Open workshop</button>";
    const shadow = host();
    const observer = new PageObserver(document, shadow.host);
    const page = observer.snapshot();
    const button = document.querySelector("button")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    button.textContent = "Delete registration";
    const context = {
      api: bridge().api,
      observer,
      highlight: new Highlight(shadow),
      page,
      signal: new AbortController().signal,
      allowed: () => true,
      reducedMotion: true,
      trustedInput: false,
      sketch: vi.fn(),
      plan: vi.fn(),
      note: vi.fn(async () => undefined),
    };
    await expect(execute({ type: "click", target: page.elements[0].id }, context)).rejects.toThrow(
      /target changed/i,
    );
    expect(clicked).not.toHaveBeenCalled();
    button.textContent = "Open workshop";
    let allowed = true;
    context.allowed = () => allowed;
    context.reducedMotion = false;
    const pending = execute({ type: "click", target: page.elements[0].id }, context);
    allowed = false;
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(clicked).not.toHaveBeenCalled();
    context.highlight.dispose();
  });
  it("opens registration form links without confirming but still protects consequential links", () => {
    document.body.innerHTML =
      '<a href="/demo/workshops/register.html">Register for Pottery Basics</a><a href="/delete">Delete registration</a><a href="/register?confirm=1">Confirm registration</a>';
    const observer = new PageObserver();
    const page = observer.snapshot();
    expect(
      checkPolicy({ type: "click", target: page.elements[0].id }, page, observer).confirmation,
    ).toBeUndefined();
    for (const target of page.elements.slice(1))
      expect(
        checkPolicy({ type: "click", target: target.id }, page, observer).confirmation,
      ).toBeTruthy();
  });
  it("uses trusted transport for a named element when enabled", async () => {
    document.body.innerHTML = "<button>Menu</button>";
    const shadow = host();
    const observer = new PageObserver(document, shadow.host);
    const page = observer.snapshot();
    const b = bridge();
    const clicked = vi.fn();
    document.querySelector("button")!.addEventListener("click", clicked);
    const highlight = new Highlight(shadow);
    await execute(
      { type: "click", target: page.elements[0].id, trusted: true },
      {
        api: b.api,
        observer,
        highlight,
        page,
        signal: new AbortController().signal,
        allowed: () => true,
        reducedMotion: true,
        trustedInput: true,
        sketch: vi.fn(),
        plan: vi.fn(),
        note: vi.fn(async () => undefined),
      },
    );
    expect(b.request.mock.calls.some(([message]) => message.type === "input")).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
    highlight.dispose();
  });
});
describe("media intentions", () => {
  it("controls playback and grounded chapters locally", () => {
    const video = {
      id: "e1",
      title: "Lesson",
      time: 80,
      duration: 200,
      paused: false,
      rate: 1,
      chapters: [{ start: 40, title: "Getting started" }],
    };
    expect(videoIntent("Rewind the video by 15 seconds", video)).toEqual({
      type: "video",
      command: "seek",
      value: 65,
    });
    expect(videoIntent("Seek the video to 1:30", video)).toEqual({
      type: "video",
      command: "seek",
      value: 90,
    });
    expect(videoIntent("Go to the Getting started chapter", video)).toEqual({
      type: "video",
      command: "seek",
      value: 40,
    });
    expect(videoIntent("Summarize what the speaker said", video)).toBeNull();
  });
});
describe("task runtime", () => {
  it("captures source excerpts from the page rather than fabricated model quotes or personal thoughts", async () => {
    document.body.innerHTML =
      "<h1>Pottery Basics</h1><p>Beginner workshop. Materials included. $60 total.</p>";
    const b = bridge(async () => ({
      action: {
        type: "note",
        text: "A useful workshop",
        excerpt: "A guaranteed free class with unlimited supplies",
      },
      done: true,
      provider: "demo",
    }));
    const controller = createCompanion(host(), b.api);
    await controller.start();
    await controller.send("Save the workshop source");
    await controller.pinSelection("My personal thought: choose this one");
    const notes = b.request.mock.calls
      .filter(([message]) => message.type === "note.save")
      .map(([message]) => message.note as { text: string; excerpt: string });
    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.excerpt.includes("$60 total."))).toBe(true);
    expect(notes[0].excerpt).not.toContain("guaranteed free");
    expect(notes[1].excerpt).not.toContain("My personal thought");
    expect(notes[1].text).toContain("My personal thought");
    controller.dispose();
  });
  it("does not analyze or act while a host is paused, and applies motion settings live", async () => {
    const b = bridge(async () => ({ action: { type: "say", text: "Hello" }, provider: "demo" }));
    const controller = createCompanion(host(), b.api);
    await controller.start();
    controller.setSettings({
      ...DEFAULT_SETTINGS,
      hiddenOnHosts: [location.hostname],
      reducedMotion: "on",
    });
    await controller.send("Read this page");
    expect(b.request.mock.calls.some(([message]) => message.type === "agent.decide")).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: "paused", reducedMotion: true });
    controller.setSettings({ ...DEFAULT_SETTINGS, reducedMotion: "off" });
    expect(controller.getSnapshot().reducedMotion).toBe(false);
    await controller.send("Read this page");
    expect(b.request.mock.calls.some(([message]) => message.type === "agent.decide")).toBe(true);
    controller.dispose();
  });
  it("sends bounded other-tab titles only after opt-in, excluding paused hosts and URL queries", async () => {
    const b = bridge(
      async () => ({ action: { type: "say", text: "Ready" }, provider: "demo" }),
      (message) =>
        message.type === "tabs.list"
          ? [
              {
                id: 7,
                title: "Workshop source",
                url: "https://example.com/workshops?token=secret",
              },
              { id: 8, title: "Private", url: "https://paused.example/" },
            ]
          : undefined,
    );
    const controller = createCompanion(host(), b.api);
    await controller.start();
    await controller.send("Read this page");
    expect(b.request.mock.calls.some(([message]) => message.type === "tabs.list")).toBe(false);
    controller.setSettings({
      ...DEFAULT_SETTINGS,
      reducedMotion: "on",
      tabContextEnabled: true,
      hiddenOnHosts: ["paused.example"],
    });
    await controller.send("Compare this page with my open sources");
    const input = b.request.mock.calls
      .filter(([message]) => message.type === "agent.decide")
      .at(-1)?.[0].input as { page: { text: string } };
    expect(input.page.text).toContain("Tab 7: Workshop source");
    expect(input.page.text).not.toContain("secret");
    expect(input.page.text).not.toContain("Private");
    controller.dispose();
  });
  it("attaches an explicitly supplied screenshot once and drops it on site pause", async () => {
    const b = bridge(async () => ({ action: { type: "say", text: "Ready" }, provider: "demo" }));
    const controller = createCompanion(host(), b.api);
    await controller.start();
    const image = "data:image/jpeg;base64,YWJj";
    expect(() => controller.attachScreenshot(image)).toThrow(/enable screenshots/i);
    controller.setSettings({ ...DEFAULT_SETTINGS, screenshotEnabled: true });
    controller.attachScreenshot(image);
    expect(controller.getSnapshot().screenshotAttached).toBe(true);
    await controller.send("Explain the capture");
    await controller.send("Another question");
    const inputs = b.request.mock.calls
      .filter(([message]) => message.type === "agent.decide")
      .map(([message]) => message.input as { screenshot?: string });
    expect(inputs.map((input) => input.screenshot)).toEqual([image, undefined]);
    expect(b.request.mock.calls.some(([message]) => message.type === "screenshot")).toBe(false);
    controller.attachScreenshot(image);
    controller.setSettings({
      ...DEFAULT_SETTINGS,
      screenshotEnabled: true,
      hiddenOnHosts: [location.hostname],
    });
    expect(controller.getSnapshot().screenshotAttached).toBe(false);
    controller.dispose();
  });
  it("graduates learning hint context and resets it when learning is disabled", async () => {
    document.body.innerHTML = "<h1>Equations</h1>";
    const b = bridge(async () => ({
      action: { type: "say", text: "A grounded hint" },
      provider: "demo",
    }));
    const controller = createCompanion(host(), b.api);
    await controller.start();
    controller.setSettings({ ...DEFAULT_SETTINGS, learningEnabled: true });
    await controller.send("A little hint");
    await controller.send("Another hint");
    const requests = b.request.mock.calls
      .filter(([message]) => message.type === "agent.decide")
      .map(([message]) => message.input as { message: string });
    expect(requests[0].message).toContain("rung 1 of 4");
    expect(requests[1].message).toContain("rung 2 of 4");
    expect(controller.getSnapshot().learning.hintLevel).toBe(2);
    controller.setSettings({ ...DEFAULT_SETTINGS, learningEnabled: false });
    expect(controller.getSnapshot().learning.hintLevel).toBe(0);
    controller.dispose();
  });
  it("cancels provider work and never executes a late reply", async () => {
    document.body.innerHTML = "<button>Open workshop</button>";
    const clicked = vi.fn();
    document.querySelector("button")!.addEventListener("click", clicked);
    let reply: ((value: AgentReply) => void) | undefined;
    let providerSignal: AbortSignal | undefined;
    const b = bridge((input, signal) => {
      providerSignal = signal;
      const target = (input as { page: { elements: { id: string }[] } }).page.elements[0].id;
      return new Promise((resolve) => {
        reply = (value) => resolve({ ...value, action: { type: "click", target } });
      });
    });
    const controller = createCompanion(host(), b.api);
    await controller.start();
    const pending = controller.send("Open workshop");
    await vi.waitFor(() => expect(reply).toBeDefined());
    controller.stop();
    expect(providerSignal?.aborted).toBe(true);
    reply!({ action: { type: "say", text: "ignored" }, provider: "demo" });
    await pending;
    expect(clicked).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("resumes cached document listeners without replaying tasks or duplicating subscription", async () => {
    const b = bridge(async () => ({ action: { type: "say", text: "Ready" }, provider: "demo" }));
    const controller = createCompanion(host(), b.api);
    await controller.start();
    controller.suspend();
    await controller.resume();
    expect(b.request.mock.calls.some(([message]) => message.type === "agent.decide")).toBe(false);
    await controller.send("Read this page");
    expect(
      b.request.mock.calls.filter(([message]) => message.type === "agent.decide"),
    ).toHaveLength(1);
    controller.dispose();
    b.emit({ type: "task.run", taskId: task.id, goal: task.goal });
    expect(
      b.request.mock.calls.filter(([message]) => message.type === "agent.decide"),
    ).toHaveLength(1);
  });
  it("requires an explicit answer before submitting and records only verified progress", async () => {
    document.body.innerHTML = '<button>Register now</button><div id="out" role="status"></div>';
    let turn = 0;
    const b = bridge(async (input) => {
      const target = (input as { page: { elements: { id: string }[] } }).page.elements[0].id;
      return turn++ === 0
        ? { action: { type: "click", target }, provider: "demo" }
        : { action: { type: "finish", summary: "Registration verified" }, provider: "demo" };
    });
    document.querySelector("button")!.addEventListener("click", () => {
      document.getElementById("out")!.textContent = "Registration confirmed";
    });
    const controller = createCompanion(host(), b.api);
    await controller.start();
    const pending = controller.send("Register for this workshop");
    await vi.waitFor(() => expect(controller.getSnapshot().confirmation).not.toBeNull());
    expect(document.getElementById("out")!.textContent).toBe("");
    expect(
      b.request.mock.calls.some(
        ([message]) =>
          message.type === "task.intent" && String(message.nextStep).includes("Register now"),
      ),
    ).toBe(true);
    controller.confirm(true);
    await pending;
    expect(document.getElementById("out")!.textContent).toBe("Registration confirmed");
    const progress = b.request.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "task.progress");
    expect(progress.some((message) => message.action === "finish" && message.done === true)).toBe(
      true,
    );
    controller.dispose();
  });
  it("rejects malformed provider actions before any effects", async () => {
    document.body.innerHTML = "<button>Register</button>";
    const clicked = vi.fn();
    document.querySelector("button")!.addEventListener("click", clicked);
    const b = bridge(
      async () =>
        ({
          action: { type: "execute-script", text: "unsafe" },
          provider: "demo",
        }) as unknown as AgentReply,
    );
    const controller = createCompanion(host(), b.api);
    await controller.start();
    await controller.send("Register here");
    expect(clicked).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("error");
    controller.dispose();
  });
  it("does not claim registration completion after merely filling a field", async () => {
    document.body.innerHTML = "<label>Full name<input></label>";
    let turn = 0;
    const b = bridge(async (input) => {
      const target = (input as { page: { elements: { id: string }[] } }).page.elements[0].id;
      return turn++ === 0
        ? { action: { type: "type", target, text: "Alex Morgan" }, provider: "demo" }
        : { action: { type: "finish", summary: "Registration was successful" }, provider: "demo" };
    });
    const controller = createCompanion(host(), b.api);
    await controller.start();
    await controller.send("Complete this registration");
    expect(
      b.request.mock.calls.some(
        ([message]) => message.type === "task.progress" && message.done === true,
      ),
    ).toBe(false);
    expect(
      controller
        .getSnapshot()
        .messages.some((message) => message.text === "Registration was successful"),
    ).toBe(false);
    expect(controller.getSnapshot().messages.at(-1)?.text).toMatch(
      /no verified completion signal/i,
    );
    controller.dispose();
  });
  it("turns confirmed teach-back into graded evidence only when its quotation is grounded", async () => {
    document.body.innerHTML = "<h1>Equations</h1>";
    const statement = "adding the same number to both sides keeps an equation equal";
    const b = bridge(
      async () => ({
        action: { type: "say", text: "Explain why both sides stay equal." },
        provider: "demo",
      }),
      (message) =>
        message.type === "api" && message.path === "/api/learn/teachback"
          ? {
              status: "correct",
              hint: "You kept both sides balanced.",
              concept: "Equations",
              evidence: "the same number to both sides",
              provider: "openai",
            }
          : undefined,
    );
    const controller = createCompanion(host(), b.api);
    await controller.start();
    controller.setSettings({ ...DEFAULT_SETTINGS, learningEnabled: true });
    await controller.send(`I learned that ${statement}`);
    expect(controller.getSnapshot().learning.teaching?.concept).toBe("Equations");
    window.dispatchEvent(
      new CustomEvent("burrow:taught", {
        detail: { concept: "Forged", heard: "Unrelated", yes: true },
      }),
    );
    expect(b.request.mock.calls.some(([message]) => message.type === "learn.event")).toBe(false);
    controller.teach(true);
    await vi.waitFor(() =>
      expect(
        b.request.mock.calls.filter(([message]) => message.type === "learn.event"),
      ).toHaveLength(2),
    );
    const evidence = b.request.mock.calls
      .filter(([message]) => message.type === "learn.event")
      .map(([message]) => message.event as { correct: boolean });
    expect(evidence.map((event) => event.correct)).toEqual([false, true]);
    controller.dispose();
  });
});
