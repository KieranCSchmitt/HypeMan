import { GatewayError } from "./errors";
import { isObject } from "./media";

export const maxChatGPTText = 100_000;
const maxOutputItems = 128;

const invalid = (message: string): never => {
  throw new GatewayError(502, message, "invalid_provider_output");
};

/**
 * Models may wrap an otherwise valid JSON reply in a Markdown code block even
 * when instructed to emit JSON. Accept that complete wrapper, but never search
 * prose for a JSON fragment or repair partial JSON that could become an action.
 */
function parseObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return invalid("ChatGPT did not return an answer.");
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const source = fence ? fence[1]! : trimmed;
  try {
    const parsed: unknown = JSON.parse(source);
    if (isObject(parsed)) return parsed;
  } catch {
    // Only a single complete JSON object may reach the action adapter.
  }
  return invalid("ChatGPT returned malformed JSON.");
}

function requireCompletedResponse(
  value: unknown,
  refused: boolean,
): asserts value is Record<string, unknown> & { output: unknown[] } {
  if (
    refused ||
    !isObject(value) ||
    value.status !== "completed" ||
    value.error ||
    value.incomplete_details ||
    !Array.isArray(value.output)
  )
    invalid("ChatGPT did not return a complete answer.");
}

/** Read only completed output, never streamed partial text. */
export function completeChatGPTJson(value: unknown, refused: boolean): Record<string, unknown> {
  requireCompletedResponse(value, refused);

  const chunks: string[] = [];
  let length = 0;
  for (const item of value.output) {
    if (!isObject(item)) return invalid("ChatGPT returned malformed data.");
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content))
      return invalid("ChatGPT did not return an answer.");
    if (item.status && item.status !== "completed")
      return invalid("ChatGPT did not return a complete answer.");
    for (const part of item.content) {
      if (!isObject(part) || part.type !== "output_text" || typeof part.text !== "string")
        return invalid("ChatGPT did not return an answer.");
      length += part.text.length;
      if (length > maxChatGPTText) return invalid("ChatGPT returned an answer that was too long.");
      chunks.push(part.text);
    }
  }
  return parseObject(chunks.join(""));
}

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 512;

type OutputItem = {
  id: string;
  type: "message" | "reasoning";
  done?: Record<string, unknown>;
};

/**
 * Some ChatGPT streams omit output from their successful terminal snapshot.
 * Keep only whole, completed items with matching streamed identities. A done
 * item is not an answer until the response itself completes successfully.
 */
export class ChatGPTOutputAccumulator {
  private responseId: string | undefined;
  private readonly items: OutputItem[] = [];
  private readonly ids = new Set<string>();
  private textLength = 0;

  accept(event: unknown): void {
    if (!isObject(event)) return invalid("ChatGPT returned malformed data.");
    if (event.type === "response.created") {
      if (this.responseId || !isObject(event.response) || !validId(event.response.id))
        return invalid("ChatGPT returned malformed data.");
      this.responseId = event.response.id;
      return;
    }
    if (event.type !== "response.output_item.added" && event.type !== "response.output_item.done")
      return;

    const { item, output_index: index } = event;
    if (
      !this.responseId ||
      !Number.isSafeInteger(index) ||
      (index as number) < 0 ||
      (index as number) >= maxOutputItems ||
      !isObject(item) ||
      !validId(item.id) ||
      (item.type !== "message" && item.type !== "reasoning")
    )
      return invalid("ChatGPT returned malformed data.");

    if (event.type === "response.output_item.added") {
      if (index !== this.items.length || this.ids.has(item.id))
        return invalid("ChatGPT returned malformed data.");
      this.ids.add(item.id);
      this.items.push({ id: item.id, type: item.type });
      return;
    }

    const added = this.items[index as number];
    if (!added || added.done || added.id !== item.id || added.type !== item.type)
      return invalid("ChatGPT returned malformed data.");
    if (item.status && item.status !== "completed")
      return invalid("ChatGPT did not return a complete answer.");
    if (item.type === "reasoning") {
      // Reasoning content is neither presented nor interpreted as an action.
      added.done = { id: item.id, type: "reasoning" };
      return;
    }
    if (item.status !== "completed" || item.role !== "assistant" || !Array.isArray(item.content))
      return invalid("ChatGPT did not return a complete answer.");
    const content = item.content.map((part) => {
      if (!isObject(part) || part.type !== "output_text" || typeof part.text !== "string")
        return invalid("ChatGPT did not return an answer.");
      this.textLength += part.text.length;
      if (this.textLength > maxChatGPTText)
        return invalid("ChatGPT returned an answer that was too long.");
      return { type: "output_text", text: part.text };
    });
    added.done = { id: item.id, type: item.type, status: "completed", role: "assistant", content };
  }

  complete(value: unknown, refused: boolean): Record<string, unknown> {
    requireCompletedResponse(value, refused);
    if (this.responseId && value.id !== this.responseId)
      return invalid("ChatGPT returned malformed data.");
    // A populated terminal snapshot is authoritative; never repair its content
    // with streamed alternatives when it fails validation or JSON parsing.
    if (value.output.length > 0) return completeChatGPTJson(value, false);
    if (!this.responseId || this.items.length === 0)
      return invalid("ChatGPT did not return an answer.");
    if (this.items.some((item) => !item.done))
      return invalid("ChatGPT did not return a complete answer.");
    return completeChatGPTJson({ ...value, output: this.items.map((item) => item.done) }, false);
  }
}
