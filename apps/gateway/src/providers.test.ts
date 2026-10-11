import { describe, expect, it, vi } from "vitest";
import { Providers } from "./providers";
import { loadConfig } from "./config";
import type { ChatGPTAuth } from "./chatgpt-auth";
import type { ChatGPTStatus } from "@core";
import { GatewayError } from "./errors";
const response = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
    }),
    { headers: { "content-type": "application/json" } },
  );

function chatgptSession() {
  const state: ChatGPTStatus = {
    connected: true,
    sharing: true,
    activeProfileId: "profile-one",
    profiles: [
      {
        id: "profile-one",
        label: "Private account",
        email: "private@example.com",
        connected: true,
        sharing: true,
      },
    ],
    pending: false,
  };
  let model: string | undefined;
  const accessToken = vi.fn(async () => "oauth-test-secret");
  const setModel = vi.fn((selected: string) => {
    model = selected;
  });
  const auth = {
    status: () => ({ ...state }),
    accessToken,
    get sharing() {
      return state.sharing;
    },
    get model() {
      return model;
    },
    setModel,
  } as unknown as ChatGPTAuth;
  return { auth, state, accessToken, setModel };
}
const modelCatalog = () =>
  new Response(
    JSON.stringify({
      models: [
        { slug: "first-model", display_name: "First available", visibility: "list" },
        { slug: "internal-model", display_name: "Hidden", visibility: "hidden" },
        { slug: "gpt-6-astra", display_name: "Configured model", visibility: "list" },
      ],
    }),
  );
const completed = (answer: unknown = { answer: "from ChatGPT" }) => ({
  type: "response.completed",
  response: {
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(answer) }],
      },
    ],
  },
});
const sseResponse = (...events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
const sparseCompletedEvents = (
  text = '{"action":"say","text":"Neurology studies the nervous system.","say":null,"done":true}',
) => {
  const item = {
    id: "msg-streamed-answer",
    type: "message",
    status: "completed",
    role: "assistant",
    phase: "final_answer",
    content: [{ type: "output_text", annotations: [], logprobs: [], text }],
  };
  return [
    {
      type: "response.created",
      response: { id: "resp-streamed", status: "in_progress", output: [], error: null },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      delta: text,
    },
    {
      type: "response.output_text.done",
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      text,
    },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: { id: "resp-streamed", status: "completed", output: [], error: null },
    },
  ];
};
describe("ChatGPT plan provider", () => {
  it("reads a finished streamed answer when ChatGPT omits output from its completed snapshot", async () => {
    const { auth } = chatgptSession();
    const fetcher = vi.fn(async (url: unknown) =>
      String(url).endsWith("/models") ? modelCatalog() : sseResponse(...sparseCompletedEvents()),
    ) as typeof fetch;
    const result = await new Providers(loadConfig({}), fetcher, auth).json(
      "Return a JSON browser decision.",
      {},
      new AbortController().signal,
    );
    expect(result).toEqual({
      action: "say",
      text: "Neurology studies the nervous system.",
      say: null,
      done: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never releases a done message without successful response completion", async () => {
    const events = sparseCompletedEvents();
    for (const stream of [
      events.slice(0, -1),
      [...events.slice(0, -1), { type: "response.incomplete", response: { status: "incomplete" } }],
      [
        ...events.slice(0, -1),
        { type: "response.failed", response: { error: { code: "provider_failure" } } },
      ],
      [...events.slice(0, -1), { type: "response.refusal.done", refusal: "No." }, events.at(-1)],
      events.filter((event) => event.type !== "response.output_item.done"),
    ]) {
      const { auth } = chatgptSession();
      const fetcher = vi.fn(async (url: unknown) =>
        String(url).endsWith("/models") ? modelCatalog() : sseResponse(...stream),
      ) as typeof fetch;
      await expect(
        new Providers(loadConfig({}), fetcher, auth).json(
          "Return a JSON browser decision.",
          {},
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(GatewayError);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("uses OAuth Responses with supported fields, images and the final completed JSON", async () => {
    const { auth } = chatgptSession();
    const fetcher = vi.fn(async (url: unknown) =>
      String(url).endsWith("/models")
        ? modelCatalog()
        : sseResponse(
            { type: "response.output_text.delta", delta: '{"answer":"partial"}' },
            completed(),
          ),
    ) as typeof fetch;
    const providers = new Providers(
      loadConfig({}),
      fetcher,
      auth,
    );
    const image = "data:image/png;base64,YQ==";
    expect(
      await providers.json(
        "Help with the page.",
        { question: "hello" },
        new AbortController().signal,
        image,
      ),
    ).toEqual({ answer: "from ChatGPT" });
    expect(providers.provider).toBe("openai");
    expect(providers.hasTextProvider).toBe(true);
    const calls = (fetcher as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[1][0])).toBe("https://api.openai.com/v1/responses");
    const options = calls[1][1] as RequestInit;
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer oauth-test-secret");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.redirect).toBe("error");
    const body = JSON.parse(String(options.body));
    expect(body).toEqual({
      model: "gpt-6-astra",
      instructions: expect.stringContaining("one valid JSON object"),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: '{"question":"hello"}' },
            { type: "input_image", image_url: image, detail: "high" },
          ],
        },
      ],
      store: false,
      stream: true,
    });
    expect(calls).toHaveLength(2);
  });
  it("keeps signed-in sessions selected after permission denial or expired credentials", async () => {
    const session = chatgptSession();
    session.state.connected = false;
    session.state.sharing = false;
    session.accessToken.mockRejectedValue(
      new GatewayError(403, "Enable ChatGPT plan usage.", "chatgpt_sharing_disabled"),
    );
    const fetcher = vi.fn(async () => response({ unexpected: true })) as typeof fetch;
    const providers = new Providers(
      loadConfig({}),
      fetcher,
      session.auth,
    );
    await expect(providers.json("JSON", {}, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(providers.provider).toBe("openai");
    expect(await providers.status()).toMatchObject({ available: false, mode: "unavailable" });
    session.state.activeProfileId = null;
    await expect(providers.json("JSON", {}, new AbortController().signal)).rejects.toMatchObject({
      status: 401,
      code: "chatgpt_auth_required",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports public readiness without account information", async () => {
    const session = chatgptSession();
    const providers = new Providers(
      loadConfig({}),
      vi.fn() as unknown as typeof fetch,
      session.auth,
    );
    expect(await providers.status()).toEqual({
      available: true,
      mode: "live",
      reason: "ChatGPT account connected",
    });
    expect(JSON.stringify(await providers.status())).not.toContain("private");
    expect(session.accessToken).not.toHaveBeenCalled();
  });
  it("preserves catalog ordering, caches it per account, and validates model choices", async () => {
    const session = chatgptSession();
    const fetcher = vi.fn(async () => modelCatalog()) as typeof fetch;
    const providers = new Providers(loadConfig({}), fetcher, session.auth);
    expect(await providers.chatgptStatus()).toMatchObject({
      model: "gpt-6-astra",
      models: [
        { slug: "first-model", displayName: "First available" },
        { slug: "gpt-6-astra", displayName: "Configured model" },
      ],
    });
    await providers.selectChatGPTModel("first-model");
    expect((await providers.chatgptStatus()).model).toBe("first-model");
    await expect(providers.selectChatGPTModel("unavailable-model")).rejects.toMatchObject({
      status: 400,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    session.state.activeProfileId = "profile-two";
    await providers.chatgptStatus();
    expect(fetcher).toHaveBeenCalledTimes(2);
    session.state.activeProfileId = "profile-one";
    await providers.chatgptStatus();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("chooses the first account model if configured and saved choices are unavailable", async () => {
    const session = chatgptSession();
    session.setModel("no-longer-available");
    const providers = new Providers(
      loadConfig({ CHATGPT_MODEL: "not-in-catalog" }),
      vi.fn(async () => modelCatalog()) as typeof fetch,
      session.auth,
    );
    expect((await providers.chatgptStatus()).model).toBe("first-model");
    expect(session.setModel).toHaveBeenLastCalledWith("first-model");
  });
  it("expires the model catalog after thirty seconds", async () => {
    const session = chatgptSession();
    const fetcher = vi.fn(async () => modelCatalog()) as typeof fetch;
    const providers = new Providers(loadConfig({}), fetcher, session.auth);
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      await providers.chatgptStatus();
      now.mockReturnValue(129_999);
      await providers.chatgptStatus();
      expect(fetcher).toHaveBeenCalledOnce();
      now.mockReturnValue(130_000);
      await providers.chatgptStatus();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
  it("fails closed on a plan usage limit after otherwise usable streamed text", async () => {
    const session = chatgptSession();
    const fetcher = vi.fn(async (url: unknown) =>
      String(url).endsWith("/models")
        ? modelCatalog()
        : sseResponse(
            { type: "response.output_text.delta", delta: '{"answer":"looks complete"}' },
            {
              type: "response.failed",
              response: {
                error: {
                  code: "subscription_sharing_usage_limit_exceeded",
                  message: "private diagnostic",
                },
              },
            },
          ),
    ) as typeof fetch;
    const providers = new Providers(
      loadConfig({}),
      fetcher,
      session.auth,
    );
    await expect(providers.json("JSON", {}, new AbortController().signal)).rejects.toMatchObject({
      status: 429,
      code: "chatgpt_usage_limit",
      message: expect.stringContaining("https://chatgpt.com/settings/usage"),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects partial EOF, incomplete, explicit error, refusal, malformed JSON, and non-object answers", async () => {
    const cases = [
      sseResponse({ type: "response.output_text.delta", delta: '{"answer":"complete-looking"}' }),
      sseResponse({ type: "response.incomplete", response: { status: "incomplete" } }),
      sseResponse({
        type: "error",
        code: "subscription_sharing_unsupported_capability",
        message: "private diagnostic",
      }),
      sseResponse({ type: "response.refusal.delta", delta: "refused" }, completed()),
      sseResponse({
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "refusal", refusal: "refused" }],
            },
          ],
        },
      }),
      sseResponse({
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "{unfinished" }],
            },
          ],
        },
      }),
      sseResponse(completed(["array"])),
    ];
    for (const output of cases) {
      const session = chatgptSession();
      const fetcher = vi.fn(async (url: unknown) =>
        String(url).endsWith("/models") ? modelCatalog() : output,
      ) as typeof fetch;
      const providers = new Providers(
        loadConfig({}),
        fetcher,
        session.auth,
      );
      await expect(providers.json("JSON", {}, new AbortController().signal)).rejects.toBeInstanceOf(
        GatewayError,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("maps admission failures to safe actionable errors without provider diagnostics", async () => {
    for (const status of [400, 401, 403, 429, 503]) {
      const session = chatgptSession();
      const fetcher = vi.fn(async (url: unknown) =>
        String(url).endsWith("/models")
          ? modelCatalog()
          : new Response(JSON.stringify({ detail: "private diagnostic oauth-test-secret" }), {
              status,
            }),
      ) as typeof fetch;
      const providers = new Providers(
        loadConfig({}),
        fetcher,
        session.auth,
      );
      const failure = await providers
        .json("JSON", {}, new AbortController().signal)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ status });
      expect(String(failure)).not.toContain("private diagnostic");
      expect(String(failure)).not.toContain("oauth-test-secret");
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("bounds streamed and final text without an unsupported max_output_tokens field", async () => {
    const oversized = "x".repeat(100_001);
    for (const output of [
      sseResponse({ type: "response.output_text.delta", delta: oversized }, completed()),
      sseResponse(completed({ answer: oversized })),
    ]) {
      const session = chatgptSession();
      const fetcher = vi.fn(async (url: unknown) =>
        String(url).endsWith("/models") ? modelCatalog() : output,
      ) as typeof fetch;
      await expect(
        new Providers(loadConfig({}), fetcher, session.auth).json(
          "JSON",
          {},
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 502, code: "invalid_provider_output" });
    }
  });
  it("cancels ChatGPT work with the caller signal and never retries another billing path", async () => {
    const session = chatgptSession();
    let upstream!: AbortSignal;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn((url: unknown, options?: RequestInit) => {
      if (String(url).endsWith("/models")) return Promise.resolve(modelCatalog());
      return new Promise<Response>((_resolve, reject) => {
        upstream = options!.signal as AbortSignal;
        upstream.addEventListener("abort", () => reject(upstream.reason), { once: true });
        started();
      });
    }) as typeof fetch;
    const providers = new Providers(
      loadConfig({}),
      fetcher,
      session.auth,
    );
    const control = new AbortController();
    const work = providers.json("JSON", {}, control.signal);
    await ready;
    control.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(upstream.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cancels a caller while account-wide token renewal is still pending", async () => {
    const session = chatgptSession();
    session.accessToken.mockImplementation(() => new Promise<string>(() => {}));
    const fetcher = vi.fn() as unknown as typeof fetch;
    const control = new AbortController();
    const work = new Providers(
      loadConfig({}),
      fetcher,
      session.auth,
    ).json("JSON", {}, control.signal);
    control.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("ChatGPT-only connection", () => {
  it("requires sign-in before contacting AI services", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const config = loadConfig({});
    const providers = new Providers(config, fetcher);
    expect(providers.hasTextProvider).toBe(false);
    expect(await providers.status()).toMatchObject({
      available: false,
      mode: "unavailable",
      reason: expect.stringContaining("Sign in with ChatGPT"),
    });
    await expect(providers.json("JSON", {}, new AbortController().signal)).rejects.toMatchObject({
      status: 401,
      code: "chatgpt_auth_required",
    });
    await expect(
      providers.vision(
        "Read handwriting",
        {},
        "data:image/png;base64,YQ==",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 401, code: "chatgpt_auth_required" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the ChatGPT connection for drawing images, with task context first", async () => {
    const { auth } = chatgptSession();
    const fetcher = vi.fn(async (url: unknown) =>
      String(url).endsWith("/models")
        ? modelCatalog()
        : sseResponse(completed({ readback: [], legibility: "unreadable", observations: [], issues: [], nextStep: "Check the image." })),
    ) as typeof fetch;
    const providers = new Providers(loadConfig({}), fetcher, auth);
    const image = "data:image/png;base64,YQ==";
    const context = "data:image/png;base64,Yg==";
    expect(
      await providers.vision(
        "Read only visible handwriting",
        {},
        image,
        new AbortController().signal,
        context,
      ),
    ).toEqual({ readback: [], legibility: "unreadable", observations: [], issues: [], nextStep: "Check the image." });
    const calls = (fetcher as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map(([url]) => String(url))).toEqual([
      "https://api.openai.com/v1/models",
      "https://api.openai.com/v1/responses",
    ]);
    const body = JSON.parse(String(calls[1][1].body));
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "{}" },
      { type: "input_image", image_url: context, detail: "high" },
      { type: "input_image", image_url: image, detail: "high" },
    ]);
  });
});
