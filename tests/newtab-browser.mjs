import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { tsImport } from "tsx/esm/api";

const { createGateway } = await tsImport("../apps/gateway/src/index.ts", import.meta.url);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", import.meta.url);
const token = "hypeman-focused-ui-fixture";
const decisions = [];
const gateway = createGateway(loadConfig({ PORT: "0", DEMO_MODE: "1" }), {
  token,
  agent: async (input) => {
    decisions.push({ goal: input.goal, url: input.page.url });
    return {
      action: input.task
        ? { type: "finish", summary: "UI fixture observed and task completed." }
        : { type: "say", text: "Fixture answer from the same single field." },
      done: true,
      provider: "demo",
    };
  },
});
const profile = await mkdtemp(join(tmpdir(), "hypeman-focused-ui-"));
await mkdir("tests/screenshots", { recursive: true });
let context, home;
let checks = 0;
function check(name) {
  checks++;
  console.log(`✓ ${name}`);
}
async function waitFor(predicate, description) {
  const deadline = Date.now() + 20000;
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
async function closeTools(page = home) {
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await page.locator(".inline-toolbox").waitFor({ state: "detached" });
}
async function canvasChanges(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector(".rooftop-canvas");
    const first = canvas.toDataURL();
    for (let frame = 0; frame < 12; frame++) {
      await new Promise(requestAnimationFrame);
      if (canvas.toDataURL() !== first) return true;
    }
    return false;
  });
}

try {
  const base = `http://127.0.0.1:${await gateway.listen()}`;
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const url = `chrome-extension://${id}/newtab.html`;
  home = await context.newPage();
  await home.goto(url);
  await home.getByRole("textbox", { name: "Task goal", exact: true }).waitFor();
  for (const page of context.pages()) if (page !== home) await page.close();
  // Serialize test configuration through the persistence owner after install
  // recovery, rather than racing onInstalled with a raw storage write.
  await rpc({ type: "settings.patch", patch: {
    serverUrl: base, serverToken: token, onboarded: true, reducedMotion: "auto",
  } });
  assert.equal((await rpc({ type: "settings.get" })).serverUrl, base);
  await home.evaluate(() => document.fonts.ready);
  assert.equal(await home.locator("input:visible,textarea:visible").count(), 1);
  assert.equal(await home.locator("a[href*='control.html']").count(), 0);
  for (const name of [
    "Start task mode", "Ask HypeMan mode", "Search the web mode",
    "Tasks", "Saved notes", "Whiteboard", "More tools",
  ]) {
    const button = home.getByRole("button", { name, exact: true });
    await button.waitFor();
    assert.equal(await button.innerText(), "");
  }
  assert.ok(await home.getByRole("button", { name: "Start task", exact: true }).isDisabled());
  await home.screenshot({ path: "tests/screenshots/hypeman-home.png", fullPage: true });
  check("One visible text input with accessible icon modes and tools at rest");

  const tasksButton = home.getByRole("button", { name: "Tasks", exact: true });
  await tasksButton.focus();
  await tasksButton.press("Enter");
  await home.getByRole("region", { name: "Tasks", exact: true }).waitFor();
  assert.equal(context.pages().length, 1);
  assert.equal(home.url(), `${url}#tasks`);
  await closeTools();
  assert.ok(await home.getByRole("textbox", { name: "Task goal", exact: true }).evaluate(
    (field) => field === document.activeElement,
  ));
  check("Keyboard opens task tools inline and closing restores composer focus");

  const fixture = await context.newPage();
  await fixture.goto(`${base}/demo/learning/`);
  await fixture.bringToFront();
  const task = await home.evaluate(async (fixtureUrl) => {
    const tab = (await chrome.tabs.query({})).find((value) => value.url === fixtureUrl);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const reply = await chrome.runtime.sendMessage({
          type: "task.start", goal: "Focused UI task", dispatch: false,
          requestId: crypto.randomUUID(),
        });
        if (!reply?.ok) throw new Error(reply?.error || "Fixture task setup failed");
        return reply.data;
      },
    });
    return result;
  }, `${base}/demo/learning/`);
  assert.equal(task.lastPage?.url, `${base}/demo/learning/`);
  await rpc({ type: "task.pause", id: task.id });
  await fixture.close();
  await home.bringToFront();
  const note = await rpc({
    type: "note.save",
    note: {
      text: "Keep equality balanced.", title: "Algebra fixture",
      url: `${base}/demo/learning/`, excerpt: "Apply the same operation to both sides.",
      taskId: task.id,
    },
  });
  await home.getByRole("button", { name: "Saved notes", exact: true }).click();
  const notes = home.getByRole("region", { name: "Saved notes", exact: true });
  await notes.locator(".note-card").waitFor();
  await notes.getByRole("button", { name: "Edit", exact: true }).click();
  await notes.getByLabel("Your note").fill("Both sides receive the same operation.");
  await notes.getByRole("button", { name: "Save note", exact: true }).click();
  const updated = await waitFor(async () => {
    const workspace = await rpc({ type: "workspace.get" });
    return workspace.notes.find((value) => value.id === note.id && value.text.startsWith("Both sides"));
  }, "inline note edit");
  assert.equal(updated.url, note.url);
  assert.equal(updated.excerpt, note.excerpt);
  assert.equal(updated.capturedAt, note.capturedAt);
  const downloadPromise = home.waitForEvent("download");
  await notes.getByRole("button", { name: "Export workspace", exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.ok(exported.notes.some((value) => value.id === note.id && value.url === note.url));
  assert.ok(exported.tasks.some((value) => value.id === task.id));
  await home.screenshot({ path: "tests/screenshots/hypeman-notes.png", fullPage: true });
  assert.equal(context.pages().length, 1);
  await closeTools();
  check("Inline notes preserve source evidence when edited and export with resumable tasks");

  await home.getByRole("button", { name: "More tools", exact: true }).click();
  await home.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = home.getByRole("region", { name: "Settings and permissions", exact: true });
  const suggestions = settings.getByRole("button", { name: "Automatic hints", exact: true });
  const before = await suggestions.getAttribute("aria-pressed");
  await suggestions.click();
  await waitFor(async () => (await suggestions.getAttribute("aria-pressed")) !== before, "live capability toggle");
  const name = settings.getByLabel("Companion name", { exact: true });
  await name.fill("Nova");
  await name.press("Enter");
  await waitFor(async () => (await rpc({ type: "settings.get" })).characterName === "Nova", "name persistence");
  const motion = settings.getByLabel("Motion", { exact: true });
  await motion.selectOption("on");
  await home.locator(".newtab-page[data-reduced-motion='true']").waitFor();
  await closeTools();
  await home.getByRole("textbox", { name: "Task goal", exact: true }).focus();
  await home.mouse.move(1, 1);
  assert.equal(await canvasChanges(home), false);
  await rpc({ type: "settings.patch", patch: { reducedMotion: "auto" } });
  await home.emulateMedia({ reducedMotion: "reduce" });
  await home.locator(".newtab-page[data-reduced-motion='true']").waitFor();
  assert.equal(await canvasChanges(home), false);
  await home.emulateMedia({ reducedMotion: "no-preference" });
  await home.locator(".newtab-page[data-reduced-motion='false']").waitFor();
  await waitFor(() => canvasChanges(home), "wallpaper animation resumes");
  check("Inline preferences persist and wallpaper motion updates live for app and OS preferences");

  for (const label of [
    "Launch an airship", "Change time of day", "Customize HypeMan", "Open saved notes",
    "Scatter the pigeons", "Open HypeMan", "Toggle the boombox music",
  ]) await home.getByRole("button", { name: label, exact: true }).waitFor();
  const dance = home.getByRole("button", { name: "Toggle the boombox music", exact: true });
  const music = home.locator(".rooftop-wallpaper audio");
  assert.equal(await music.evaluate((audio) => audio.paused), true);
  await dance.focus();
  await dance.press("Enter");
  assert.equal(await dance.getAttribute("aria-pressed"), "true");
  await waitFor(() => music.evaluate((audio) => !audio.paused && audio.loop && audio.currentTime > 0), "boombox music plays");
  await dance.press("Enter");
  assert.equal(await dance.getAttribute("aria-pressed"), "false");
  assert.equal(await music.evaluate((audio) => audio.paused), true);
  await dance.press("Enter");
  assert.equal(await dance.getAttribute("aria-pressed"), "true");
  const phase = await home.locator(".rooftop-wallpaper").getAttribute("data-time-of-day");
  await home.getByRole("button", { name: "Change time of day", exact: true }).press("Enter");
  await waitFor(async () => {
    const next = await home.locator(".rooftop-wallpaper").getAttribute("data-time-of-day");
    return next && next !== phase;
  }, "interactive clock phase");
  await home.getByRole("button", { name: "Open saved notes", exact: true }).press("Enter");
  await home.getByRole("region", { name: "Saved notes", exact: true }).waitFor();
  await closeTools();
  await home.getByRole("button", { name: "Open HypeMan", exact: true }).press("Enter");
  assert.ok(await home.getByRole("textbox", { name: "Task goal", exact: true }).evaluate(
    (field) => field === document.activeElement,
  ));
  check("Wallpaper props support keyboard interaction and connect to the same companion tools");

  await home.getByRole("button", { name: "Ask HypeMan mode", exact: true }).click();
  assert.equal((await rpc({ type: "settings.get" })).serverUrl, base);
  await home.getByRole("textbox", { name: "Ask HypeMan", exact: true }).fill("A focused UI question");
  await home.getByRole("button", { name: "Ask HypeMan", exact: true }).click();
  await home.locator(".answer").getByText("Fixture answer from the same single field.", { exact: true }).waitFor();
  assert.equal((await rpc({ type: "workspace.get" })).tasks.length, 1);
  await home.getByRole("button", { name: "Dismiss answer", exact: true }).click();
  await home.getByRole("button", { name: "Start task mode", exact: true }).click();
  await home.getByRole("button", { name: "Continue task", exact: true }).click();
  await waitFor(async () => {
    const workspace = await rpc({ type: "workspace.get" });
    return workspace.tasks.find((value) => value.id === task.id)?.status === "completed";
  }, "single-step resumed task");
  assert.ok(decisions.some((entry) => entry.goal === "Focused UI task" && entry.url.endsWith("/demo/learning/")));
  check("The single field asks without starting a task and its resume icon completes the saved task");

  const article = context.pages().find((page) => page !== home && page.url() === `${base}/demo/learning/`);
  assert.ok(article, "Resumed task keeps its observed source tab");
  await article.bringToFront();
  const pet = article.getByRole("button", { name: /Open Nova\. Drag/ });
  await pet.click();
  const panel = article.locator(".companion-panel");
  const countBefore = context.pages().length;
  await panel.getByRole("button", { name: "Notes", exact: true }).click();
  await article.getByRole("dialog", { name: "Notes", exact: true }).getByRole("region", { name: "Saved notes", exact: true }).locator(".note-card").waitFor();
  assert.equal(await article.locator(".pixel-workspace .inline-tool-tabs").count(), 0);
  assert.equal(context.pages().length, countBefore);
  assert.equal(article.url(), `${base}/demo/learning/`);
  await article.screenshot({ path: "tests/screenshots/hypeman-companion-notes.png", fullPage: true });
  await closeTools(article);
  await panel.getByRole("button", { name: "More tools", exact: true }).click();
  await panel.getByRole("button", { name: "Preferences", exact: true }).click();
  await article.frameLocator(".workspace-preferences-frame").getByRole("region", { name: "Settings and permissions", exact: true }).waitFor();
  assert.equal(context.pages().length, countBefore);
  await closeTools(article);
  await panel.getByRole("button", { name: "Tasks", exact: true }).click();
  const completed = article.getByRole("region", { name: "Tasks", exact: true }).locator(".task-card");
  await completed.getByText("Focused UI task", { exact: true }).waitFor();
  assert.equal(await completed.locator("[aria-label='completed']").count(), 1);
  await closeTools(article);
  await panel.getByRole("button", { name: "Whiteboard", exact: true }).click();
  const board = article.getByRole("dialog", { name: "Whiteboard", exact: true });
  const canvas = board.locator("canvas.drawing-canvas");
  const emptyDrawing = await canvas.evaluate((canvas) => canvas.toDataURL());
  const bounds = await canvas.boundingBox();
  await article.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height * .3);
  await article.mouse.down();
  await article.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .6, { steps: 12 });
  await article.mouse.up();
  const drawing = await canvas.evaluate((canvas) => canvas.toDataURL());
  assert.notEqual(drawing, emptyDrawing);
  await article.screenshot({ path: "tests/screenshots/hypeman-whiteboard-overlay.png", fullPage: true });
  await closeTools(article);
  await panel.getByRole("button", { name: "Whiteboard", exact: true }).click();
  assert.equal(await canvas.evaluate((canvas) => canvas.toDataURL()), drawing);
  await board.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await canvas.evaluate((canvas) => canvas.toDataURL()), emptyDrawing);
  assert.equal(context.pages().length, countBefore);
  await closeTools(article);
  check("Pixel whiteboard draws over the page, preserves work when reopened, and undoes without new tabs");
  await panel.getByRole("button", { name: "More tools", exact: true }).click();
  await panel.getByRole("button", { name: "Paper camera", exact: true }).click();
  const camera = article.frameLocator(".workspace-capture-frame");
  await camera.getByLabel("Choose a photo").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") });
  await camera.getByRole("button", { name: "Read handwriting", exact: true }).click();
  await camera.getByText("Demo fixture · this is not a transcription of your image.", { exact: true }).waitFor();
  await camera.getByLabel("Editable transcription").waitFor();
  assert.equal(context.pages().length, countBefore);
  await article.evaluate(() => window.postMessage({ type: "hypeman.close-overlay" }, "*"));
  assert.ok(await article.locator(".workspace-capture-frame").isVisible());
  await camera.getByLabel("Editable transcription").press("Escape");
  await article.locator(".workspace-capture-frame").waitFor({ state: "detached" });
  await panel.getByRole("button", { name: "More tools", exact: true }).click();
  await panel.getByRole("button", { name: "Customize companion", exact: true }).click();
  const dressing = article.getByRole("dialog", { name: "Dressing room", exact: true });
  const art = await article.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#263c7a"; ctx.fillRect(4, 2, 8, 12);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await dressing.locator(".upload-area input[type=file]").setInputFiles({ name: "mascot.png", mimeType: "image/png", buffer: Buffer.from(art, "base64") });
  await dressing.getByRole("button", { name: "Save & use companion", exact: true }).click();
  await waitFor(async () => (await rpc({ type: "settings.get" })).character.startsWith("custom:"), "mascot saved from webpage overlay");
  assert.equal(context.pages().length, countBefore);
  await closeTools(article);
  await article.close();
  check("Website tools are themed overlays; paper photos return labeled demo transcription without a new page");

  const watch = await context.newPage();
  await watch.goto(`${base}/demo/video/`);
  await watch.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
  await watch.getByRole("button", { name: /Open Nova\. Drag/ }).click();
  await watch.getByRole("button", { name: "More tools", exact: true }).click();
  await watch.getByRole("button", { name: "Video", exact: true }).click();
  const playerTools = watch.getByRole("dialog", { name: "Video", exact: true });
  await playerTools.getByRole("button", { name: "Play video", exact: true }).click();
  await watch.waitForFunction(() => document.querySelector("video")?.paused === false);
  assert.ok(await playerTools.isVisible());
  await playerTools.getByRole("button", { name: "Pause video", exact: true }).click();
  await watch.waitForFunction(() => document.querySelector("video")?.paused === true);
  assert.ok(await playerTools.isVisible());
  await watch.close();
  check("Contextual video controls play and pause the page player while keeping the overlay open");

  await home.bringToFront();
  await home.reload();
  await home.getByRole("button", { name: "More tools", exact: true }).click();
  await home.getByRole("button", { name: "Settings", exact: true }).click();
  const reloaded = home.getByRole("region", { name: "Settings and permissions", exact: true });
  await waitFor(async () => (await reloaded.getByLabel("Companion name", { exact: true }).inputValue()) === "Nova", "reloaded preferences hydrate from storage");
  assert.notEqual(await reloaded.getByRole("button", { name: "Automatic hints", exact: true }).getAttribute("aria-pressed"), before);
  await closeTools();
  assert.equal(await home.locator("input:visible,textarea:visible").count(), 1);
  const requestsBeforeSearch = decisions.length;
  await context.route("https://www.google.com/search?**", (route) => route.fulfill({
    contentType: "text/html", body: "<title>Intercepted search</title><p>Search fixture</p>",
  }));
  await home.getByRole("button", { name: "Search the web mode", exact: true }).click();
  await home.getByRole("textbox", { name: "Search the web", exact: true }).fill("beginner art & design");
  await home.getByRole("button", { name: "Search the web", exact: true }).click();
  await home.waitForURL("https://www.google.com/search?**");
  assert.equal(new URL(home.url()).searchParams.get("q"), "beginner art & design");
  assert.equal(decisions.length, requestsBeforeSearch);
  check("Preferences survive reload and web search navigates directly without an agent request");
  console.log(`\n${checks} focused UI browser scenarios passed.`);
} catch (error) {
  console.error("Fixture decisions", JSON.stringify(decisions));
  if (context) {
    console.error("Open pages", context.pages().map((page) => page.url()));
    for (const [index, page] of context.pages().entries())
      await page.screenshot({ path: `tests/screenshots/ui-failure-${index}.png` }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  await gateway.close();
  await rm(profile, { recursive: true, force: true });
}
