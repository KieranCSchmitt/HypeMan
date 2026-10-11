import OpenAI from "openai";
import type { Capability, ChatGPTStatus } from "@core";
import type { GatewayConfig } from "./config";
import type { ChatGPTAuth } from "./chatgpt-auth";
import { abortSignal, GatewayError } from "./errors";
import { isObject } from "./media";
import { ChatGPTOutputAccumulator, maxChatGPTText } from "./chatgpt-response";

type ChatGPTModel = { slug: string; displayName: string };

/** A cancelled caller can leave an account-wide refresh running for other requests. */
function waitWithSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

/** Deliberately omit provider messages, which may contain account or request details. */
function chatgptError(status?: number, code?: string | null): GatewayError {
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429)
    return new GatewayError(
      429,
      "ChatGPT plan usage is limited for this app. Manage usage at https://chatgpt.com/settings/usage or try again later.",
      "chatgpt_usage_limit",
    );
  if (code === "subscription_sharing_invalid_user" || status === 401)
    return new GatewayError(
      401,
      "ChatGPT could not authorize this session. Sign in again.",
      "chatgpt_auth_required",
    );
  if (
    code === "subscription_sharing_user_not_eligible" ||
    code === "subscription_sharing_route_not_supported" ||
    code === "chatpass_v2_scope_not_authorized" ||
    code === "chatpass_v2_invalid_authorization_context" ||
    status === 403
  )
    return new GatewayError(
      403,
      "ChatGPT plan usage is unavailable for this account, workspace, or region. Check your ChatGPT settings.",
      "chatgpt_not_eligible",
    );
  if (code === "subscription_sharing_unsupported_capability" || status === 400)
    return new GatewayError(
      400,
      "This request or attachment is unsupported by the selected ChatGPT model. Choose another model or remove the attachment.",
      "chatgpt_unsupported_capability",
    );
  return new GatewayError(
    503,
    "ChatGPT is temporarily unavailable. Try again shortly; your connection has been kept.",
    "chatgpt_unavailable",
  );
}

function responseErrorCode(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const error = isObject(value.error) ? value.error : value;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Provider credentials and vendor formats never cross the local gateway boundary. */
export class Providers {
  private chatgptCatalog: {
    profileId: string;
    at: number;
    result: Promise<ChatGPTModel[]>;
  } | null = null;
  constructor(
    private readonly config: GatewayConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly chatgpt?: ChatGPTAuth,
  ) {}
  get provider(): "openai" {
    return "openai";
  }
  get hasTextProvider(): boolean {
    const status = this.chatgpt?.status();
    return !!status?.activeProfileId && status.connected && status.sharing;
  }
  private get chatgptSelected(): boolean {
    return this.chatgpt?.status().activeProfileId != null;
  }
  private assertChatGPTProfile(profileId: string): void {
    if (this.chatgpt?.status().activeProfileId !== profileId)
      throw new GatewayError(
        409,
        "The selected ChatGPT account changed. Try again.",
        "chatgpt_account_changed",
      );
  }
  private async chatgptToken(profileId: string, signal: AbortSignal): Promise<string> {
    try {
      const token = await waitWithSignal(this.chatgpt!.accessToken(), signal);
      signal.throwIfAborted();
      this.assertChatGPTProfile(profileId);
      return token;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof GatewayError) throw error;
      throw chatgptError(401);
    }
  }
  private async availableChatGPTModels(signal: AbortSignal): Promise<ChatGPTModel[]> {
    signal = abortSignal(signal, Math.min(this.config.deadlineMs, 25_000));
    signal.throwIfAborted();
    const profileId = this.chatgpt?.status().activeProfileId;
    if (!profileId) throw chatgptError(401);
    const cached = this.chatgptCatalog;
    if (cached && cached.profileId === profileId && Date.now() - cached.at < 30_000)
      return waitWithSignal(cached.result, signal);
    const result = (async () => {
      const token = await this.chatgptToken(profileId, signal);
      const response = await this.fetcher("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal,
      });
      const data: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      this.assertChatGPTProfile(profileId);
      if (!response.ok) throw chatgptError(response.status, responseErrorCode(data));
      if (!isObject(data) || !Array.isArray(data.models)) throw chatgptError();
      const models = data.models.flatMap((model): ChatGPTModel[] =>
        isObject(model) &&
        model.visibility === "list" &&
        typeof model.slug === "string" &&
        model.slug.length > 0 &&
        typeof model.display_name === "string"
          ? [{ slug: model.slug, displayName: model.display_name }]
          : [],
      );
      if (!models.length)
        throw new GatewayError(
          403,
          "No ChatGPT models are available for this account.",
          "chatgpt_not_eligible",
        );
      return models;
    })().catch((error: unknown) => {
      if (this.chatgptCatalog?.result === result) this.chatgptCatalog = null;
      signal.throwIfAborted();
      if (error instanceof GatewayError) throw error;
      throw chatgptError();
    });
    this.chatgptCatalog = { profileId, at: Date.now(), result };
    return waitWithSignal(result, signal);
  }
  private async chatgptModel(signal: AbortSignal): Promise<string> {
    const profileId = this.chatgpt?.status().activeProfileId;
    if (!profileId) throw chatgptError(401);
    const models = await this.availableChatGPTModels(signal);
    signal.throwIfAborted();
    this.assertChatGPTProfile(profileId);
    const preferred = this.chatgpt!.model;
    const selected =
      models.find((model) => model.slug === preferred) ??
      models.find((model) => model.slug === this.config.model) ??
      models[0]!;
    if (preferred !== selected.slug) this.chatgpt!.setModel(selected.slug);
    return selected.slug;
  }
  async chatgptStatus(): Promise<ChatGPTStatus> {
    const status = this.chatgpt?.status() ?? {
      connected: false,
      sharing: false,
      activeProfileId: null,
      profiles: [],
      pending: false,
    };
    if (!status.activeProfileId || !status.connected || !status.sharing) return status;
    try {
      const signal = abortSignal(
        new AbortController().signal,
        Math.min(this.config.deadlineMs, 25_000),
      );
      const model = await this.chatgptModel(signal);
      const models = await this.availableChatGPTModels(signal);
      this.assertChatGPTProfile(status.activeProfileId);
      return { ...this.chatgpt!.status(), model, models };
    } catch (error) {
      return {
        ...this.chatgpt!.status(),
        error: error instanceof GatewayError ? error.message : chatgptError().message,
      };
    }
  }
  async selectChatGPTModel(model: string): Promise<void> {
    const profileId = this.chatgpt?.status().activeProfileId;
    if (!profileId) throw chatgptError(401);
    const models = await this.availableChatGPTModels(
      abortSignal(new AbortController().signal, Math.min(this.config.deadlineMs, 25_000)),
    );
    this.assertChatGPTProfile(profileId);
    if (!models.some((available) => available.slug === model))
      throw new GatewayError(
        400,
        "Choose a model available to the selected ChatGPT account.",
        "chatgpt_unsupported_capability",
      );
    this.chatgpt!.setModel(model);
  }
  async status(): Promise<Capability> {
    const available = this.hasTextProvider;
    return {
      available,
      mode: available ? "live" : "unavailable",
      reason: available
        ? "ChatGPT account connected"
        : "Sign in with ChatGPT and enable ChatGPT plan usage.",
    };
  }
  async json(
    system: string,
    input: unknown,
    signal: AbortSignal,
    image?: string,
    context?: string,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (!this.chatgptSelected) throw chatgptError(401);
    return this.chatgptJson(system, input, signal, image, context);
  }
  private async chatgptJson(
    system: string,
    input: unknown,
    parent: AbortSignal,
    image?: string,
    context?: string,
  ): Promise<Record<string, unknown>> {
    const signal = abortSignal(parent, this.config.deadlineMs);
    const profileId = this.chatgpt!.status().activeProfileId!;
    try {
      // Authorization is checked even when a model catalog is cached.
      const token = await this.chatgptToken(profileId, signal);
      const model = await this.chatgptModel(signal);
      this.assertChatGPTProfile(profileId);
      const client = new OpenAI({
        apiKey: token,
        baseURL: "https://api.openai.com/v1",
        timeout: this.config.deadlineMs,
        maxRetries: 0,
        fetch: this.fetcher,
        fetchOptions: { redirect: "error" },
      });
      const content: OpenAI.Responses.ResponseInputContent[] = [
        { type: "input_text", text: JSON.stringify(input) },
      ];
      if (context) content.push({ type: "input_image", image_url: context, detail: "high" });
      if (image) content.push({ type: "input_image", image_url: image, detail: "high" });
      const stream = await client.responses.create(
        {
          model,
          instructions: `${system}\nReturn exactly one valid JSON object without Markdown or surrounding text.`,
          input: [{ role: "user", content }],
          store: false,
          stream: true,
        },
        { signal },
      );
      let refused = false;
      let textLength = 0;
      const output = new ChatGPTOutputAccumulator();
      for await (const event of stream) {
        signal.throwIfAborted();
        this.assertChatGPTProfile(profileId);
        output.accept(event);
        if (event.type === "response.refusal.delta" || event.type === "response.refusal.done")
          refused = true;
        if (event.type === "response.output_text.delta") {
          textLength += event.delta.length;
          if (textLength > maxChatGPTText)
            throw new GatewayError(
              502,
              "ChatGPT returned an answer that was too long.",
              "invalid_provider_output",
            );
        }
        if (event.type === "response.failed")
          throw chatgptError(undefined, responseErrorCode(event.response.error));
        if (event.type === "error") throw chatgptError(undefined, event.code);
        if (event.type === "response.incomplete")
          throw new GatewayError(
            502,
            "ChatGPT did not finish its answer. Try a shorter request.",
            "invalid_provider_output",
          );
        if (event.type === "response.completed") return output.complete(event.response, refused);
      }
      signal.throwIfAborted();
      throw new GatewayError(
        502,
        "ChatGPT disconnected before completing its answer. Try again.",
        "invalid_provider_output",
      );
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof GatewayError) throw error;
      if (error instanceof OpenAI.APIError) throw chatgptError(error.status, error.code);
      throw chatgptError();
    }
  }
  async vision(
    system: string,
    input: unknown,
    image: string,
    signal: AbortSignal,
    context?: string,
  ): Promise<Record<string, unknown>> {
    return this.json(system, input, signal, image, context);
  }
}
