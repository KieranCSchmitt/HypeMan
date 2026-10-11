import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, emptyLearningGraph, emptyWorkspace, SETTINGS_KEY, LEARNING_KEY, WORKSPACE_KEY } from "@core";
import { upgradeLocalStorage, upgradeSessionStorage } from "../apps/extension/src/background/storage-upgrade";

function storage(initial: Record<string, unknown>) {
  const data = structuredClone(initial);
  return {
    data,
    get: vi.fn(async () => structuredClone(data)),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(data, structuredClone(patch)); }),
    remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete data[key]; }),
  };
}

describe("HypeMan storage upgrade", () => {
  it("validates imported records, preserves notes and settings, and retires source keys", async () => {
    const workspace = emptyWorkspace();
    workspace.notes.push({ id: "saved", text: "Keep this", excerpt: "Source", url: "https://example.com/", title: "Source", createdAt: 1, updatedAt: 1 });
    const area = storage({
      "previous.settings": { ...DEFAULT_SETTINGS, character: "default", characterName: "Previous", learningEnabled: true, serverToken: "private-token" },
      "previous.workspace": workspace,
      "previous.graph": emptyLearningGraph(),
      "previous.characters": [{ id: "custom", name: "My avatar", image: "data:image/png;base64,AAAA", createdAt: 1 }],
      unrelated: "Keep me",
      "unrelated.settings": "Malformed",
    });
    await upgradeLocalStorage(area);
    expect(area.data[SETTINGS_KEY]).toMatchObject({ characterName: "HypeMan", character: "hypeman", learningEnabled: true, serverToken: "private-token" });
    expect(area.data[WORKSPACE_KEY]).toEqual(workspace);
    expect(area.data[LEARNING_KEY]).toEqual(emptyLearningGraph());
    expect(area.data["hypeman.characters"]).toHaveLength(1);
    expect(area.data).not.toHaveProperty("previous.settings");
    expect(area.data).not.toHaveProperty("previous.workspace");
    expect(area.data.unrelated).toBe("Keep me");
    expect(area.data["unrelated.settings"]).toBe("Malformed");
    await upgradeLocalStorage(area);
    expect(area.set).toHaveBeenCalledTimes(1);
  });

  it("keeps current records authoritative and preserves custom names", async () => {
    const current = { ...DEFAULT_SETTINGS, characterName: "Current" };
    const area = storage({ [SETTINGS_KEY]: current, "previous.settings": DEFAULT_SETTINGS });
    await upgradeLocalStorage(area);
    expect(area.data[SETTINGS_KEY]).toEqual(current);
    const custom = storage({ "previous.settings": { ...DEFAULT_SETTINGS, character: "custom:avatar", characterName: "Nova" } });
    await upgradeLocalStorage(custom);
    expect(custom.data[SETTINGS_KEY]).toMatchObject({ character: "custom:avatar", characterName: "Nova" });
  });

  it("does not retire any source records when the new storage write fails", async () => {
    const area = storage({ "previous.settings": DEFAULT_SETTINGS });
    area.set.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(upgradeLocalStorage(area)).rejects.toThrow("Storage unavailable");
    expect(area.remove).not.toHaveBeenCalled();
    expect(area.data).toHaveProperty("previous.settings");
  });

  it("prefers newer settings and explicit learning snapshots over older imports", async () => {
    const graph = emptyLearningGraph();
    graph.plans.push({ id: "saved-plan", goal: "Keep learning", steps: [], createdAt: 1 });
    const area = storage({
      "older.settings": { serverUrl: DEFAULT_SETTINGS.serverUrl, learningEnabled: false },
      "older.graph": emptyLearningGraph(),
      "previous.settings": { ...DEFAULT_SETTINGS, learningEnabled: true },
      "previous.learning": graph,
    });
    await upgradeLocalStorage(area);
    expect(area.data[SETTINGS_KEY]).toMatchObject({ learningEnabled: true });
    expect(area.data[LEARNING_KEY]).toEqual(graph);
  });

  it("preserves session ownership and keeps existing HypeMan handoffs authoritative", async () => {
    const area = storage({
      "previous.session": true,
      "previous.tab.7": { handoff: { goal: "Continue" } },
      "previous.tab.8": { stale: true },
      "hypeman.tab.8": { current: true },
      unrelated: false,
    });
    await upgradeSessionStorage(area);
    expect(area.data).toEqual({
      "hypeman.session": true,
      "hypeman.tab.7": { handoff: { goal: "Continue" } },
      "hypeman.tab.8": { current: true },
      unrelated: false,
    });
  });
});
