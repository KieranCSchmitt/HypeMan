import { describe, expect, it, vi } from "vitest";
import { parseInkAssessment } from "@core";
import { loadConfig } from "./config";
import { Providers } from "./providers";
import { validateRoute } from "./validation";
import { vision } from "./vision";

const image = "data:image/png;base64,YQ==";
const assessment = () => ({
  readback: ["1/2 + 1/4", "= 2/6"],
  legibility: "readable",
  observations: ["You are combining fractions."],
  issues: [{ evidence: "= 2/6", concern: "These parts have different sizes.", question: "How could you give the parts a shared size?" }],
  nextStep: "Draw each fraction on a matching strip.",
});
const provider = (value: unknown) => ({ provider: "chatgpt", vision: vi.fn(async () => value) }) as unknown as Providers;
const review = (value: unknown) => vision({ image }, provider(value), loadConfig({}), new AbortController().signal);

describe("evidence-based drawing reviews", () => {
  it("passes the learner's goal and prior readback to vision and preserves grounded questions", async () => {
    const providers = provider(assessment());
    const signal = new AbortController().signal;
    const result = await vision({ image, goal: "Add fractions", previousLines: ["1/2 + 1/4"] }, providers, loadConfig({}), signal);
    expect(result).toMatchObject({ ...assessment(), provider: "chatgpt" });
    expect(providers.vision).toHaveBeenCalledWith(expect.stringContaining("Never provide a final answer"),
      { goal: "Add fractions", previousLines: ["1/2 + 1/4"] }, image, signal, undefined);
  });
  it.each(["partial", "unreadable"])("does not assess %s writing even when a provider invents a concern", async (legibility) => {
    const result = await review({ ...assessment(), legibility, nextStep: "Unverified solved answer" });
    expect(result).toMatchObject({ legibility, observations: [], issues: [] });
    expect(JSON.stringify(result)).not.toContain("Unverified solved answer");
    if (legibility === "unreadable") expect(result).toMatchObject({ readback: [] });
  });
  it("rejects an issue that cannot be traced to the current readback", async () => {
    const value = assessment();
    value.issues[0].evidence = "writing absent from the image";
    await expect(review(value)).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    { ...assessment(), readback: [42] },
    { ...assessment(), issues: [{ evidence: "= 2/6", concern: "", question: "What next?" }] },
    { ...assessment(), legibility: "certain" },
    { ...assessment(), observations: ["x".repeat(601)] },
  ])("rejects malformed assessments", async (value) => {
    await expect(review(value)).rejects.toMatchObject({ status: 502 });
  });
  it("accepts demo feedback through the same review contract and labels its source", async () => {
    const providers = provider(null);
    const result = await vision({ image }, providers, loadConfig({ DEMO_MODE: "1" }), new AbortController().signal);
    expect(parseInkAssessment(result)?.readback).toEqual(["1/2 + 1/4", "= 2/6"]);
    expect(result).toMatchObject({ provider: "demo", source: "Scripted fraction review; not analysis of your drawing" });
    expect(providers.vision).not.toHaveBeenCalled();
  });
  it("bounds the learner goal and prior readback at the HTTP boundary", () => {
    expect(validateRoute("/api/ink", { image, goal: "Add fractions", previousLines: ["1/2"] })).toMatchObject({ goal: "Add fractions" });
    expect(() => validateRoute("/api/ink", { image, goal: "x".repeat(2001) })).toThrow();
    expect(() => validateRoute("/api/ink", { image, previousLines: Array(61).fill("a") })).toThrow();
  });
});
