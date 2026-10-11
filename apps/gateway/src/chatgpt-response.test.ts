import { describe, expect, it } from "vitest";
import { ChatGPTOutputAccumulator, completeChatGPTJson, maxChatGPTText } from "./chatgpt-response";
import { GatewayError } from "./errors";

const message = (...parts: string[]) => ({
  type: "message",
  role: "assistant",
  status: "completed",
  content: parts.map((text) => ({ type: "output_text", text })),
});
const completed = (...output: unknown[]) => ({
  status: "completed",
  error: null,
  incomplete_details: null,
  output,
});
const decision = { kind: "answer", text: "Neurology studies the nervous system." };
const json = JSON.stringify(decision);

const createdEvent = {
  type: "response.created",
  response: { id: "resp-test", status: "in_progress", output: [], error: null },
};
const addedEvent = (index = 0, id = "msg-test", type = "message") => ({
  type: "response.output_item.added",
  output_index: index,
  item: { id, type, status: "in_progress", role: "assistant", content: [] },
});
const doneEvent = (index = 0, id = "msg-test", text = json) => ({
  type: "response.output_item.done",
  output_index: index,
  item: { id, ...message(text), phase: "final_answer" },
});
const sparseResponse = { id: "resp-test", ...completed() };
const accumulator = (...events: unknown[]) => {
  const output = new ChatGPTOutputAccumulator();
  for (const event of events) output.accept(event);
  return output;
};

describe("ChatGPT completed output item accumulation", () => {
  it("uses matching completed streamed items after a sparse successful terminal response", () => {
    const output = accumulator(createdEvent, addedEvent(), doneEvent());
    expect(output.complete(sparseResponse, false)).toEqual(decision);
  });

  it("orders reasoning and message items by their contiguous output index", () => {
    const output = accumulator(
      createdEvent,
      addedEvent(0, "reason-test", "reasoning"),
      addedEvent(1),
      doneEvent(1),
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { id: "reason-test", type: "reasoning", status: "completed" },
      },
    );
    expect(output.complete(sparseResponse, false)).toEqual(decision);
  });

  it("never recovers an answer from text delta or text done events alone", () => {
    const output = accumulator(
      createdEvent,
      addedEvent(),
      { type: "response.output_text.delta", delta: json },
      { type: "response.output_text.done", text: json },
    );
    expect(() => output.complete(sparseResponse, false)).toThrow("complete answer");
  });

  it.each([
    { ...sparseResponse, status: "incomplete" },
    { ...sparseResponse, error: { code: "failure" } },
    { ...sparseResponse, incomplete_details: { reason: "max_output_tokens" } },
    { ...sparseResponse, id: "resp-another" },
    { ...sparseResponse, output: null },
  ])("rejects failed, partial and mismatched terminal snapshots: %#", (response) => {
    const output = accumulator(createdEvent, addedEvent(), doneEvent());
    expect(() => output.complete(response, false)).toThrow(GatewayError);
  });

  it("honors a streamed refusal despite completed message items", () => {
    const output = accumulator(createdEvent, addedEvent(), doneEvent());
    expect(() => output.complete(sparseResponse, true)).toThrow("complete answer");
  });

  it("retains populated terminal output as the authoritative answer", () => {
    const output = accumulator(createdEvent, addedEvent(), doneEvent());
    const answer = { action: "say", text: "Authoritative answer", say: null, done: true };
    expect(
      output.complete({ ...sparseResponse, output: [message(JSON.stringify(answer))] }, false),
    ).toEqual(answer);
    expect(() =>
      output.complete({ ...sparseResponse, output: [message("{unfinished")] }, false),
    ).toThrow("malformed JSON");
  });

  it.each(
    [
      [doneEvent()],
      [createdEvent, doneEvent()],
      [createdEvent, addedEvent(1)],
      [createdEvent, addedEvent(-1)],
      [createdEvent, addedEvent(0.5)],
      [createdEvent, addedEvent(128)],
      [createdEvent, addedEvent(0, "")],
      [createdEvent, addedEvent(), addedEvent(1)],
      [createdEvent, addedEvent(), doneEvent(1)],
      [createdEvent, addedEvent(), doneEvent(0, "msg-other")],
      [createdEvent, addedEvent(), doneEvent(), doneEvent()],
      [createdEvent, createdEvent],
      [createdEvent, addedEvent(0, "tool", "function_call")],
      [
        createdEvent,
        addedEvent(),
        { ...doneEvent(), item: { ...doneEvent().item, type: "reasoning" } },
      ],
    ].map((events) => ({ events })),
  )("rejects missing, conflicting or out-of-bound streamed identities: %#", ({ events }) => {
    expect(() => accumulator(...events)).toThrow(GatewayError);
  });

  it.each([
    { ...doneEvent(), item: { ...doneEvent().item, status: "in_progress" } },
    { ...doneEvent(), item: { ...doneEvent().item, status: "incomplete" } },
    { ...doneEvent(), item: { ...doneEvent().item, status: undefined } },
    { ...doneEvent(), item: { ...doneEvent().item, role: "user" } },
    {
      ...doneEvent(),
      item: { ...doneEvent().item, content: [{ type: "refusal", refusal: "No." }] },
    },
    doneEvent(0, "msg-test", "x".repeat(maxChatGPTText + 1)),
  ])("rejects uncompleted, refused and oversized done messages: %#", (done) => {
    expect(() => accumulator(createdEvent, addedEvent(), done)).toThrow(GatewayError);
  });

  it("requires all added items to complete before using a sparse response", () => {
    const output = accumulator(createdEvent, addedEvent(), doneEvent(), addedEvent(1, "msg-next"));
    expect(() => output.complete(sparseResponse, false)).toThrow("complete answer");
  });

  it("reports empty terminal output clearly when no completed items exist", () => {
    expect(() => accumulator().complete(sparseResponse, false)).toThrow("did not return an answer");
    expect(() => accumulator(createdEvent).complete(sparseResponse, false)).toThrow(
      "did not return an answer",
    );
  });
});
describe("completed ChatGPT JSON replies", () => {
  it.each([
    json,
    ` \n${json}\n `,
    `\uFEFF${json}`,
    `\`\`\`json\n${json}\n\`\`\``,
    ` \n\`\`\`JSON\r\n${json}\r\n\`\`\`\n `,
    `\`\`\`\n${json}\n\`\`\``,
  ])("reads a whole object, with an optional complete JSON fence: %s", (text) => {
    expect(completeChatGPTJson(completed(message(text)), false)).toEqual(decision);
  });

  it("joins output text parts without parsing reasoning or partial stream deltas", () => {
    const result = completed(
      { type: "reasoning", summary: [{ text: "not a JSON answer" }] },
      message("```json\n", json.slice(0, 25)),
      message(json.slice(25), "\n```"),
    );
    expect(completeChatGPTJson(result, false)).toEqual(decision);
  });

  it("preserves braces and code fence text inside a JSON string", () => {
    const text = { kind: "answer", text: 'Examples: { braces }, ```json, and "quotes".' };
    expect(
      completeChatGPTJson(completed(message(`\`\`\`json\n${JSON.stringify(text)}\n\`\`\``)), false),
    ).toEqual(text);
  });

  it.each([
    "",
    "Here is an explanation of neurology.",
    `Here is the JSON:\n${json}`,
    `${json}\nThe task is complete.`,
    `Here is the JSON:\n\`\`\`json\n${json}\n\`\`\``,
    `\`\`\`json\n${json}\n\`\`\`\nThanks!`,
    `\`\`\`json\n${json}`,
    `${json}\n\`\`\``,
    `\`\`\`javascript\n${json}\n\`\`\``,
    `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``,
    `${json}${json}`,
    '{"kind":"click","target":',
    '{"kind":"click","target":"submit",}',
    "[]",
    "null",
    '"answer"',
  ])("rejects prose, fragments, multiple objects and malformed data: %s", (text) => {
    expect(() => completeChatGPTJson(completed(message(text)), false)).toThrow(GatewayError);
  });

  it("rejects concatenated complete assistant answers instead of choosing an arbitrary message", () => {
    expect(() => completeChatGPTJson(completed(message(json), message(json)), false)).toThrow(
      GatewayError,
    );
  });

  it.each([
    { ...completed(message(json)), status: "incomplete" },
    { ...completed(message(json)), error: { code: "failure" } },
    { ...completed(message(json)), incomplete_details: { reason: "max_output_tokens" } },
    completed({ ...message(json), status: "in_progress" }),
    completed({ ...message(json), role: "user" }),
    completed({ type: "function_call", name: "click", arguments: json }),
    completed({ ...message(json), content: [{ type: "refusal", refusal: "No." }] }),
    completed(message(json), { ...message(json), content: [{ type: "refusal", refusal: "No." }] }),
    completed(null),
    completed(),
  ])("requires a completed, non-refused assistant text response: %#", (response) => {
    expect(() => completeChatGPTJson(response, false)).toThrow(GatewayError);
  });

  it("honors refusals observed earlier in the stream even when the final answer looks valid", () => {
    expect(() => completeChatGPTJson(completed(message(json)), true)).toThrow(GatewayError);
  });

  it("bounds cumulative text across message parts including the Markdown wrapper", () => {
    expect(() =>
      completeChatGPTJson(completed(message(" ".repeat(maxChatGPTText), json)), false),
    ).toThrow("too long");
    expect(() =>
      completeChatGPTJson(completed(message("x".repeat(maxChatGPTText + 1))), false),
    ).toThrow("too long");
  });
});
