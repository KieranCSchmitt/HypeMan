import assert from "node:assert/strict";
import http from "node:http";
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
let context, page, networkProxy;
let pageExplanations = 0;
let tokenExchanges = 0;
const fetcher = async (input, init) => {
  const url = String(input);
  assert.ok(["https://auth.openai.com", "https://api.openai.com"].includes(new URL(url).origin));
  if (url.endsWith("/openid-configuration"))
    return Response.json({
      issuer: "https://auth.openai.com",
      revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
    });
  if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
  if (url.endsWith("/oauth/token")) {
    tokenExchanges++;
    return Response.json({
      access_token: "fake-browser-access",
      refresh_token: "fake-browser-refresh",
      id_token: "fake-browser-id",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    });
  }
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
  // Isolate the browser before its install-created pages can contact a default local server.
  // A later global fetch override would miss the worker's already-bound GatewayClient fetcher.
  networkProxy = http.createServer((request, response) => {
    const destination = new URL(request.url, url);
    if (destination.origin !== url) {
      response.writeHead(403).end("This browser test permits only its fixture gateway.");
      return;
    }
    const upstream = http.request(destination, {
      method: request.method,
      headers: request.headers,
    }, (reply) => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => response.writeHead(502).end());
    request.pipe(upstream);
  });
  networkProxy.on("connect", (_request, socket) => {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  networkProxy.on("connection", (socket) => socket.on("error", () => {}));
  await new Promise((resolve) => networkProxy.listen(0, "127.0.0.1", resolve));
  const extension = resolve("apps/extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    proxy: { server: `http://127.0.0.1:${networkProxy.address().port}`, bypass: "<-loopback>" },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // Replace only the external authorization page with a test-controlled local callback.
  await worker.evaluate((fixtureOrigin) => {
    const createTab = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = async (options) => {
      if (options.url?.startsWith("https://auth.openai.com/api/accounts/authorize?")) {
        const callback = new URL(new URL(options.url).searchParams.get("redirect_uri"));
        if (callback.origin !== fixtureOrigin) throw new Error("OAuth escaped the fixture gateway.");
        globalThis.mockAuthorizationUrls ??= [];
        globalThis.mockAuthorizationUrls.push(options.url);
        globalThis.mockAuthorizationUrl = options.url;
        return createTab({ ...options, url: "about:blank" });
      }
      return createTab(options);
    };
  }, url);
  const extensionId = new URL(worker.url()).host;
  // Confirm Chromium routes loopback through the allowlist, using only a safe fixture alias.
  assert.equal(await worker.evaluate(async (fixtureOrigin) => {
    const alias = new URL("/health", fixtureOrigin);
    alias.hostname = "localhost";
    return (await fetch(alias)).status;
  }, url), 403);
  const onboarding = `chrome-extension://${extensionId}/onboarding.html`;
  page = context.pages().find((candidate) => candidate.url() === onboarding) ??
    (await context.waitForEvent("page"));
  await page.waitForURL(onboarding);
  const rpc = (message) =>
    page.evaluate(async (message) => {
      const result = await chrome.runtime.sendMessage({
        ...message,
        requestId: crypto.randomUUID(),
      });
      if (!result?.ok) throw new Error(result?.error);
      return result.data;
    }, message);
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).waitFor();
  // The install page follows onInstalled's queued settings write. Configure through that owner.
  assert.equal((await rpc({ type: "settings.get" })).serverToken, "");
  const configured = await rpc({ type: "settings.patch", patch: { serverUrl: url } });
  assert.equal(configured.serverUrl, url);
  assert.equal(configured.serverToken, "");
  assert.equal((await rpc({ type: "connection.ensure" })).demoMode, false);
  assert.equal((await rpc({ type: "settings.get" })).serverToken, token);
  assert.equal((await rpc({ type: "chatgpt.status" })).connected, false);
  assert.equal(await page.getByLabel("Pairing token", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).waitFor();
  assert.ok(!(await page.locator("body").innerText()).includes("On-device model"));
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
  await page.getByRole("button", { name: "Cancel sign-in", exact: true }).waitFor();
  assert.equal(await worker.evaluate(() => globalThis.mockAuthorizationUrls.length), 1);
  const authorize = new URL(await worker.evaluate(() => globalThis.mockAuthorizationUrl));
  assert.equal(authorize.origin, "https://auth.openai.com");
  const callback = new URL(authorize.searchParams.get("redirect_uri"));
  assert.equal(callback.origin, url);
  callback.search = new URLSearchParams({
    state: authorize.searchParams.get("state"),
    code: "browser-one-time-code",
    client_id: "oaiapp_browser_test",
  }).toString();
  const loginPage =
    context.pages().find((candidate) => candidate !== page && candidate.url() === "about:blank") ??
    (await context.newPage());
  await loginPage.goto(callback.href);
  assert.equal(tokenExchanges, 1);
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
  networkProxy?.closeAllConnections();
  if (networkProxy) await new Promise((resolve) => networkProxy.close(resolve));
  await gateway.close();
  await rm(directory, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
