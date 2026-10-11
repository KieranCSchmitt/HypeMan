import { describe, expect, it } from "vitest";
import { createFrameGrantHandler, type FrameGrantStorage } from "./frame-grants";

const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const host: chrome.runtime.MessageSender = { id: origin.slice(19), tab: { id: 9 } as chrome.tabs.Tab,
  frameId: 0, documentId: "host", url: "https://example.com/lesson" };
const reader: chrome.runtime.MessageSender = { ...host, frameId: 2, documentId: "reader", url: `${origin}/documents.html?channel=channel` };
function memory() {
  let values: Record<string, unknown> = {};
  const storage: FrameGrantStorage = { get: async () => structuredClone(values), set: async (value) => { values = structuredClone(value); } };
  let time = 10;
  const handler = createFrameGrantHandler(storage, origin, () => time);
  const send = (type: string, args: Record<string, unknown> = {}, sender = host) => handler({ type, tool: "documents", channel: "channel", conversationId: "chat", ...args }, sender)!;
  return { storage, send, advance: () => { time += 60 * 60_000 + 1; } };
}
describe("private tool frame capabilities", () => {
  it("persists an exact tab, conversation, tool and channel capability across worker restart", async () => {
    const test = memory(); const { token } = await test.send("frame.grant") as { token: string };
    const restarted = createFrameGrantHandler(test.storage, origin, () => 100);
    expect(await restarted({ type: "frame.check", token, tool: "documents", channel: "channel", conversationId: "chat" }, reader)).toEqual({ ok: true });
    for (const changed of [{ channel: "another" }, { conversationId: "another" }, { tool: "settings" }, { token: "unknown" }])
      await expect(test.send("frame.check", { token, ...changed }, reader)).rejects.toThrow("authorized");
    await expect(test.send("frame.check", { token }, { ...reader, tab: { id: 10 } as chrome.tabs.Tab })).rejects.toThrow("authorized");
    await expect(test.send("frame.check", { token }, host)).rejects.toThrow("authorized");
  });
  it("cannot authorize itself, cannot reuse expired tokens, and scopes revocation to its host", async () => {
    const test = memory();
    await expect(test.send("frame.grant", {}, reader)).rejects.toThrow("itself");
    const { token } = await test.send("frame.grant") as { token: string };
    await expect(test.send("frame.revoke", { token }, { ...host, documentId: "other-page" })).rejects.toThrow("another page");
    test.advance(); await expect(test.send("frame.check", { token }, reader)).rejects.toThrow("authorized");
    const next = await test.send("frame.grant") as { token: string };
    await test.send("frame.revoke", next);
    await expect(test.send("frame.check", next, reader)).rejects.toThrow("authorized");
  });
  it("requires the intended extension reader page for settings, phone and connection", async () => {
    const test = memory();
    for (const [tool, page] of [["settings", "preferences.html"], ["phone", "preferences.html"], ["connection", "connection.html"]]) {
      const { token } = await test.send("frame.grant", { tool }) as { token: string };
      await expect(test.send("frame.check", { tool, token }, reader)).rejects.toThrow("authorized");
      expect(await test.send("frame.check", { tool, token }, { ...reader, url: `${origin}/${page}?tool=${tool}` })).toEqual({ ok: true });
    }
  });
});
