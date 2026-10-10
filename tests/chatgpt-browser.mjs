import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");
const { tsImport } = require("tsx/esm/api");
const baseImport = new URL("./tests/browser.mjs", `file://${process.cwd()}/`).href;
const { ChatGPTAuth } = await tsImport("../apps/gateway/src/chatgpt-auth.ts", baseImport);
const { createGateway } = await tsImport("../apps/gateway/src/index.ts", baseImport);
const { loadConfig } = await tsImport("../apps/gateway/src/config.ts", baseImport);
const directory = await mkdtemp(join(tmpdir(), "hypeman-auth-browser-"));
const profile = await mkdtemp(join(tmpdir(), "hypeman-auth-chrome-"));
let context, page;
let pageExplanations = 0;
const fetcher = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/openid-configuration"))
    return Response.json({
      issuer: "https://auth.openai.com",
      revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
    });
  if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
  if (url.endsWith("/oauth/token"))
    return Response.json({
      access_token: "fake-browser-access",
      refresh_token: "fake-browser-refresh",
      id_token: "fake-browser-id",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    });
  if (url.endsWith("/models"))
    return Response.json({
      models: [
        { slug: "model-one", display_name: "Model One", visibility: "list" },
        { slug: "model-two", display_name: "Model Two", visibility: "list" },
      ],
    });
  if (url.endsWith("/responses")) {
    const request = JSON.parse(String(init.body));
    assert.equal(request.model, "model-two");
    const agentInput = JSON.parse(request.input[0].content[0].text);
    const explainingPage = agentInput.message === "Explain this";
    if (explainingPage) {
      pageExplanations++;
      assert.ok(agentInput.page.url.endsWith("/demo/learning/"));
      assert.ok(agentInput.page.text.includes("equation"));
    }
    const event = {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  action: "say",
                  text: explainingPage
                    ? "Apply the same operation to both sides to keep the equation balanced."
                    : "Mock ChatGPT plan response.",
                  done: true,
                }),
              },
            ],
          },
        ],
      },
    };
    const item = { id: "msg_browser_explanation", ...event.response.output[0] };
    const responseId = "resp_browser_explanation";
    const text = item.content[0].text;
    // ChatGPT can finish with an empty response.output even though the stream
    // already delivered a completed assistant item. Match that live event shape.
    const events = explainingPage
      ? [
          {
            type: "response.created",
            response: { id: responseId, status: "in_progress", output: [], error: null },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, status: "in_progress", phase: "final_answer", content: [] },
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            item_id: item.id,
            delta: text.slice(0, 24),
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            item_id: item.id,
            delta: text.slice(24),
          },
          { type: "response.output_text.done", output_index: 0, text },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: { ...item, phase: "final_answer" },
          },
          {
            type: "response.completed",
            response: { id: responseId, status: "completed", output: [], error: null },
          },
        ]
      : [event];
    const stream = events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("");
    return new Response(`${stream}data: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  }
  throw new Error("Unexpected provider URL");
};
const auth = new ChatGPTAuth({
  directory,
  fetcher,
  verifyIdentity: async () => ({ subject: "browser-test-sub", email: "browser-test@example.com" }),
});
const token = "hypeman-auth-private-transport";
const gateway = createGateway(loadConfig({ PORT: "0" }), {
  token,
  chatgpt: auth,
  fetcher,
});
try {
  const url = `http://127.0.0.1:${await gateway.listen()}`;
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // Replace only the external authorization page with a test-controlled local callback.
  await worker.evaluate(() => {
    const createTab = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = async (options) => {
      if (options.url?.startsWith("https://auth.openai.com/api/accounts/authorize?")) {
        globalThis.mockAuthorizationUrl = options.url;
        return createTab({ ...options, url: "about:blank" });
      }
      return createTab(options);
    };
  });
  const extensionId = new URL(worker.url()).host;
  // Only the test server address is configured. No local token is injected by the test.
  await worker.evaluate(
    (serverUrl) =>
      chrome.storage.local.set({
        "burrow.settings": { version: 2, serverUrl, serverToken: "" },
      }),
    url,
  );
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  const rpc = (message) =>
    page.evaluate(async (message) => {
      const result = await chrome.runtime.sendMessage({
        ...message,
        requestId: crypto.randomUUID(),
      });
      if (!result?.ok) throw new Error(result?.error);
      return result.data;
    }, message);
  assert.equal(await page.getByLabel("Pairing token", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).waitFor();
  assert.ok(!(await page.locator("body").innerText()).includes("On-device model"));
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
  await page.waitForTimeout(200);
  const authorize = new URL(await worker.evaluate(() => globalThis.mockAuthorizationUrl));
  const callback = new URL(authorize.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    state: authorize.searchParams.get("state"),
    code: "browser-one-time-code",
    client_id: "oaiapp_browser_test",
  }).toString();
  const loginPage =
    context.pages().find((candidate) => candidate !== page && candidate.url() === "about:blank") ??
    (await context.newPage());
  await loginPage.goto(callback.href);
  await page.waitForURL(`chrome-extension://${extensionId}/newtab.html`, { timeout: 15000 });
  await assert.doesNotReject(async () => {
    await page.waitForFunction(() => document.visibilityState === "visible");
  });
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await page.getByText("Using ChatGPT plan · browser-test@example.com", { exact: true }).waitFor();
  await page.locator("summary").filter({ hasText: "Account settings" }).click();
  await page.getByLabel("ChatGPT model", { exact: true }).selectOption("model-two");
  await page.waitForTimeout(300);
  const reply = await rpc({ type: "assistant.ask", message: "Say hello" });
  assert.equal(reply.text, "Mock ChatGPT plan response.");
  assert.equal(reply.provider, "openai");
  const article = await context.newPage();
  await article.goto(`${url}/demo/learning/`);
  await article.getByRole("button", { name: /Open HypeMan\. Drag/ }).click();
  await article.getByLabel("Message your companion").fill("Explain this");
  await article.getByRole("button", { name: "Send message", exact: true }).click();
  const explanation = article
    .locator(".chat-message.assistant")
    .getByText("Apply the same operation to both sides to keep the equation balanced.", {
      exact: true,
    });
  const malformed = article.getByText("ChatGPT returned malformed JSON.", { exact: true });
  await Promise.race([explanation.waitFor(), malformed.waitFor({ state: "attached" })]);
  assert.equal(await malformed.count(), 0);
  await explanation.waitFor();
  assert.equal(pageExplanations, 1);
  await article.close();
  const saved = await page.evaluate(() => chrome.storage.local.get(null));
  assert.ok(!JSON.stringify(saved).includes("fake-browser-access"));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).waitFor();
  assert.equal(auth.status().activeProfileId, null);
  await page
    .getByRole("button", { name: "Open HypeMan", exact: true })
    .waitFor({ state: "hidden" });
  const signedOutHealth = await rpc({ type: "health" });
  for (const name of ["agent", "character", "ink", "notebook", "learning"])
    assert.equal(signedOutHealth.capabilities[name].available, false);
  await assert.rejects(rpc({ type: "assistant.ask", message: "Say hello" }), /Sign in again/);
  await page.reload();
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Pairing token", { exact: true }).count(), 0);
  await page.screenshot({ path: "tests/screenshots/hypeman-chatgpt-only.png", fullPage: true });
  console.log(
    "PASS: fresh extension connects without a key, one-button OAuth, automatic return to HypeMan, account/model choice, streamed inference, companion page explanation, sign-out, and no OAuth credentials in extension storage.",
  );
} catch (error) {
  console.log("Safe auth state", JSON.stringify(auth.status()));
  if (page) console.log("UI", await page.locator("body").innerText());
  throw error;
} finally {
  await context?.close();
  await gateway.close();
  await rm(directory, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
