// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageContent } from "../apps/extension/src/ui/MessageContent";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
describe("compact assistant explanations", () => {
  it("keeps the short answer and source accessible before expanding the complete explanation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const lead = "A quarter is half of one half. Four quarters make one whole, so three quarters leave one quarter.";
    const detail = "Use equal sized pieces to compare fractions. ".repeat(20);
    const text = `${lead}\n\n${detail}[Fractions, p. 12](hypeman-document:fractions?page=12)`;
    const open = vi.fn();
    await act(async () => root.render(createElement(MessageContent, { text, compact: true, onDocumentPage: open })));
    expect(host.querySelector(":scope > p")?.textContent).toBe(lead);
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.querySelector("details p")?.textContent).toContain(detail);
    await act(async () => host.querySelector<HTMLAnchorElement>(".chat-sources a")!.click());
    expect(open).toHaveBeenCalledWith("fractions", 12);
    await act(async () => root.render(createElement(MessageContent, { text, onDocumentPage: open })));
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).toContain(detail);
    await act(async () => root.unmount());
  });
});
