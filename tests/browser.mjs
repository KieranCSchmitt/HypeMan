import { installBrowserFixtures } from "./fixtures/browser-pages.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";
const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const { demoDecision } = await tsImport("../apps/gateway/src/agent.ts", import.meta.url);
import { runSpecialists } from "./specialists.mjs";
const token = "hypeman-deterministic-browser-token";
let targetTabId = null,
  slowStarted = 0,
  slowCancelled = 0,
  staleStarted = 0;
const demoTrace = [];
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token,
  agent: async (input, signal) => {
    if (input.goal === "Browser verification: open another tab")
      return {
        action: input.page.url.endsWith("/__test/learning/")
          ? { type: "say", text: "Destination page observed." }
          : { type: "navigate", url: base + "/__test/learning/", newTab: true },
        done: input.page.url.endsWith("/__test/learning/"),
        provider: "demo",
      };
    if (input.goal === "Browser verification: switch existing tab")
      return {
        action: input.page.url.endsWith("/__test/learning/")
          ? { type: "say", text: "Existing tab observed." }
          : { type: "switchTab", tabId: targetTabId },
        done: input.page.url.endsWith("/__test/learning/"),
        provider: "demo",
      };
    if (input.goal === "Browser verification: cancel delayed decision") {
      slowStarted++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve({
              action: {
                type: "type",
                target: input.page.elements.find((e) => e.name === "Value of x")?.id,
                text: "999",
              },
              provider: "demo",
            }),
          2000,
        );
        signal.addEventListener(
          "abort",
          () => {
            slowCancelled++;
            clearTimeout(timer);
            reject(new DOMException("Cancelled", "AbortError"));
          },
          { once: true },
        );
      });
    }
    if (input.goal === "Browser verification: reject stale target") {
      if (input.history.some((entry) => entry.action.type === "click" && !entry.result.ok))
        return {
          action: { type: "say", text: "Target was replaced; action rejected." },
          done: true,
          provider: "demo",
        };
      staleStarted++;
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              action: {
                type: "click",
                target: input.page.elements.find((e) => e.name === "Check answer")?.id,
              },
              provider: "demo",
            }),
          500,
        ),
      );
    }
    const decision = demoDecision(input);
    demoTrace.push({
      url: input.page.url,
      history: input.history.map((entry) => ({ action: entry.action.type, result: entry.result })),
      decision,
    });
    return decision;
  },
});
const port = await gateway.listen(),
  base = `http://127.0.0.1:${port}`;
console.log("Test gateway", base, (await fetch(base + "/health")).status);
const extension = resolve("apps/extension/dist");
await mkdir("tests/screenshots", { recursive: true });
const profile = await mkdtemp(resolve("tests/.profile-"));
let context,
  checks = 0;
const check = (name) => {
  checks++;
  console.log(`✓ ${name}`);
};
async function launch() {
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--enable-unsafe-extension-debugging",
    ],
  });
  await installBrowserFixtures(ctx);
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  sw.on("console", (m) => console.log("Worker:", m.text()));
  ctx.on(
    "requestfailed",
    (r) =>
      r.failure()?.errorText !== "net::ERR_ABORTED" &&
      console.log("Request failed:", r.url(), r.failure()?.errorText),
  );
  const extensionId = new URL(sw.url()).host;
  return { ctx, sw, extensionId };
}
async function waitFor(fn, description, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function rpc(page, message) {
  return page.evaluate(async (message) => {
    const r = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    if (!r?.ok) throw new Error(r?.error || "No response");
    return r.data;
  }, message);
}
async function contentRpc(home, tabId, message) {
  return home.evaluate(async ({ tabId, message }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (message) => {
        const response = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
        if (!response?.ok) throw new Error(response?.error || "No response");
        return response.data;
      },
      args: [message],
    });
    return result.result;
  }, { tabId, message });
}
async function acknowledgeProject(home, taskId) {
  for (;;) {
    const state = await rpc(home, { type: "workspace.get" });
    const task = state.tasks.find((item) => item.id === taskId);
    if (task.status === "completed") return state;
    const step = task.steps.find((item) => item.status === "doing");
    assert.ok(step, "The project exposes exactly the current milestone for acknowledgement");
    await contentRpc(home, task.tabId, { type: "task.step.confirm", taskId, stepId: step.id });
  }
}
try {
  let { ctx, sw, extensionId } = await launch();
  context = ctx;
  // A slow destination must retain the handoff instead of repeating the link
  // while its original document still reports the source URL.
  await ctx.route("**/__test/workshops/compare.html", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fallback();
  });

  const home = await ctx.newPage();
  await home.goto(`chrome-extension://${extensionId}/newtab.html#chat`);
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).waitFor();
  await rpc(home, {
    type: "settings.patch",
    patch: {
      serverUrl: base,
      serverToken: token,
      onboarded: true,
      reducedMotion: "on",
    },
  });
  await home.screenshot({ path: "tests/screenshots/rooftop.png", fullPage: true });
  const health = await rpc(home, { type: "health" });
  assert.equal(health.demoMode, true);
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).fill("What can HypeMan do?");
  await home.getByRole("button", { name: "Send message", exact: true }).click();
  await home.locator(".conversation-messages .chat-message.assistant").first().waitFor();
  await home.getByRole("button", { name: "Send message", exact: true }).waitFor();
  assert.equal((await rpc(home, { type: "workspace.get" })).tasks.length, 0);
  check("Shared conversation and pairing health answer ordinary questions without project creation");
  for (const fixture of ctx.pages())
    if (fixture !== home) await fixture.close();
  await home
    .locator("#task-goal")
    .fill(
      `Find a beginner workshop under $75, compare two options, prepare registration, and request confirmation before submission. Wait for me between milestones. Start at ${base}/__test/workshops/`,
    );
  await home.getByRole("button", { name: "Send message", exact: true }).click();
  const taskPage = await waitFor(
    () => Promise.resolve(ctx.pages().find((p) => p.url().includes("/__test/workshops/"))),
    "workshop tab",
  );
  await taskPage.bringToFront();
  const project = await waitFor(async () => {
    const state = await rpc(home, { type: "workspace.get" });
    return state.tasks.find((task) => task.status === "running");
  }, "meaningful workshop milestones saved before browser actions");
  assert.equal(project.steps.length, 3);
  assert.deepEqual(project.steps.map((step) => step.status), ["doing", "todo", "todo"]);
  assert.equal((await rpc(home, { type: "workspace.get" })).notes.length, 0);
  const chat = async (text) => {
    const field = taskPage.getByLabel("What do you need?");
    if (!(await field.isVisible()))
      await taskPage.getByRole("button", { name: /Open HypeMan\. Drag/ }).click();
    await taskPage.getByRole("button", { name: "Send message", exact: true }).waitFor();
    await field.fill(text);
    await taskPage.getByRole("button", { name: "Send message", exact: true }).click();
  };
  await chat("Help me compare the two workshop options.");
  await waitFor(async () => {
    const state = await rpc(home, { type: "workspace.get" });
    return state.notes.some(
      (note) =>
        note.url.endsWith("/__test/workshops/compare.html") &&
        note.text.includes("Pottery Basics") &&
        note.text.includes("Printmaking for Everyone"),
    );
  }, "comparison read and both source options saved", 30000);
  await waitFor(async () => {
    const state = await rpc(home, { type: "workspace.get" });
    return state.tasks.find((task) => task.id === project.id)?.steps[0].status === "done";
  }, "visible comparison outcome completes the first milestone", 30000);
  assert.match(taskPage.url(), /compare\.html/);
  await chat("Help me prepare the Pottery Basics registration.");
  await waitFor(async () => {
    const state = await rpc(home, { type: "workspace.get" });
    return state.events.some(
      (event) =>
        event.ok &&
        event.url.endsWith("/__test/workshops/pottery.html") &&
        /destination document observed and verified/i.test(event.summary),
    );
  }, "chosen workshop observed after navigation", 30000);
  await waitFor(async () => {
    const state = await rpc(home, { type: "workspace.get" });
    return state.tasks.find((task) => task.id === project.id)?.steps[1].status === "done";
  }, "prepared fields complete the second milestone without submission", 30000);
  await chat("Submit the prepared registration after asking for confirmation.");
  await taskPage.getByRole("alertdialog", { name: "Confirm browser action" }).waitFor({ timeout: 30000 });
  assert.equal(
    demoTrace.filter(
      ({ url, decision }) =>
        url && new URL(url).pathname === "/__test/workshops/" && decision.action.type === "click",
    ).length,
    1,
    "The comparison link must be clicked once while its destination is loading.",
  );
  await taskPage.waitForFunction(() =>
    ["Press Start 2P", "Tiny5"].every((family) =>
      Array.from(document.fonts).some((face) => face.family === family && face.status === "loaded"),
    ),
  );
  assert.match(taskPage.url(), /register\.html/);
  assert.equal(await taskPage.getByLabel("Full name", { exact: true }).inputValue(), "Alex Morgan");
  assert.equal(
    await taskPage.getByLabel("Email", { exact: true }).inputValue(),
    "alex@example.com",
  );
  assert.equal(await taskPage.locator("#registration-success").isVisible(), false);
  await taskPage.screenshot({ path: "tests/screenshots/confirmation.png", fullPage: true });
  await taskPage.getByRole("alertdialog", { name: "Confirm browser action" }).getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await taskPage.locator("#registration-success").isVisible(), false);
  check(
    "Delayed link navigation continues once, source-backed comparison and prepared fields require confirmation",
  );
  // A new explicit instruction is necessary after declining the pending action.
  await taskPage
    .getByLabel("What do you need?")
    .fill("Prepare registration and request confirmation before submitting");
  await taskPage.getByRole("button", { name: "Send message", exact: true }).click();
  await taskPage.getByRole("alertdialog", { name: "Confirm browser action" }).waitFor();
  await taskPage.getByRole("alertdialog", { name: "Confirm browser action" }).getByRole("button", { name: "Register", exact: true }).click();
  await taskPage.locator("#registration-success").waitFor();
  const finished = await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.tasks.some((t) => t.status === "completed") ? s : null;
  }, "verified completion");
  assert.ok(finished.notes.length >= 2);
  assert.ok(finished.events.some((e) => e.action === "finish" && e.ok));
  assert.equal(finished.events.filter((e) => e.taskId === project.id && e.action === "milestone").length, 3);
  assert.ok(
    finished.tasks.find((t) => t.status === "completed").steps.every((s) => s.status === "done"),
  );
  check(
    "Confirmed submission produces verified completion, durable source notes and action history",
  );
  const control = await ctx.newPage();
  await control.goto(`chrome-extension://${extensionId}/newtab.html#notes`);
  await control.locator(".note-card").first().waitFor();
  const directNote = control.locator(".note-card .direct-note-editor").first();
  await directNote.fill("Pottery Basics: $60, beginner, materials included.");
  await directNote.press("Tab");
  await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.notes.some(
      (n) => n.text.startsWith("Pottery Basics: $60") && n.url.includes("workshops"),
    );
  }, "note edit");
  const downloadPromise = control.waitForEvent("download");
  await control.getByRole("textbox", { name: "What do you need?", exact: true }).fill("export workspace");
  await control.getByRole("button", { name: "Send message", exact: true }).click();
  const download = await downloadPromise;
  assert.match(await readFile(await download.path(), "utf8"), /Pottery Basics/);
  await control.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await control.getByRole("textbox", { name: "What do you need?", exact: true }).fill("open activity");
  await control.getByRole("button", { name: "Send message", exact: true }).click();
  await control.locator(".inline-action-list article").first().waitFor();
  await control.screenshot({ path: "tests/screenshots/control.png", fullPage: true });
  check(
    "Inline collections edit source-linked notes, export workspace and display verified action history",
  );
  await control.close();
  const pending = await rpc(home, {
    type: "task.start",
    goal: "Read this page and draft a source summary",
    steps: ["Read the source material", "Draft a source summary"],
    dispatch: false,
  });
  await rpc(home, { type: "task.pause", id: pending.id });
  await rpc(home, { type: "settings.patch", patch: { hiddenOnHosts: ["127.0.0.1"] } });
  let outbound = 0;
  const count = (request) => {
    if (request.url().includes("/api/")) outbound++;
  };
  ctx.on("request", count);
  await taskPage.reload();
  await taskPage.waitForTimeout(300);
  const before = outbound;
  assert.equal(await taskPage.locator(".pet-handle").isVisible(), false);
  await assert.rejects(
    rpc(home, {
      type: "agent.decide",
      input: {
        requestId: crypto.randomUUID(),
        goal: "Summarize page",
        message: "Summarize page",
        mode: "browse",
        history: [],
        page: {
          url: taskPage.url(),
          title: "Paused page",
          headings: [],
          text: "Source",
          elements: [],
          errors: [],
          successes: [],
          selection: "",
          frames: { count: 0, inaccessible: 0 },
          capturedAt: Date.now(),
          revision: 1,
        },
      },
    }),
    /paused/i,
  );
  await taskPage.waitForTimeout(300);
  assert.equal(outbound, before);
  await rpc(home, { type: "settings.patch", patch: { hiddenOnHosts: [] } });
  ctx.off("request", count);
  check("Paused site stays silent across reload and attempted page request");
  // Live settings update the content UI without a page reload.
  await rpc(home, {
    type: "settings.patch",
    patch: { reducedMotion: "on", learningEnabled: true },
  });
  const learn = await ctx.newPage();
  await learn.goto(`${base}/__test/learning/`);
  await learn.getByRole("button", { name: /Open HypeMan\. Drag/ }).click();
  assert.equal(await learn.locator(".companion-tools").count(), 0);
  assert.equal(await learn.locator(".companion-task").count(), 0);
  assert.equal(await learn.getByRole("button", { name: /More tools|Practice|Whiteboard|Quick answer mode/ }).count(), 0);
  const dock = await learn.locator(".conversation-pane").boundingBox();
  assert.ok(dock.width <= 1440 && dock.height <= 1000);
  await learn.locator(".conversation-pane").screenshot({ path: "tests/screenshots/minimal-dock.png" });
  check("Shared conversation has no mode switches or tool launchers, with essential controls retained");
  await learn.getByLabel("What do you need?").fill("Make a learning plan for this page");
  await learn.getByRole("button", { name: "Send message", exact: true }).click();
  await waitFor(async () => {
    const g = await rpc(home, { type: "graph.get" });
    return g.plans.length > 0;
  }, "learning plan");
  await learn.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await learn.getByLabel("What do you need?").fill("a hint");
  await learn.getByRole("button", { name: "Send message", exact: true }).click();
  await learn.locator(".inline-toolbox-learning").waitFor();
  await learn.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await learn.getByLabel("What do you need?").fill("Sketch an analogous equation");
  await learn.getByRole("button", { name: "Send message", exact: true }).click();
  await learn.locator(".shared-board").waitFor();
  check("Optional learning plans, graduated hint entry and chalkboard sketch");
  await learn.close();
  const board = await ctx.newPage();
  await board.goto(`chrome-extension://${extensionId}/board.html`);
  const canvas = board.locator(".drawing-canvas");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  await board.mouse.move(box.x + 80, box.y + 80);
  await board.mouse.down();
  await board.mouse.move(box.x + 180, box.y + 130, { steps: 12 });
  await board.mouse.up();
  const boardChat = async (text) => {
    await board.getByRole("button", { name: "Send message", exact: true }).waitFor();
    await board.getByRole("textbox", { name: "What do you need?", exact: true }).fill(text);
    await board.getByRole("button", { name: "Send message", exact: true }).click();
  };
  await boardChat("undo");
  await waitFor(async () => await board.locator(".board-objects [role=option]").count() === 0, "whiteboard undo");
  await boardChat("redo");
  await waitFor(async () => await board.locator(".board-objects [role=option]").count() === 1, "whiteboard redo");
  await boardChat("check my work");
  await board.locator(".ink-feedback").waitFor();
  await board.screenshot({ path: "tests/screenshots/board.png", fullPage: true });
  check("Drawing board stroke, undo/redo and labeled fixture feedback");
  await board.close();
  const video = await ctx.newPage();
  await video.goto(`chrome-extension://${extensionId}/video.html`);
  await video.getByRole("tab", { name: "Transcript", exact: true }).click();
  await video.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await video
    .getByLabel("Video transcript")
    .fill(
      "Apply the same operation to both sides of an equation. Then explain why equality stays true.",
    );
  await video.getByRole("textbox", { name: "What do you need?", exact: true }).fill("summarize this video");
  await video.getByRole("button", { name: "Send message", exact: true }).click();
  await video.getByRole("tab", { name: "Summary", exact: true }).click();
  await video.locator(".video-summary").waitFor();
  await video.getByRole("tab", { name: "Chapters", exact: true }).click();
  assert.ok((await video.locator(".chapter-list button").count()) > 0);
  check("Caption-backed video chapters and contextual notes");
  await video.close();

  await runSpecialists({ ctx, home, rpc, base, extensionId, check });
  await rpc(home, { type: "settings.patch", patch: { learningEnabled: false } });
  const countBefore = (await rpc(home, { type: "workspace.get" })).events.length;
  await taskPage.goBack();
  await taskPage.waitForTimeout(300);
  await taskPage.goForward();
  await taskPage.waitForTimeout(300);
  assert.equal((await rpc(home, { type: "workspace.get" })).events.length, countBefore);
  check("User Back/Forward restoration does not replay a completed task");
  // These views have finished their assertions. Retain only the RPC page while
  // later scenarios create their own task tabs and exercise explicit ownership.
  for (const fixture of ctx.pages())
    if (fixture !== home) await fixture.close();
  const cross = await rpc(home, {
    type: "task.start",
    goal: "Browser verification: open another tab",
    steps: ["Open the lesson in another tab", "Review the observed lesson"],
    url: base + "/__test/workshops/",
  });
  const arrived = await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.events.some((event) => event.taskId === cross.id && event.action === "say" && event.ok && event.summary === "Destination page observed." && event.url.endsWith("/__test/learning/")) ? s : null;
  }, "new-tab continuation");
  assert.ok(
    arrived.tasks.find((t) => t.id === cross.id).lastPage.url.endsWith("/__test/learning/"),
  );
  assert.equal(arrived.tasks.find((t) => t.id === cross.id).status, "running", "A verified browser action does not complete project milestones");
  const crossState = await acknowledgeProject(home, cross.id);
  assert.ok(crossState.tasks.find((t) => t.id === cross.id).steps.every((step) => step.completion?.source === "user"));
  await rpc(home, { type: "settings.patch", patch: { tabContextEnabled: true } });
  targetTabId = await home.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
    base + "/__test/learning/",
  );
  assert.ok(Number.isInteger(targetTabId));
  const switched = await rpc(home, {
    type: "task.start",
    goal: "Browser verification: switch existing tab",
    steps: ["Continue in the selected website tab", "Review the observed destination"],
    url: base + "/__test/workshops/",
  });
  const switchState = await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.events.some((event) => event.taskId === switched.id && event.action === "say" && event.ok && event.summary === "Existing tab observed." && event.url.endsWith("/__test/learning/")) ? s : null;
  }, "existing-tab handoff");
  assert.equal(
    switchState.tasks.find((t) => t.id === switched.id).tabId,
    targetTabId,
  );
  assert.equal(switchState.tasks.find((t) => t.id === switched.id).status, "running", "Observing the selected tab does not complete project milestones");
  const acknowledgedSwitch = await acknowledgeProject(home, switched.id);
  assert.ok(acknowledgedSwitch.tasks.find((t) => t.id === switched.id).steps.every((step) => step.completion?.source === "user"));
  check("New-tab and existing-tab handoffs preserve task ownership and verified continuation");
  const slow = await rpc(home, {
    type: "task.start",
    goal: "Browser verification: cancel delayed decision",
    steps: ["Fill the requested practice field", "Review the practice result"],
    url: base + "/__test/learning/",
  });
  await waitFor(() => slowStarted > 0, "delayed decision started");
  const slowPage = ctx
    .pages()
    .filter((p) => p.url() === base + "/__test/learning/")
    .at(-1);
  await slowPage.keyboard.press("Escape");
  await waitFor(() => slowCancelled > 0, "gateway request cancellation");
  assert.equal(await slowPage.getByLabel("Value of x").inputValue(), "");
  await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.tasks.find((t) => t.id === slow.id)?.status === "paused";
  }, "cancelled task paused");
  check("Escape cancels the gateway/provider request and prevents late input");
  const stale = await rpc(home, {
    type: "task.start",
    goal: "Browser verification: reject stale target",
    steps: ["Check the practice answer", "Review the practice feedback"],
    url: base + "/__test/learning/",
  });
  await waitFor(() => staleStarted > 0, "stale decision started");
  const stalePage = ctx
    .pages()
    .filter((p) => p.url() === base + "/__test/learning/")
    .at(-1);
  await stalePage.evaluate(() => {
    const node = document.querySelector("#check");
    const replacement = node.cloneNode(true);
    replacement.addEventListener(
      "click",
      () => (document.querySelector("#feedback").textContent = "Unexpected stale click"),
    );
    node.replaceWith(replacement);
  });
  await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.events.some(
      (e) => e.taskId === stale.id && !e.ok && /target changed/i.test(e.summary),
    );
  }, "stale target rejected");
  assert.equal(await stalePage.locator("#feedback").textContent(), "");
  await rpc(home, { type: "task.pause", id: stale.id });
  check("Changed DOM target is rejected before execution");
  const durableBefore = await rpc(home, { type: "workspace.get" });
  const cdp = await ctx.newCDPSession(home);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await cdp.detach();
  const durableAfter = await rpc(home, { type: "workspace.get" });
  assert.deepEqual(durableAfter, durableBefore);
  check("MV3 worker restart retains durable memory without replay or duplicate events");
  // Simulate a worker reload by clearing session marker; browser restart then recovers execution as paused.
  await rpc(home, { type: "task.start", goal: "A project to resume after restart",
    steps: ["Review source material", "Draft the source summary"], dispatch: false });
  await ctx.close();
  context = null;
  ({ ctx, sw, extensionId } = await launch());
  context = ctx;
  const resumed = await ctx.newPage();
  await resumed.goto(`chrome-extension://${extensionId}/newtab.html#chat`);
  await resumed.getByRole("textbox", { name: "What do you need?", exact: true }).fill("open projects");
  await resumed.getByRole("button", { name: "Send message", exact: true }).click();
  await resumed.locator(".task-card").filter({ hasText: "A project to resume after restart" }).waitFor();
  const recovered = await rpc(resumed, { type: "workspace.get" });
  assert.equal(recovered.activeTaskId, null);
  assert.equal(recovered.tasks.at(-1).status, "paused");
  assert.equal(recovered.tasks.at(-1).tabId, null);
  check("Browser restart restores a paused project and requires explicit conversational continuation");
  console.log(`\n${checks} deterministic browser scenarios passed.`);
} catch (error) {
  if (context) {
    const pages = context.pages();
    for (let i = 0; i < pages.length; i++)
      await pages[i].screenshot({ path: `tests/screenshots/failure-${i}.png` }).catch(() => {});
    console.error(
      "Open pages:",
      pages.map((p) => p.url()),
    );
    console.error("Recent demo decisions:", JSON.stringify(demoTrace.slice(-8)));
    const worker = context.serviceWorkers()[0];
    if (worker)
      console.error(
        "Task continuation state:",
        await worker
          .evaluate(async () => JSON.stringify({
            workspace: (await chrome.storage.local.get("hypeman.workspace"))["hypeman.workspace"],
            sessions: Object.fromEntries(
              Object.entries(await chrome.storage.session.get(null)).filter(([key]) =>
                key.startsWith("hypeman.tab."),
              ),
            ),
          }))
          .catch(() => "Worker unavailable"),
      );
  }
  throw error;
} finally {
  if (context) await context.close();
  await gateway.close();
  await rm(profile, { recursive: true, force: true });
}
