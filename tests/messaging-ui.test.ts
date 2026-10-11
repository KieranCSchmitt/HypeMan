// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unavailableMessagingStatus, type MessagingCapture, type MessagingStatus, type RuntimeEvent, type SelectedContent } from "@core";
import { request, subscribe } from "../apps/extension/src/bridge";
import { Messaging } from "../apps/extension/src/ui/Messaging";
import { WorkbenchContext, type ToolHandler } from "../apps/extension/src/ui/WorkbenchContext";
vi.mock("../apps/extension/src/bridge", () => ({ request: vi.fn(), subscribe: vi.fn(), readSettings: vi.fn(), writeSettings: vi.fn() }));
let root: Root, container: HTMLDivElement, status: MessagingStatus, captures: MessagingCapture[];
let receive: (event: RuntimeEvent) => void;
const handlers = new Map<string, ToolHandler>();
function Harness({ children }: { children: ReactNode }) {
  const [selected, selectContent] = useState<SelectedContent | null>(null);
  const register = (tool: string, handler: ToolHandler) => { handlers.set(tool, handler); return () => { if (handlers.get(tool) === handler) handlers.delete(tool); }; };
  return createElement(WorkbenchContext.Provider, { value: { conversationId: "phone-test", selected, selectContent, register, openTool: () => {}, send: async () => {}, executeTool: async (tool, operation, args = {}) => handlers.get(tool)!(operation, args) } }, children);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); handlers.clear();
  status = { ...unavailableMessagingStatus(), configured: true, connected: true, paired: true, ownerPhone: "+12125550123", error: undefined, lastSyncedAt: Date.now() };
  captures = [{ id: "idea-1", kind: "idea", text: "Pottery class ideas", createdAt: Date.now() }];
  vi.mocked(subscribe).mockImplementation((listener) => { receive = listener; return () => {}; });
  vi.mocked(request).mockReset().mockImplementation(async (input) => {
    if (input.type === "messaging.inbox") return structuredClone({ captures, status });
    if (input.type === "messaging.pair") return { code: "482913", expiresAt: Date.now() + 600000, deliveryStatus: "sent" };
    if (input.type === "messaging.settings") status.settings = { ...status.settings, ...input.patch as object };
    if (input.type === "messaging.unpair") status.paired = false;
    if (input.type === "messaging.dismiss" || input.type === "messaging.continue") captures = captures.filter((capture) => capture.id !== input.id);
    return { ok: true, status: "sent" };
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(Harness, null, createElement(Messaging, { connectionKey: "local" })))); }
async function invoke(operation: string, args: Record<string, unknown> = {}) { let result: string | void, failure: unknown; await act(async () => { try { result = await handlers.get("phone")!(operation, args); } catch (cause) { failure = cause; } }); if (failure) throw failure; return result!; }
async function changeInput(label: string, value: string, blur = false) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
  if (blur) await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}
describe("phone conversation tool", () => {
  it("shows ownership, freshness, schedules and self-reported commitments with compact direct actions", async () => {
    status.lastSyncedAt = Date.now() - 300000; status.commitments = [{ id: "daily-1", date: "2026-10-10", text: "Practice pottery", done: true, createdAt: Date.now() }];
    await render(); expect(container.textContent).toContain("Paired · •••• 0123"); expect(container.textContent).toContain("Sync needed");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Morning planning time"]')!.value).toBe("09:00"); expect(container.querySelector<HTMLInputElement>('[aria-label="Evening reflection time"]')!.value).toBe("19:00");
    expect(container.textContent).toContain("Daily commitments · self-reported"); expect(container.textContent).toContain("Reported done"); expect(container.querySelector<HTMLButtonElement>('[aria-label="Sync phone"]')?.disabled).toBe(false);
  });
  it("uses cached reads for notifications without a synchronization loop", async () => {
    await render(); expect(request).toHaveBeenCalledWith({ type: "messaging.inbox" }, expect.any(AbortSignal));
    await act(async () => receive({ type: "messaging.changed" })); expect(request).toHaveBeenLastCalledWith({ type: "messaging.inbox", refresh: false }, expect.any(AbortSignal));
  });
  it("pairs only after the owner's matching reply and expires the desktop code", async () => {
    vi.useFakeTimers(); status.paired = false; await render(); await invoke("pair", { phone: "+12125550123" });
    expect(request).toHaveBeenCalledWith({ type: "messaging.pair", phone: "+12125550123" }, expect.any(AbortSignal)); expect(container.textContent).toContain("PAIR 482913"); expect(container.textContent).not.toContain("Paired ·");
    await act(async () => vi.advanceTimersByTimeAsync(601500)); expect(container.textContent).toContain("Pairing code expired"); expect(container.textContent).not.toContain("PAIR 482913");
  });
  it("clears the pairing code after ownership is confirmed", async () => {
    status.paired = false; await render(); await invoke("pair", { phone: "+12125550123" }); status.paired = true;
    await act(async () => receive({ type: "messaging.changed" })); expect(container.textContent).toContain("Paired ·"); expect(container.querySelector(".phone-pair-code")).toBeNull();
  });
  it("keeps uncertain invitation codes and polls without resending", async () => {
    vi.useFakeTimers(); status.paired = false; const original = vi.mocked(request).getMockImplementation()!;
    vi.mocked(request).mockImplementation(async (input, signal) => input.type === "messaging.pair" ? { code: "482913", expiresAt: Date.now() + 600000, deliveryStatus: "unknown" } : original(input, signal));
    await render(); await invoke("pair", { phone: "+12125550123" }); await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(container.textContent).toContain("PAIR 482913"); expect(container.textContent).toContain("Invitation delivery is uncertain");
    expect(vi.mocked(request).mock.calls.filter(([input]) => input.type === "messaging.pair")).toHaveLength(1); expect(vi.mocked(request).mock.calls.filter(([input]) => input.type === "messaging.send")).toHaveLength(0);
  });
  it("does not run browser work until a selected capture is explicitly continued", async () => {
    await render(); expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "messaging.continue")).toBe(false);
    await act(async () => container.querySelector<HTMLElement>(".phone-item")!.click());
    expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "messaging.continue")).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Continue idea"]')!.click());
    expect(request).toHaveBeenCalledWith({ type: "messaging.continue", id: "idea-1" }, expect.any(AbortSignal)); expect(container.textContent).toContain("Inbox empty");
  });
  it("dismisses a selected capture without starting browser work", async () => {
    await render(); await invoke("dismiss", { id: "idea-1" }); expect(request).toHaveBeenCalledWith({ type: "messaging.dismiss", id: "idea-1" }, expect.any(AbortSignal)); expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "messaging.continue")).toBe(false);
  });
  it("keeps invalid timezone edits visible and saves a valid timezone on blur", async () => {
    await render(); await changeInput("Phone timezone", "invalid/timezone", true); expect(container.querySelector('[role="alert"]')?.textContent).toContain("valid timezone"); expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "messaging.settings")).toBe(false);
    await changeInput("Phone timezone", "America/Los_Angeles", true); expect(request).toHaveBeenCalledWith({ type: "messaging.settings", patch: { timezone: "America/Los_Angeles" } }, expect.any(AbortSignal));
    await changeInput("Morning planning time", "10:00"); expect(request).toHaveBeenCalledWith({ type: "messaging.settings", patch: { morningTime: "10:00" } }, expect.any(AbortSignal));
  });
  it("snoozes/cancels explicit reminders and exposes uncertain deliveries", async () => {
    status.reminders = [{ id: "pending-1", text: "Check the kiln", dueAt: Date.now() + 60000, status: "pending", createdAt: Date.now() }, { id: "unknown-1", text: "Phone sent uncertain", dueAt: Date.now(), status: "unknown", createdAt: Date.now() }];
    status.deliveries = [{ id: "delivery-1", text: "Phone sent uncertain", status: "unknown", at: Date.now() }]; await render();
    expect(container.textContent).toContain("delivery uncertain"); expect(container.textContent).toContain("Uncertain deliveries are not automatically resent");
    await invoke("snooze", { id: "pending-1", minutes: 60 }); await invoke("cancel", { id: "pending-1" });
    expect(request).toHaveBeenCalledWith({ type: "messaging.reminders", operation: "snooze", id: "pending-1", minutes: 60 }, expect.any(AbortSignal)); expect(request).toHaveBeenCalledWith({ type: "messaging.reminders", operation: "cancel", id: "pending-1" }, expect.any(AbortSignal));
  });
  it("rejects sleeping-hour check-ins without limiting requested reminders", async () => {
    await render(); await changeInput("Morning planning time", "08:00"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("between 9 AM and 9 PM"); expect(vi.mocked(request).mock.calls.some(([input]) => input.type === "messaging.settings")).toBe(false); expect(container.querySelector('[title^="Requested reminders"]')).not.toBeNull();
  });
  it("reports a failed gateway without inventing success and keeps a retry operation available", async () => {
    vi.mocked(request).mockRejectedValue(new Error("Start the local gateway.")); await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("Start the local gateway");
    await expect(invoke("status")).rejects.toThrow("Start the local gateway");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Sync phone"]')!.click());
    expect(request).toHaveBeenLastCalledWith({ type: "messaging.inbox" }, undefined);
  });
  it("unpairs and disables direct preference editing", async () => {
    await render(); await invoke("unpair"); expect(request).toHaveBeenCalledWith({ type: "messaging.unpair" }, expect.any(AbortSignal)); expect(container.querySelector("fieldset")!.disabled).toBe(true); expect(container.textContent).not.toContain("Paired ·");
  });
  it("sends only selected/supplied text to the paired owner", async () => {
    await render(); await invoke("send", { text: "Pottery notes\nhttps://example.com" }); expect(request).toHaveBeenCalledWith({ type: "messaging.send", text: "Pottery notes\nhttps://example.com" }, expect.any(AbortSignal));
  });
  it("reports uncertain delivery without resending or claiming arrival", async () => {
    await render(); const original = vi.mocked(request).getMockImplementation()!;
    vi.mocked(request).mockImplementation(async (input, signal) => input.type === "messaging.send" ? { status: "unknown" } : original(input, signal));
    await expect(invoke("send", { text: "Pottery notes" })).rejects.toThrow("Delivery is uncertain"); expect(container.textContent).toContain("Delivery is uncertain"); expect(vi.mocked(request).mock.calls.filter(([input]) => input.type === "messaging.send")).toHaveLength(1);
  });
  it("labels and shortens a long selected summary to the message limit", async () => {
    await render(); await invoke("send", { text: "a".repeat(7000) }); const sent = vi.mocked(request).mock.calls.find(([input]) => input.type === "messaging.send")![0].text as string; expect(sent.length).toBeLessThanOrEqual(6000); expect(sent).toContain("[Text shortened]");
  });
});
