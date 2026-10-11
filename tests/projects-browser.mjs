import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const token = "hypeman-project-browser-fixture";
const milestones = ["Compare two workshop options", "Prepare a draft on another website", "Review the project together"];
const comparison = "Comparison complete: the pottery workshop is $45 and printmaking is $60.";
const draftEvidence = "Draft preparation complete: both workshop options are included.";
const decisions = [], assessments = [];
let assessmentMode = "normal", heldAssessment = null, checks = 0;
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token,
  agent: async (input) => {
    decisions.push(input);
    return {
      action: !input.task && /\bproject\b/i.test(input.message)
        ? { type: "plan", goal: input.goal, steps: milestones }
        : { type: "say", text: "A workshop is a practical session where people learn by doing." },
      done: true,
      provider: "demo",
    };
  },
  assessTask: async (input, signal) => {
    const mode = assessmentMode;
    assessments.push({ input, mode });
    const step = input.task.steps.find((item) => item.status !== "done");
    if (mode === "wrong-step")
      return { stepId: "step-3", completed: true, evidence: draftEvidence };
    if (mode === "hold") {
      return new Promise((resolve, reject) => {
        const abort = () => {
          heldAssessment = null;
          reject(new DOMException("Cancelled", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        heldAssessment = () => {
          signal.removeEventListener("abort", abort);
          heldAssessment = null;
          resolve({ stepId: step.id, completed: true, evidence: draftEvidence });
        };
      });
    }
    return {
      stepId: step.id,
      completed: step.id === "step-1" && input.page.text.includes(comparison),
      evidence: step.id === "step-1" && input.page.text.includes(comparison) ? comparison : "",
    };
  },
});

function fixtureHtml(other = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${other ? "Draft workspace" : "Workshop comparison"}</title>
<style>body{font:20px system-ui;max-width:42rem;margin:3rem auto;padding:1rem;line-height:1.6}button,input{font:inherit;padding:.5rem}p{min-height:2rem}</style></head>
<body><main><h1>${other ? "Draft workspace" : "Workshop comparison"}</h1>
${other ? '<label for="draft">Project draft</label><input id="draft" autocomplete="off">'
  : '<p>Pottery workshop: $45. Printmaking workshop: $60.</p><button id="compare">Compare options</button><p><a id="next" href="/next">Review comparison details</a></p>'}
<p id="outcome">${other ? "Prepare a draft when you are ready." : "Choose two options to compare."}</p>
<p id="decoration">A project can move between websites.</p>
<button id="publish">Publish project</button></main>
<script>window.publications=0;document.querySelector('#publish').onclick=()=>window.publications++;
document.querySelector('#compare')?.addEventListener('click',()=>document.querySelector('#outcome').textContent=${JSON.stringify(comparison)});
</script></body></html>`;
}
const fixture = http.createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixtureHtml());
});
const otherSite = http.createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixtureHtml(true));
});
const profile = await mkdtemp(join(tmpdir(), "hypeman-projects-"));
const extension = resolve("apps/extension/dist");
let context, worker, home, article;
const check = (name) => { checks++; console.log(`✓ ${name}`); };
async function waitFor(predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1360, height: 960 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"],
  });
  context.setDefaultTimeout(15_000);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  home = await context.newPage();
  await home.goto(`chrome-extension://${extensionId}/newtab.html#chat`);
  await home.locator("#task-goal").waitFor();
  for (const page of context.pages()) if (page !== home) await page.close();
}
async function rpc(message) {
  return home.evaluate(async (message) => {
    const response = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    if (!response?.ok) throw new Error(response?.error || "No extension response");
    return response.data;
  }, message);
}
async function state() { return rpc({ type: "workspace.get" }); }
async function project(id) { return (await state()).tasks.find((task) => task.id === id); }
async function openWebsite(url) {
  article = await context.newPage();
  await article.goto(url);
  await article.bringToFront();
  await article.getByRole("button", { name: /Open HypeMan\. Drag to move/ }).waitFor();
}
async function panel() {
  if (!await article.locator(".conversation-pane").isVisible())
    await article.getByRole("button", { name: /Open HypeMan\. Drag to move/ }).click();
  return article.locator(".conversation-pane");
}
async function chat(text) {
  const companion = await panel();
  await companion.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await companion.getByRole("textbox", { name: "What do you need?", exact: true }).fill(text);
  await companion.getByRole("button", { name: "Send message", exact: true }).click();
}
async function closeTools() {
  const close = article.locator('.workspace-tasks').getByRole("button", { name: "Close Projects window", exact: true });
  if (await close.isVisible()) await close.click();
}
async function projects() {
  await chat("open projects");
  await article.locator(".inline-toolbox-tasks .task-card").first().waitFor();
}
async function prepareWindows() {
  await chat("open whiteboard");
  const board = article.locator(".workspace-board:visible");
  await board.waitFor();
  const before = await board.boundingBox();
  await board.getByRole("group", { name: "Resize Whiteboard window", exact: true }).press("Shift+ArrowLeft");
  await board.getByRole("group", { name: "Resize Whiteboard window", exact: true }).press("ArrowUp");
  await board.locator(".pixel-workspace-bar").press("ArrowLeft");
  const rect = await waitFor(async () => {
    const rect = await board.boundingBox();
    return rect.width < before.width - 40 && rect.height < before.height - 5 ? rect : null;
  }, "board moved and resized before navigation");
  await chat("open notes");
  const notes = article.locator(".workspace-notes:visible");
  await notes.getByRole("button", { name: "Minimize Notes window", exact: true }).click();
  await waitFor(async () => await notes.getAttribute("data-minimized") === "true", "notes minimized before navigation");
  return rect;
}
async function restoredWindows(rect) {
  // Do not call panel/chat/projects here: those helpers can reopen a lost UI.
  await article.locator(".conversation-pane:visible").waitFor();
  const board = article.locator(".workspace-board:visible"), notes = article.locator(".workspace-notes:visible");
  await board.waitFor(); await notes.waitFor();
  await waitFor(async () => {
    const actual = await board.boundingBox();
    return ["x", "y", "width", "height"].every((key) => Math.abs(actual[key] - rect[key]) <= 1);
  }, "same-tab navigation restores board position and size");
  assert.equal(await notes.getAttribute("data-minimized"), "true", "notes stay minimized after navigation");
  assert.equal(await notes.locator(".pixel-workspace-content").isVisible(), false);
}
async function mutateOutcome(text) {
  await article.evaluate((text) => { document.querySelector("#outcome").textContent = text; }, text);
}
async function contentRpc(message) {
  // Run the normal extension bridge in its real isolated content world so the
  // worker sees the correct tab owner; webpage JavaScript receives no bridge.
  const url = article.url();
  const tabId = await home.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, url);
  assert.ok(Number.isInteger(tabId));
  return worker.evaluate(async ({ tabId, message }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId }, world: "ISOLATED",
      func: async (message) => chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() }),
      args: [message],
    });
    return results[0].result;
  }, { tabId, message });
}

try {
  const gatewayUrl = `http://127.0.0.1:${await gateway.listen()}`;
  const firstSite = await listen(fixture), secondSite = await listen(otherSite);
  await launch();
  await rpc({ type: "settings.patch", patch: {
    serverUrl: gatewayUrl, serverToken: token, onboarded: true, reducedMotion: "on",
    learningEnabled: false, proactiveEnabled: false, screenshotEnabled: false, tabContextEnabled: false,
  } });
  await openWebsite(firstSite);
  await chat("What is a workshop?");
  await article.getByText("A workshop is a practical session where people learn by doing.", { exact: true }).waitFor();
  assert.equal((await state()).tasks.length, 0);
  assert.equal((await state()).events.length, 0);
  assert.equal(assessments.length, 0);
  check("A simple question stays in chat without a task or progress-analysis request");

  const preservedBoard = await prepareWindows();
  await chat("Project: compare two workshop options, then prepare a draft on another website and review it together. Wait for me to do the steps.");
  const task = await waitFor(async () => (await state()).tasks.find((task) => task.status === "running"), "explicit project plan");
  assert.deepEqual(task.steps.map((step) => step.title), milestones);
  assert.deepEqual(task.steps.map((step) => step.status), ["doing", "todo", "todo"]);
  assert.equal(await article.evaluate(() => window.publications), 0);
  await waitFor(() => assessments.some(({ input }) => input.task.id === task.id), "initial read-only progress observation");
  check("An explicit multi-step project creates specific milestones and waits for collaboration");

  // A direct keyboard action leaves the avatar conversation and active project
  // open while operating webpage content beneath the floating conversation.
  await article.getByRole("button", { name: "Compare options", exact: true }).press("Enter");
  await waitFor(async () => (await project(task.id)).steps[0].status === "done", "manual page outcome advances the first milestone");
  const afterComparison = await project(task.id);
  assert.deepEqual(afterComparison.steps.map((step) => step.status), ["done", "doing", "todo"]);
  assert.equal(afterComparison.status, "running");
  assert.equal(afterComparison.steps[0].completion.source, "page");
  assert.equal(afterComparison.steps[0].completion.evidence, comparison);
  assert.equal(afterComparison.nextStep, milestones[1]);
  check("Visible evidence from a user's page interaction completes exactly the current step");

  const decisionsBeforeNavigation = decisions.length;
  await article.getByRole("link", { name: "Review comparison details", exact: true }).press("Enter");
  await article.waitForURL(`${firstSite}/next`);
  await restoredWindows(preservedBoard);
  await projects();
  const restoredCard = article.locator(".task-card").filter({ hasText: task.goal });
  await restoredCard.locator("summary").click();
  assert.equal(await restoredCard.locator(".steps li.done").count(), 1);
  assert.equal((await project(task.id)).steps[1].status, "doing");
  assert.equal(decisions.length, decisionsBeforeNavigation);
  check("Ordinary same-tab navigation restores chat, resized board, minimized notes and the project without replaying actions");

  const previousPage = article;
  await openWebsite(secondSite);
  await projects();
  const decisionsBeforeFollow = decisions.length;
  await article.locator(".task-card").filter({ hasText: task.goal }).click();
  await chat("continue this project");
  await closeTools();
  await waitFor(async () => (await project(task.id)).tabId !== afterComparison.tabId, "ownership moves to the selected website");
  assert.equal((await project(task.id)).status, "running");
  assert.equal(article.url(), `${secondSite}/`);
  assert.equal(decisions.length, decisionsBeforeFollow);
  assert.equal(await article.evaluate(() => window.publications), 0);
  await previousPage.close();
  check("Continue project here moves collaboration to another website without running browser actions");

  const wrongStep = await contentRpc({ type: "task.step.confirm", taskId: task.id, stepId: "step-3" });
  assert.equal(wrongStep.ok, false);
  assert.deepEqual((await project(task.id)).steps.map((step) => step.status), ["done", "doing", "todo"]);
  assessmentMode = "wrong-step";
  await mutateOutcome(draftEvidence);
  await waitFor(() => assessments.some(({ mode }) => mode === "wrong-step"), "wrong-step model evidence checked");
  await article.waitForTimeout(1200);
  assessmentMode = "normal";
  assert.equal((await project(task.id)).steps[1].status, "doing");
  check("Neither a forged later-step confirmation nor model evidence for a later step advances the plan");

  assessmentMode = "hold";
  await mutateOutcome(`${draftEvidence} Awaiting review.`);
  await waitFor(() => heldAssessment !== null, "delayed progress assessment started");
  await mutateOutcome("The draft changed; completion is no longer shown.");
  assessmentMode = "normal";
  heldAssessment?.();
  await article.waitForTimeout(1500);
  assert.equal((await project(task.id)).steps[1].status, "doing");
  assert.equal((await state()).events.filter((event) => event.action === "milestone").length, 1);
  check("Changing the page while a progress assessment is pending rejects its stale outcome");

  await article.getByLabel("Project draft", { exact: true }).fill("Pottery $45; Printmaking $60; compare schedule before choosing.");
  const decisionsBeforeDone = decisions.length;
  await chat("done");
  await waitFor(async () => (await project(task.id)).steps[1].status === "done", "chat acknowledgement advances the second milestone");
  assert.deepEqual((await project(task.id)).steps.map((step) => step.status), ["done", "done", "doing"]);
  assert.equal((await project(task.id)).steps[1].completion.source, "user");
  assert.equal(decisions.length, decisionsBeforeDone);
  assert.equal(await article.evaluate(() => window.publications), 0);
  check("Saying done collaboratively completes the current step without inference or submission");

  await chat("done");
  await waitFor(async () => (await project(task.id)).status === "completed", "final project milestone");
  const completed = await project(task.id), completedState = await state();
  assert.ok(completed.steps.every((step) => step.status === "done" && step.completion));
  assert.equal(completedState.activeTaskId, null);
  assert.equal(completedState.events.filter((event) => event.action === "milestone").length, 3);
  check("The next completion acknowledgement finishes only the final milestone and preserves all evidence");

  await chat("Project: compare workshops, then prepare another draft and review the result after restart. Wait for me to do the steps.");
  const restartTask = await waitFor(async () => (await state()).tasks.find((item) => item.status === "running"), "project to recover after restart");
  await context.close();
  context = null;
  const beforeRestart = { decisions: decisions.length, assessments: assessments.length };
  await launch();
  const recovered = await waitFor(async () => {
    const task = await project(restartTask.id);
    return task?.status === "paused" ? task : null;
  }, "browser restart pauses the project");
  assert.equal(recovered.tabId, null);
  assert.equal((await state()).activeTaskId, null);
  await openWebsite(firstSite);
  await article.waitForTimeout(1400);
  assert.equal(decisions.length, beforeRestart.decisions);
  assert.equal(assessments.length, beforeRestart.assessments);
  await projects();
  await article.locator(".task-card").filter({ hasText: restartTask.goal }).click();
  await chat("continue this project");
  await closeTools();
  await waitFor(async () => (await project(restartTask.id)).status === "running", "explicit resume on this website");
  check("Browser restart retains project history and requires an explicit resume before observing again");

  await rpc({ type: "settings.patch", patch: { hiddenOnHosts: [new URL(firstSite).hostname] } });
  await article.waitForTimeout(500);
  const pausedCounts = { decisions: decisions.length, assessments: assessments.length };
  await mutateOutcome(comparison);
  await article.evaluate(() => {
    for (let index = 0; index < 5; index++) document.querySelector("#decoration").append(` ${index}`);
  });
  await article.waitForTimeout(6200);
  assert.equal(decisions.length, pausedCounts.decisions);
  assert.equal(assessments.length, pausedCounts.assessments);
  assert.equal((await project(restartTask.id)).steps[0].status, "doing");
  check("Paused sites send no page decisions or progress assessments after clicks and DOM changes");

  await mkdir("tests/screenshots", { recursive: true });
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).fill("open projects");
  await home.getByRole("button", { name: "Send message", exact: true }).click();
  await home.locator(".inline-toolbox-tasks .task-card").first().waitFor();
  await home.screenshot({ path: "tests/screenshots/hypeman-projects.png", fullPage: true });
  console.log(`\n${checks} project browser scenarios passed.`);
} catch (error) {
  console.error("Project decision summaries", decisions.map((input) => ({ goal: input.goal, taskId: input.task?.id, url: input.page.url })));
  console.error("Project assessment summaries", assessments.map(({ input, mode }) => ({ mode, taskId: input.task.id, step: input.task.steps.find((step) => step.status === "doing")?.id, url: input.page.url })));
  console.error("Workspace", await state().catch(() => "Unavailable"));
  await mkdir("tests/screenshots", { recursive: true });
  await article?.screenshot({ path: "tests/screenshots/project-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await gateway.close();
  await Promise.all([fixture, otherSite].map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(profile, { recursive: true, force: true });
}
