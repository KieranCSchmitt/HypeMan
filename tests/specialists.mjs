import assert from "node:assert/strict";

async function until(read, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Specialist check timed out: ${description}`);
}
const pet = (page) =>
  page.getByRole("button", { name: "Open HypeMan. Drag to move.", exact: true });

async function chat(page, text) {
  await page.getByRole("textbox", { name: "What do you need?", exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await until(async () => await page.getByRole("textbox", { name: "What do you need?", exact: true }).inputValue() === "", `composer clears: ${text}`);
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator(".conversation-pane .notice.error:visible").count(), 0);
}
async function openTool(page, name) { await chat(page, `open ${name}`); }

/** Exercise specialist integrations in an actual extension, without paid services. */
export async function runSpecialists({ ctx, home, rpc, base, extensionId, check }) {
  const original = await rpc(home, { type: "settings.get" });
  const pages = [];
  try {
    const video = await ctx.newPage();
    pages.push(video);
    await video.goto(`${base}/__test/video/`);
    await video.waitForFunction(() => {
      const v = document.querySelector("video");
      return v?.readyState >= 1 && Array.from(v.textTracks).some((track) => track.cues?.length > 0);
    });
    await pet(video).press("Enter");
    await video.locator(".conversation-pane").waitFor();
    assert.equal(await video.getByRole("button", { name: "Video", exact: true }).count(), 0);
    assert.equal(await video.getByRole("button", { name: "More tools", exact: true }).count(), 0);

    const closePet = video.getByRole("button", {
      name: "Close HypeMan. Drag to move.",
      exact: true,
    });
    await closePet.press("Space");
    await video.locator(".conversation-pane").waitFor({ state: "hidden" });
    await pet(video).press("Enter");
    await rpc(home, {
      type: "settings.patch",
      patch: { reducedMotion: "auto" },
    });
    await video.emulateMedia({ reducedMotion: "reduce" });
    await until(
      async () =>
        (await video
          .locator(".pet-handle .hypeman-pet > span")
          .evaluate((el) => el.style.backgroundPosition)) === "0px 0px",
      "immediate system reduced motion",
      1500,
    );
    const first = await video
      .locator(".pet-handle .hypeman-pet > span")
      .evaluate((el) => el.style.backgroundPosition);
    await video.waitForTimeout(500);
    assert.equal(
      await video
        .locator(".pet-handle .hypeman-pet > span")
        .evaluate((el) => el.style.backgroundPosition),
      first,
    );
    check("Mascot Enter/Space keyboard controls and immediate system reduced motion");

    await openTool(video, "Video");
    await chat(video, "play video");
    await video.waitForFunction(() => document.querySelector("video")?.paused === false);
    await openTool(video, "Video");
    await chat(video, "pause video");
    await video.waitForFunction(() => document.querySelector("video")?.paused === true);
    await video.getByLabel("What do you need?").fill("Seek the video to 3 seconds");
    await video.getByRole("button", { name: "Send message", exact: true }).click();
    await video.waitForFunction(
      () => Math.abs(document.querySelector("video").currentTime - 3) < 0.25,
    );
    await openTool(video, "Video");
    await chat(video, "summarize this video");
    await video.getByRole("tab", { name: "Summary", exact: true }).click();
    await video.locator(".video-summary").waitFor();
    assert.match(await video.locator(".video-summary").innerText(), /equation|operation|equality/i);
    check("Native captions support grounded video summary, play, pause and seek");

    const unavailable = await ctx.newPage();
    pages.push(unavailable);
    await unavailable.goto(`${base}/__test/video/uncaptioned.html`);
    await unavailable.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    await pet(unavailable).press("Enter");
    await openTool(unavailable, "Video");
    await chat(unavailable, "summarize this video");
    await unavailable.getByText("Captions are unavailable. I can use visible content, but cannot quote unheard narration.", { exact: true }).last().waitFor();
    const noCaptions = await rpc(home, {
      type: "api",
      path: "/api/video",
      body: { url: `${base}/__test/video/uncaptioned.html`, segments: [] },
    });
    assert.equal(noCaptions.available, false);
    assert.equal(noCaptions.source, "none");
    assert.deepEqual(noCaptions.segments, []);
    check("Uncaptioned native video reports unavailable without fabricated narration");

    const note = await rpc(home, {
      type: "note.save",
      note: {
        text: "Specialist test note to remove",
        excerpt: "A test-only saved selection.",
        url: `${base}/__test/video/`,
        title: "Specialist lifecycle check",
      },
    });
    const control = await ctx.newPage();
    pages.push(control);
    await control.goto(`chrome-extension://${extensionId}/newtab.html#notes`);
    const card = control
      .locator(".note-card")
      .filter({ has: control.locator("textarea").filter({ hasText: "Specialist test note to remove" }) });
    await card.waitFor();
    await card.locator("textarea").focus();
    await chat(control, "delete this note");
    await until(
      async () =>
        !(await rpc(home, { type: "workspace.get" })).notes.some((value) => value.id === note.id),
      "remove only test note",
    );
    check("Inline saved notes remove a selected note");

    await rpc(home, { type: "settings.patch", patch: { screenshotEnabled: true } });
    await video.bringToFront();
    // Trigger the real toolbar action, which gives this tab Chrome's temporary activeTab grant.
    const browserCdp = await ctx.browser().newBrowserCDPSession();
    try {
      const targets = await browserCdp.send("Target.getTargets", { filter: [{}] });
      const target = targets.targetInfos.find(
        (value) => value.type === "tab" && value.url === video.url(),
      );
      assert.ok(target, "native video tab target exists");
      await browserCdp.send("Extensions.triggerAction", {
        id: extensionId,
        targetId: target.targetId,
      });
    } finally {
      await browserCdp.detach();
    }
    await video.bringToFront();
    await video.getByRole("textbox", { name: "What do you need?", exact: true }).fill("capture screen region");
    await video.getByRole("button", { name: "Send message", exact: true }).click();
    await video.locator(".screen-region-selection").waitFor();
    await video.mouse.move(80, 80);
    await video.mouse.down();
    await video.mouse.move(640, 360, { steps: 12 });
    await video.mouse.up();
    await video.locator(".conversation-attachment").waitFor();
    const requests = [];
    const captureRequest = (request) => {
      if (request.url().includes("/api/agent")) {
        try {
          requests.push(request.postDataJSON());
        } catch {
          /* not JSON */
        }
      }
    };
    ctx.on("request", captureRequest);
    try {
      await video
        .getByLabel("What do you need?")
        .fill("What is shown in the attached page image?");
      await video.getByRole("button", { name: "Send message", exact: true }).click();
      await until(
        () => Promise.resolve(requests.some((value) => typeof value?.screenshot === "string")),
        "explicit screenshot reaches next question",
      );
      assert.match(
        requests.find((value) => value?.screenshot).screenshot,
        /^data:image\/jpeg;base64,/,
      );
      await until(
        async () => (await video.locator(".conversation-attachment").count()) === 0,
        "one-use screenshot attachment cleared",
      );
      await until(
        async () =>
          (await video.getByRole("button", { name: "Send message", exact: true }).count()) > 0,
        "first screenshot question finished",
      );
      const before = requests.length;
      await video
        .getByLabel("What do you need?")
        .fill("Describe the page heading in one sentence");
      await video.getByRole("button", { name: "Send message", exact: true }).click();
      await until(() => Promise.resolve(requests.length > before), "follow-up question");
      assert.equal(requests.at(-1).screenshot, undefined);
    } finally {
      ctx.off("request", captureRequest);
    }
    check("Explicit page capture attaches once to the next question and is then cleared");
  } finally {
    await rpc(home, {
      type: "settings.patch",
      patch: {
        reducedMotion: original.reducedMotion,
        screenshotEnabled: original.screenshotEnabled,
      },
    }).catch(() => {});
    for (const page of pages) await page.close().catch(() => {});
  }
}
