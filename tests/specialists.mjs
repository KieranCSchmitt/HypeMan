import assert from "node:assert/strict";

async function until(read, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Specialist check timed out: ${description}`);
}
const pet = (page, name) =>
  page.getByRole("button", { name: `Open ${name}. Drag to move.`, exact: true });

async function openTool(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "More tools", exact: true }).click();
  await button.click();
}

/** Exercise specialist integrations in an actual extension, without paid services. */
export async function runSpecialists({ ctx, home, rpc, base, extensionId, check }) {
  const original = await rpc(home, { type: "settings.get" });
  const pages = [];
  try {
    const video = await ctx.newPage();
    pages.push(video);
    await video.goto(`${base}/demo/video/`);
    await video.waitForFunction(() => {
      const v = document.querySelector("video");
      return v?.readyState >= 1 && Array.from(v.textTracks).some((track) => track.cues?.length > 0);
    });
    await pet(video, original.characterName).press("Enter");
    await video.locator(".companion-panel").waitFor();
    assert.equal(await video.getByRole("button", { name: /microphone|speech|voice/i }).count(), 0);
    assert.equal(await video.getByRole("button", { name: "Video", exact: true }).count(), 0);
    assert.ok(await video.getByRole("button", { name: "More tools", exact: true }).isVisible());

    const closePet = video.getByRole("button", {
      name: `Close ${original.characterName}. Drag to move.`,
      exact: true,
    });
    await closePet.press("Space");
    await video.locator(".companion-panel").waitFor({ state: "detached" });
    await pet(video, original.characterName).press("Enter");
    await rpc(home, {
      type: "settings.patch",
      patch: { character: "hypeman", reducedMotion: "auto" },
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
    await video.getByRole("button", { name: "Play video", exact: true }).click();
    await video.waitForFunction(() => document.querySelector("video")?.paused === false);
    await openTool(video, "Video");
    await video.getByRole("button", { name: "Pause video", exact: true }).click();
    await video.waitForFunction(() => document.querySelector("video")?.paused === true);
    await video.getByLabel("Message your companion").fill("Seek the video to 3 seconds");
    await video.getByRole("button", { name: "Send message", exact: true }).click();
    await video.waitForFunction(
      () => Math.abs(document.querySelector("video").currentTime - 3) < 0.25,
    );
    await openTool(video, "Video");
    await video.getByRole("button", { name: "Video key ideas", exact: true }).click();
    await until(async () => {
      await openTool(video, "Video");
      return (await video.locator(".panel-video .video-summary").count()) > 0;
    }, "native caption summary");
    assert.match(
      await video.locator(".panel-video .video-summary").innerText(),
      /equation|operation|equality/i,
    );
    check("Native captions support grounded video summary, play, pause and seek");

    const unavailable = await ctx.newPage();
    pages.push(unavailable);
    await unavailable.goto(`${base}/demo/video/uncaptioned.html`);
    await unavailable.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    await pet(unavailable, original.characterName).press("Enter");
    await openTool(unavailable, "Video");
    await unavailable.getByRole("button", { name: "Video key ideas", exact: true }).click();
    await unavailable.locator(".dock-activity-log summary").click();
    await unavailable
      .getByText(
        "Captions are unavailable. I can use visible content, but cannot quote unheard narration.",
        { exact: true },
      )
      .waitFor();
    await openTool(unavailable, "Video");
    assert.ok(
      await unavailable
        .getByText("Captions aren’t available on this player.", { exact: false })
        .isVisible(),
    );
    const noCaptions = await rpc(home, {
      type: "api",
      path: "/api/video",
      body: { url: `${base}/demo/video/uncaptioned.html`, segments: [] },
    });
    assert.equal(noCaptions.available, false);
    assert.equal(noCaptions.source, "none");
    assert.deepEqual(noCaptions.segments, []);
    check("Uncaptioned native video reports unavailable without fabricated narration");

    const notebook = await ctx.newPage();
    pages.push(notebook);
    await notebook.goto(`${base}/notebook.html`);
    await notebook.bringToFront();
    await notebook
      .getByLabel("Local server pairing token", { exact: true })
      .fill(original.serverToken);
    await notebook.getByRole("button", { name: "Start camera", exact: true }).click();
    await notebook.waitForFunction(() => {
      const v = document.getElementById("preview");
      return (
        v.srcObject?.getVideoTracks().some((track) => track.readyState === "live") &&
        v.videoWidth > 0
      );
    });
    await notebook.getByRole("button", { name: "Read now", exact: true }).click();
    await notebook
      .getByText("DEMO: scripted notebook fixture. This is not camera transcription.", {
        exact: true,
      })
      .waitFor();
    assert.ok((await notebook.locator("#lines .line").count()) > 0);
    await notebook.getByRole("button", { name: "Faint page", exact: true }).click();
    assert.equal(
      await notebook
        .getByRole("button", { name: "Faint page", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await notebook.evaluate(() => {
      window.__cameraTestTrack = document.getElementById("preview").srcObject.getVideoTracks()[0];
    });
    await home.bringToFront();
    // Headless windows can keep all tabs visible; simulate the visibility source when needed.
    await notebook.evaluate(() => {
      if (!document.hidden)
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await notebook.getByText("Camera stopped.", { exact: true }).waitFor();
    assert.equal(await notebook.evaluate(() => window.__cameraTestTrack.readyState), "ended");
    assert.equal(await notebook.evaluate(() => document.getElementById("preview").srcObject), null);
    check("Fake camera notebook pairs, labels demo transcription and stops tracks when hidden");

    const note = await rpc(home, {
      type: "note.save",
      note: {
        text: "Specialist test note to remove",
        excerpt: "A test-only saved selection.",
        url: `${base}/demo/video/`,
        title: "Specialist lifecycle check",
      },
    });
    const control = await ctx.newPage();
    pages.push(control);
    await control.goto(`chrome-extension://${extensionId}/newtab.html#notes`);
    const card = control
      .locator(".note-card")
      .filter({ hasText: "Specialist test note to remove" });
    await card.waitFor();
    await card.getByRole("button", { name: "Remove", exact: true }).click();
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
    await openTool(video, "Capture this page");
    await video.locator(".page-capture img").waitFor();
    await video.getByRole("button", { name: "Attach to next message", exact: true }).click();
    await video.locator(".attachment-chip").waitFor();
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
        .getByLabel("Message your companion")
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
        async () => (await video.locator(".attachment-chip").count()) === 0,
        "one-use screenshot attachment cleared",
      );
      await until(
        async () =>
          (await video.getByRole("button", { name: "Send message", exact: true }).count()) > 0,
        "first screenshot question finished",
      );
      const before = requests.length;
      await video
        .getByLabel("Message your companion")
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
        character: original.character,
        reducedMotion: original.reducedMotion,
        screenshotEnabled: original.screenshotEnabled,
      },
    }).catch(() => {});
    for (const page of pages) await page.close().catch(() => {});
  }
}
