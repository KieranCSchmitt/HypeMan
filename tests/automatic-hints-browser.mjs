import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const token = "hypeman-automatic-hints-fixture";
const decisions = [];
const firstHint = "What operation would undo the added 5 on both sides?";
const nextHint = "Subtract the same amount from both sides, then examine the coefficient of x.";
const secondQuestionHint = "How can you remove the subtraction before handling the coefficient?";
const explanation = "Photosynthesis is how plants use sunlight to turn water and carbon dioxide into food.";
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token,
  agent: async (input) => {
    decisions.push(input);
    if (new URL(input.page.url).searchParams.has("unsafe-reply"))
      return { action: { type: "type", target: input.page.elements.find((target) => target.role === "textbox")?.id ?? "missing", text: "5" }, provider: "demo" };
    return {
      action: {
        type: "say",
        text: input.page.selection ? explanation
          : /rung 2 of 4/i.test(input.message) ? nextHint
          : /4x - 3 = 25/.test(input.page.text) ? secondQuestionHint
          : firstHint,
      },
      done: true,
      provider: "demo",
    };
  },
});
// The feedback deliberately has no role, aria-live, framework class, or HypeMan
// hooks. This exercises ordinary practice pages, rather than only our demos.
const exercise = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Automatic hint practice fixture</title><style>
body{font:20px system-ui;max-width:40rem;margin:4rem auto;padding:1rem}
button,input{font:inherit;padding:.5rem;margin:.3rem}input{width:10rem}
#feedback{min-height:2rem;color:#a31d37}</style></head><body>
<main><h1>Solving an equation</h1><p id="question">Find x: 3x + 5 = 20.</p>
<form id="practice"><label for="answer">Your answer</label>
<input id="answer" name="answer" autocomplete="off"><button>Check answer</button></form>
<p id="feedback"></p><p id="unrelated">Practice at your own pace.</p>
<p><span id="term">Photosynthesis</span> uses sunlight to turn water and carbon dioxide into food.</p>
<button id="final">Submit homework</button></main><script>
window.practiceSubmissions=0;window.finalSubmissions=0;
document.querySelector('#practice').addEventListener('submit',function(event){
event.preventDefault();window.practiceSubmissions++;
document.querySelector('#feedback').textContent='Try Again';});
document.querySelector('#final').addEventListener('click',function(){window.finalSubmissions++;});
</script></body></html>`;
const reading = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>A plant's energy</title><style>body{font:20px system-ui;max-width:40rem;margin:4rem auto;padding:1rem}p{line-height:1.6}</style></head><body>
<main><h1>A plant's energy</h1><p id="context"><span id="term">Photosynthesis</span> lets plants use light energy to convert water and carbon dioxide into sugars. This process releases oxygen.</p>
<p id="unrelated">Leaves contain chlorophyll, a green pigment that captures light.</p>
<p data-private><span id="private-term">Private fixture content</span></p></main>
</body></html>`;
const fixture = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(request.url?.startsWith("/reading") ? reading : exercise);
});
const profile = await mkdtemp(join(tmpdir(), "hypeman-automatic-hints-"));
let context, home, article, worker;
let checks = 0;
function check(name) {
  checks++;
  console.log(`✓ ${name}`);
}
async function waitFor(predicate, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function rpc(message) {
  return home.evaluate(async (message) => {
    const reply = await chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() });
    if (!reply?.ok) throw new Error(reply?.error || "No extension response");
    return reply.data;
  }, message);
}
async function pageState() {
  return article.evaluate(() => ({
    answer: document.querySelector("#answer").value,
    attempts: window.practiceSubmissions,
    finalSubmissions: window.finalSubmissions,
  }));
}
async function submitWrongAnswer() {
  await article.getByLabel("Your answer", { exact: true }).fill("99");
  await article.getByRole("button", { name: "Check answer", exact: true }).click();
  await article.locator("#feedback").getByText("Try Again", { exact: true }).waitFor();
}
async function openFixture(url, { paused = false } = {}) {
  if (article) await article.close();
  article = await context.newPage();
  await article.goto(url);
  await article.bringToFront();
  if (paused) await article.locator("#hypeman-companion-v2").waitFor({ state: "attached" });
  else await article.getByRole("button", { name: /Open HypeMan\. Drag to move/ }).waitFor();
}
async function assertSilentAfterMutations(expected) {
  await article.evaluate(() => {
    for (let index = 0; index < 6; index++) {
      const decoration = document.createElement("span");
      decoration.textContent = ` · ${index}`;
      document.querySelector("#unrelated").append(decoration);
    }
    const feedback = document.querySelector("#feedback");
    feedback.textContent = "Try Again";
  });
  // Allow both the DOM observer debounce and its next URL/feedback poll.
  await article.waitForTimeout(1600);
  assert.equal(decisions.length, expected);
}
async function highlightTerm(id = "term") {
  await article.evaluate((id) => {
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById(id));
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, id);
}
async function dragHighlightTerm() {
  const box = await article.locator("#term").boundingBox();
  assert.ok(box, "The source phrase is visible for a real mouse selection");
  const y = box.y + box.height / 2;
  await article.mouse.move(box.x - 2, y);
  await article.mouse.down();
  await article.mouse.move(box.x + box.width + 2, y, { steps: 12 });
  await article.mouse.up();
  const selected = await article.evaluate(() => window.getSelection()?.toString().trim() ?? "");
  assert.match(selected, /Photosynthesis/);
  return selected;
}
async function clearSelection() {
  await article.evaluate(() => {
    window.getSelection().removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
}
async function graphHints() {
  const graph = await rpc({ type: "graph.get" });
  return graph.nodes.reduce((sum, node) => sum + node.hints, 0);
}
async function contentRpc(message) {
  const url = article.url();
  const tabId = await home.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, url);
  assert.ok(Number.isInteger(tabId));
  const reply = await worker.evaluate(async ({ tabId, message }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId }, world: "ISOLATED",
      func: async (message) => chrome.runtime.sendMessage({ ...message, requestId: crypto.randomUUID() }),
      args: [message],
    });
    return results[0].result;
  }, { tabId, message });
  if (!reply?.ok) throw new Error(reply?.error || "No content extension response");
  return reply.data;
}
async function assistanceState() {
  return { workspace: await rpc({ type: "workspace.get" }), graph: await rpc({ type: "graph.get" }) };
}

try {
  const gatewayUrl = `http://127.0.0.1:${await gateway.listen()}`;
  await new Promise((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolve);
  });
  const practiceUrl = `http://127.0.0.1:${fixture.address().port}/practice`;
  const readingUrl = `http://127.0.0.1:${fixture.address().port}/reading`;
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1360, height: 960 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  context.setDefaultTimeout(15_000);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  home = await context.newPage();
  await home.goto(`chrome-extension://${extensionId}/newtab.html`);
  await home.getByRole("textbox", { name: "What do you need?", exact: true }).waitFor();
  for (const page of context.pages()) if (page !== home) await page.close();
  // Wait until installation hydration finishes, then use the canonical owner.
  await rpc({ type: "settings.patch", patch: {
    serverUrl: gatewayUrl,
    serverToken: token,
    onboarded: true,
    reducedMotion: "on",
    learningEnabled: true,
    proactiveEnabled: true,
  } });
  const settings = await rpc({ type: "settings.get" });
  assert.equal(settings.serverUrl, gatewayUrl);
  assert.equal(settings.learningEnabled, true);
  assert.equal(settings.proactiveEnabled, true);

  await openFixture(practiceUrl);
  assert.equal(await article.locator(".companion-panel").count(), 0);
  await waitFor(() => decisions.length === 1, "practice hint prepared before the first wrong answer");
  assert.equal(decisions[0].mode, "learn");
  assert.match(decisions[0].message, /rung 1 of 4/i);
  assert.doesNotMatch(decisions[0].page.text, /Try Again/);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  assert.equal(await graphHints(), 0);
  assert.deepEqual(await pageState(), { answer: "", attempts: 0, finalSubmissions: 0 });
  check("A stable visible practice question preloads one read-only hint silently before the learner answers");

  await article.getByLabel("Your answer", { exact: true }).fill("88");
  await article.waitForTimeout(1100);
  assert.equal(decisions.length, 1);
  assert.equal(await graphHints(), 0);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  check("Editing an answer reuses question context without requesting a new hint or revealing a solution");

  await submitWrongAnswer();
  const preview = article.getByRole("button", { name: "Show hint", exact: true });
  await preview.waitFor();
  assert.equal(decisions.length, 1);
  assert.equal(await article.locator(".companion-panel").count(), 0);
  assert.ok((await preview.innerText()).includes(firstHint));
  assert.deepEqual(await pageState(), { answer: "99", attempts: 1, finalSubmissions: 0 });
  assert.equal(article.url(), practiceUrl);
  await waitFor(async () => await graphHints() === 1, "real displayed hint evidence");
  check("Wrong-answer feedback reveals the cached hint without a new model request or page action");

  await preview.click();
  const panel = article.locator(".companion-panel");
  await panel.getByText(firstHint, { exact: true }).waitFor();
  assert.equal(await panel.locator(".chat-message.assistant").count(), 1);
  await panel.getByRole("button", { name: "Next hint", exact: true }).click();
  await panel.getByText(nextHint, { exact: true }).waitFor();
  assert.equal(decisions.length, 2);
  assert.match(decisions[1].message, /rung 2 of 4/i);
  assert.deepEqual(await pageState(), { answer: "99", attempts: 1, finalSubmissions: 0 });
  const workspace = await rpc({ type: "workspace.get" });
  assert.equal(workspace.tasks.length, 0);
  assert.equal(workspace.events.length, 0);
  check("Show hint opens the real reply; the single Next hint icon advances to rung 2 without solving or starting a task");

  await panel.getByRole("button", { name: "Close companion panel", exact: true }).click();
  await assertSilentAfterMutations(2);
  assert.deepEqual(await pageState(), { answer: "99", attempts: 1, finalSubmissions: 0 });
  check("Unrelated mutations and identical feedback do not repeat the automatic request");

  await article.evaluate(() => {
    document.querySelector("#question").textContent = "Find x: 4x - 3 = 25.";
    document.querySelector("#feedback").textContent = "";
    document.querySelector("#answer").value = "";
  });
  await waitFor(() => decisions.length === 3, "different question prepared within speculative request budget", 25_000);
  assert.match(decisions[2].page.text, /4x - 3 = 25/);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  await submitWrongAnswer();
  await preview.waitFor();
  assert.ok((await preview.innerText()).includes(secondQuestionHint));
  assert.equal(decisions.length, 3);
  check("A different question invalidates the old preload and reveals only its own cached hint");

  await rpc({ type: "settings.patch", patch: { learningEnabled: false } });
  await openFixture(`${practiceUrl}?learning=off`);
  await submitWrongAnswer();
  await assertSilentAfterMutations(3);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  check("Turning off Learning mode prevents speculative practice hint requests");

  await openFixture(readingUrl);
  await article.waitForTimeout(1100);
  assert.equal(decisions.length, 3);
  await highlightTerm();
  const explainPreview = article.getByRole("button", { name: "Show explanation", exact: true });
  await explainPreview.waitFor();
  assert.equal(decisions.length, 4);
  assert.equal(decisions[3].mode, "browse");
  assert.match(decisions[3].page.selection, /Photosynthesis/);
  assert.match(decisions[3].page.text, /convert water and carbon dioxide into sugars/);
  assert.ok((await explainPreview.innerText()).includes(explanation));
  assert.equal(await article.locator(".companion-panel").count(), 0);
  check("Highlighting an article term prepares a grounded explanation with Learning mode off");

  await clearSelection();
  await explainPreview.waitFor({ state: "hidden" });
  await highlightTerm();
  await explainPreview.waitFor();
  assert.equal(decisions.length, 4);
  await explainPreview.click();
  await article.locator(".companion-panel").getByText(explanation, { exact: true }).last().waitFor();
  assert.equal(decisions.length, 4);
  check("Reselecting the same term and opening its explanation reuse the cached result");

  await rpc({ type: "settings.patch", patch: { learningEnabled: true, proactiveEnabled: false } });
  await openFixture(`${practiceUrl}?automatic=off`);
  await submitWrongAnswer();
  await assertSilentAfterMutations(4);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  await openFixture(`${readingUrl}?automatic=off`);
  await highlightTerm();
  await article.waitForTimeout(1600);
  assert.equal(decisions.length, 4);
  assert.equal(await article.getByRole("button", { name: "Show explanation", exact: true }).count(), 0);
  check("Turning off Automatic hints keeps enabled Learning mode quiet");

  await rpc({ type: "settings.patch", patch: {
    proactiveEnabled: true,
    hiddenOnHosts: [new URL(practiceUrl).hostname],
  } });
  await openFixture(`${practiceUrl}?site=paused`, { paused: true });
  await submitWrongAnswer();
  await assertSilentAfterMutations(4);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  await openFixture(`${readingUrl}?site=paused`, { paused: true });
  await highlightTerm();
  await article.waitForTimeout(1600);
  assert.equal(decisions.length, 4);
  assert.equal(await article.getByRole("button", { name: "Show explanation", exact: true }).count(), 0);
  check("Paused sites remain silent for practice and highlighting even with both settings enabled");

  await rpc({ type: "settings.patch", patch: { hiddenOnHosts: [] } });
  await openFixture(`${practiceUrl}?unsafe-reply=1`);
  await waitFor(() => decisions.length === 5, "unsafe preload response");
  await submitWrongAnswer();
  await article.waitForTimeout(1600);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  assert.deepEqual(await pageState(), { answer: "99", attempts: 1, finalSubmissions: 0 });
  // Invalid speculative output is not cached. A real trigger may retry it once.
  assert.ok(decisions.length >= 5 && decisions.length <= 6);
  const beforePrivate = decisions.length;
  const finalWorkspace = await rpc({ type: "workspace.get" });
  assert.equal(finalWorkspace.tasks.length, 0);
  assert.equal(finalWorkspace.events.length, 0);
  check("A model action in a preload is rejected without typing, submitting, navigating, or creating a task");

  await openFixture(`${readingUrl}?private=1`);
  await highlightTerm("private-term");
  await article.waitForTimeout(1600);
  assert.equal(decisions.length, beforePrivate);
  assert.equal(await article.getByRole("button", { name: "Show explanation", exact: true }).count(), 0);
  check("Highlighting private page content does not send an explanation request");

  await mkdir("tests/screenshots", { recursive: true });
  // Capture the completed hint interaction, not a mocked image of the widget.
  await rpc({ type: "settings.patch", patch: { hiddenOnHosts: [] } });
  await openFixture(`${practiceUrl}?screenshot=hint`);
  await submitWrongAnswer();
  await article.getByRole("button", { name: "Show hint", exact: true }).waitFor();
  await article.screenshot({ path: "tests/screenshots/hypeman-automatic-hint.png", fullPage: true });

  // A deliberate selection is independent from project orchestration. Start a
  // real owned project through its canonical worker, then use ordinary website
  // navigation to restore it before selecting text with the native mouse.
  await openFixture(`${readingUrl}?project=setup`);
  const project = await contentRpc({
    type: "task.start", goal: "Compare workshop options, then prepare a registration draft",
    steps: ["Compare two workshop options", "Prepare a registration draft"],
    url: article.url(), dispatch: false,
  });
  await contentRpc({ type: "task.follow", id: project.id });
  await article.goto(`${practiceUrl}?project=owned`);
  await article.bringToFront();
  await article.getByRole("button", { name: /Open HypeMan\. Drag to move/ }).click();
  await article.getByRole("progressbar", { name: "Task progress", exact: true }).waitFor();
  await article.getByRole("button", { name: "Close companion panel", exact: true }).click();
  const ownedBefore = await assistanceState(), ownedDecisions = decisions.length;
  await assertSilentAfterMutations(ownedDecisions);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  const nativeSelection = await dragHighlightTerm();
  const ownedPreview = article.getByRole("button", { name: "Show explanation", exact: true });
  await ownedPreview.waitFor();
  assert.equal(decisions.length, ownedDecisions + 1);
  assert.equal(decisions.at(-1).task, null);
  assert.deepEqual(decisions.at(-1).history, []);
  assert.deepEqual(decisions.at(-1).page.elements, []);
  assert.equal(decisions.at(-1).page.selection, nativeSelection);
  assert.equal(decisions.at(-1).mode, "browse");
  await ownedPreview.click();
  await article.locator(".companion-panel").getByText(explanation, { exact: true }).last().waitFor();
  assert.equal(await article.evaluate(() => window.getSelection()?.toString().trim() ?? ""), nativeSelection);
  assert.deepEqual(await assistanceState(), ownedBefore);
  assert.deepEqual(await pageState(), { answer: "", attempts: 0, finalSubmissions: 0 });
  check("A native text selection explains during an owned project, keeps its selection when opened, and leaves progress unchanged");

  // Preserve the running owner in a background tab. The foreground page has no
  // local task, so this also verifies the worker does not inject another tab's
  // project context into a read-only explanation.
  const projectOwner = article;
  article = null;
  await openFixture(`${practiceUrl}?project=elsewhere`);
  const otherBefore = await assistanceState(), otherDecisions = decisions.length;
  assert.equal(otherBefore.workspace.activeTaskId, project.id);
  assert.equal(otherBefore.workspace.tasks.find((task) => task.id === project.id).status, "running");
  await assertSilentAfterMutations(otherDecisions);
  assert.equal(await article.getByRole("button", { name: "Show hint", exact: true }).count(), 0);
  await highlightTerm();
  const otherPreview = article.getByRole("button", { name: "Show explanation", exact: true });
  await otherPreview.waitFor();
  assert.equal(decisions.length, otherDecisions + 1);
  assert.equal(decisions.at(-1).task, null);
  assert.deepEqual(decisions.at(-1).history, []);
  assert.deepEqual(decisions.at(-1).page.elements, []);
  assert.deepEqual(await assistanceState(), otherBefore);
  assert.deepEqual(await pageState(), { answer: "", attempts: 0, finalSubmissions: 0 });
  assert.equal(projectOwner.isClosed(), false);
  check("Selections explain while a project runs in another tab; unsolicited practice hints and project changes remain blocked");

  console.log(`\n${checks} automatic hint browser scenarios passed.`);
} catch (error) {
  console.error("Hint request summaries", decisions.map((input) => ({
    url: input.page.url, mode: input.mode, message: input.message,
  })));
  await mkdir("tests/screenshots", { recursive: true });
  await article?.screenshot({ path: "tests/screenshots/automatic-hint-failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await gateway.close();
  await new Promise((resolve) => fixture.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
