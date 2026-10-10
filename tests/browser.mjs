import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";
const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const { demoDecision } = await tsImport("../apps/gateway/src/agent.ts", import.meta.url);
import { runSpecialists } from "./specialists.mjs";
const token = "burrow-deterministic-browser-token";
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
        action: input.page.url.endsWith("/demo/learning/")
          ? { type: "finish", summary: "Destination page observed." }
          : { type: "navigate", url: base + "/demo/learning/", newTab: true },
        done: input.page.url.endsWith("/demo/learning/"),
        provider: "demo",
      };
    if (input.goal === "Browser verification: switch existing tab")
      return {
        action: input.page.url.endsWith("/demo/learning/")
          ? { type: "finish", summary: "Existing tab observed." }
          : { type: "switchTab", tabId: targetTabId },
        done: input.page.url.endsWith("/demo/learning/"),
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
      if (input.history.length)
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
try {
  let { ctx, sw, extensionId } = await launch();
  context = ctx;
  // A slow destination must retain the handoff instead of repeating the link
  // while its original document still reports the source URL.
  await ctx.route("**/demo/workshops/compare.html", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  const home = await ctx.newPage();
  await home.goto(`chrome-extension://${extensionId}/newtab.html`);
  await home.getByRole("button", { name: "Start task", exact: true }).waitFor();
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
  assert.equal("voice" in health.capabilities, false);
  await home.getByRole("button", { name: "Ask HypeMan mode", exact: true }).click();
  await home
    .getByRole("textbox", { name: "Ask HypeMan", exact: true })
    .fill("What can HypeMan do?");
  await home.getByRole("button", { name: "Ask HypeMan", exact: true }).click();
  await home.locator(".answer").waitFor();
  check("Rooftop, pairing health, distinct Ask HypeMan");
  for (const fixture of ctx.pages())
    if (fixture !== home) await fixture.close();
  await home.getByRole("button", { name: "Start task mode", exact: true }).click();
  await home
    .locator("#task-goal")
    .fill(
      `Find a beginner workshop under $75, compare two options, prepare registration, and request confirmation before submission. Start at ${base}/demo/workshops/`,
    );
  await home.getByRole("button", { name: "Start task", exact: true }).click();
  const taskPage = await waitFor(
    () => Promise.resolve(ctx.pages().find((p) => p.url().includes("/demo/workshops/"))),
    "workshop tab",
  );
  await waitFor(async () => {
    const state = await rpc(home, { type: "workspace.get" });
    return state.notes.some(
      (note) =>
        note.url.endsWith("/demo/workshops/compare.html") &&
        note.text.includes("Pottery Basics") &&
        note.text.includes("Printmaking for Everyone"),
    );
  }, "comparison read and both source options saved", 30000);
  await waitFor(async () => {
    const state = await rpc(home, { type: "workspace.get" });
    return state.events.some(
      (event) =>
        event.ok &&
        event.url.endsWith("/demo/workshops/pottery.html") &&
        /destination document observed and verified/i.test(event.summary),
    );
  }, "chosen workshop observed after navigation", 30000);
  await taskPage
    .getByRole("alertdialog", { name: "Confirm browser action" })
    .waitFor({ timeout: 30000 });
  assert.equal(
    demoTrace.filter(
      ({ url, decision }) =>
        new URL(url).pathname === "/demo/workshops/" && decision.action.type === "click",
    ).length,
    1,
    "The comparison link must be clicked once while its destination is loading.",
  );
  await taskPage.waitForFunction(() =>
    ["Press Start 2P", "VT323"].every((family) =>
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
  await taskPage.getByRole("button", { name: "Cancel action", exact: true }).click();
  assert.equal(await taskPage.locator("#registration-success").isVisible(), false);
  check(
    "Delayed link navigation continues once, source-backed comparison and prepared fields require confirmation",
  );
  // A new explicit instruction is necessary after declining the pending action.
  await taskPage
    .getByLabel("Message your companion")
    .fill("Prepare registration and request confirmation before submitting");
  await taskPage.getByRole("button", { name: "Send message", exact: true }).click();
  await taskPage.getByRole("alertdialog", { name: "Confirm browser action" }).waitFor();
  await taskPage.getByRole("button", { name: "Yes, continue", exact: true }).click();
  await taskPage.locator("#registration-success").waitFor();
  const finished = await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.tasks.some((t) => t.status === "completed") ? s : null;
  }, "verified completion");
  assert.ok(finished.notes.length >= 2);
  assert.ok(finished.events.some((e) => e.action === "finish" && e.ok));
  assert.ok(
    finished.tasks.find((t) => t.status === "completed").steps.every((s) => s.status === "done"),
  );
  check(
    "Confirmed submission produces verified completion, durable source notes and action history",
  );
  const control = await ctx.newPage();
  await control.goto(`chrome-extension://${extensionId}/newtab.html#notes`);
  await control.locator(".note-card").first().waitFor();
  await control
    .locator(".note-card")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await control.getByLabel("Your note").fill("Pottery Basics: $60, beginner, materials included.");
  await control.getByRole("button", { name: "Save note", exact: true }).click();
  await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.notes.some(
      (n) => n.text.startsWith("Pottery Basics: $60") && n.url.includes("workshops"),
    );
  }, "note edit");
  const downloadPromise = control.waitForEvent("download");
  await control.getByRole("button", { name: "Export workspace", exact: false }).click();
  const download = await downloadPromise;
  assert.match(await readFile(await download.path(), "utf8"), /Pottery Basics/);
  await control.goto(`chrome-extension://${extensionId}/newtab.html#activity`);
  await control.locator(".inline-action-list article").first().waitFor();
  await control.screenshot({ path: "tests/screenshots/control.png", fullPage: true });
  check(
    "Inline collections edit source-linked notes, export workspace and display verified action history",
  );
  await control.close();
  const pending = await rpc(home, {
    type: "task.start",
    goal: "Read this page carefully",
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
    patch: { characterName: "Moss", reducedMotion: "on", learningEnabled: true },
  });
  await taskPage.getByRole("button", { name: /Open Moss\. Drag/ }).click();
  await waitFor(
    () =>
      taskPage
        .locator(".companion-header strong")
        .textContent()
        .then((v) => v?.includes("Moss")),
    "live companion name",
  );
  check("Live name, learning and reduced-motion settings propagate");
  const learn = await ctx.newPage();
  await learn.goto(`${base}/demo/learning/`);
  await learn.getByRole("button", { name: /Open Moss\. Drag/ }).click();
  assert.equal(await learn.locator(".companion-tools").count(), 0);
  assert.equal(await learn.locator(".companion-task").count(), 0);
  assert.equal(await learn.getByRole("button", { name: /microphone|speech|voice/i }).count(), 0);
  const dock = await learn.locator(".companion-panel").boundingBox();
  assert.ok(dock.width <= 340 && dock.height < 250);
  await learn
    .locator(".companion-panel")
    .screenshot({ path: "tests/screenshots/minimal-dock.png" });
  check("Compact icon dock hides tools and task details with no speech controls");
  await learn.getByLabel("Message your companion").fill("Make a learning plan for this page");
  await learn.getByRole("button", { name: "Send message", exact: true }).click();
  await waitFor(async () => {
    const g = await rpc(home, { type: "graph.get" });
    return g.plans.length > 0;
  }, "learning plan");
  await learn.getByRole("button", { name: "More tools", exact: true }).click();
  await learn.getByRole("button", { name: "Learning tools", exact: true }).click();
  await learn.getByRole("button", { name: "A little hint", exact: true }).click();
  await learn.waitForTimeout(200);
  await learn.getByLabel("Message your companion").fill("Sketch an analogous equation");
  await learn.getByRole("button", { name: "Send message", exact: true }).click();
  await learn.locator(".panel-sketch").waitFor();
  check("Optional learning plans, graduated hint entry and chalkboard sketch");
  await learn.close();
  const board = await ctx.newPage();
  await board.goto(`chrome-extension://${extensionId}/board.html`);
  const canvas = board.locator("canvas");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  await board.mouse.move(box.x + 80, box.y + 80);
  await board.mouse.down();
  await board.mouse.move(box.x + 180, box.y + 130, { steps: 12 });
  await board.mouse.up();
  await board.getByRole("button", { name: "Undo", exact: true }).click();
  await board.getByRole("button", { name: "Redo", exact: true }).click();
  await board.getByRole("button", { name: "Check my work", exact: false }).click();
  await board.locator(".ink-feedback").waitFor();
  await board.screenshot({ path: "tests/screenshots/board.png", fullPage: true });
  check("Drawing board stroke, undo/redo and labeled fixture feedback");
  await board.close();
  const video = await ctx.newPage();
  await video.goto(`chrome-extension://${extensionId}/video.html`);
  await video
    .getByLabel("Or paste a transcript")
    .fill(
      "Apply the same operation to both sides of an equation. Then explain why equality stays true.",
    );
  await video.getByRole("button", { name: "Find the thread", exact: false }).click();
  await video.locator(".video-summary").waitFor();
  assert.ok((await video.locator(".chapter-list button").count()) > 0);
  check("Caption-backed video chapters and contextual notes");
  await video.close();
  const character = await ctx.newPage();
  await character.goto(`chrome-extension://${extensionId}/customize.html`);
  await character
    .locator("input[type=file]")
    .setInputFiles(resolve("apps/extension/public/assets/icons/icon128.png"));
  await character.getByLabel("Companion name", { exact: true }).fill("Clover");
  await character.getByRole("button", { name: "Save & use companion", exact: false }).click();
  await character.locator(".character-shelf").waitFor();
  await character.reload();
  await character.locator(".character-shelf").waitFor();
  assert.equal((await rpc(home, { type: "settings.get" })).characterName, "Clover");
  check("Local custom character processing, saving and reloading");
  await character.close();

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
    url: base + "/demo/workshops/",
  });
  const crossState = await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.tasks.find((t) => t.id === cross.id)?.status === "completed" ? s : null;
  }, "new-tab continuation");
  assert.ok(
    crossState.tasks.find((t) => t.id === cross.id).lastPage.url.endsWith("/demo/learning/"),
  );
  await rpc(home, { type: "settings.patch", patch: { tabContextEnabled: true } });
  targetTabId = await home.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
    base + "/demo/learning/",
  );
  assert.ok(Number.isInteger(targetTabId));
  const switched = await rpc(home, {
    type: "task.start",
    goal: "Browser verification: switch existing tab",
    url: base + "/demo/workshops/",
  });
  await waitFor(async () => {
    const s = await rpc(home, { type: "workspace.get" });
    return s.tasks.find((t) => t.id === switched.id)?.status === "completed";
  }, "existing-tab handoff");
  assert.equal(
    (await rpc(home, { type: "workspace.get" })).tasks.find((t) => t.id === switched.id).tabId,
    targetTabId,
  );
  check("New-tab and existing-tab handoffs preserve task ownership and verified continuation");
  const slow = await rpc(home, {
    type: "task.start",
    goal: "Browser verification: cancel delayed decision",
    url: base + "/demo/learning/",
  });
  await waitFor(() => slowStarted > 0, "delayed decision started");
  const slowPage = ctx
    .pages()
    .filter((p) => p.url() === base + "/demo/learning/")
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
    url: base + "/demo/learning/",
  });
  await waitFor(() => staleStarted > 0, "stale decision started");
  const stalePage = ctx
    .pages()
    .filter((p) => p.url() === base + "/demo/learning/")
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
  await rpc(home, { type: "task.start", goal: "A task to resume after restart", dispatch: false });
  await ctx.close();
  context = null;
  ({ ctx, sw, extensionId } = await launch());
  context = ctx;
  const resumed = await ctx.newPage();
  await resumed.goto(`chrome-extension://${extensionId}/newtab.html`);
  await resumed.getByRole("button", { name: "Continue task", exact: true }).waitFor();
  const recovered = await rpc(resumed, { type: "workspace.get" });
  assert.equal(recovered.activeTaskId, null);
  assert.equal(recovered.tasks.at(-1).status, "paused");
  assert.equal(recovered.tasks.at(-1).tabId, null);
  check("Browser restart restores a paused resume icon and requires explicit continuation");
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
            workspace: (await chrome.storage.local.get("burrow.workspace"))["burrow.workspace"],
            sessions: Object.fromEntries(
              Object.entries(await chrome.storage.session.get(null)).filter(([key]) =>
                key.startsWith("burrow.tab."),
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
