import { describe, expect, it } from "vitest";
import { completionKind, completionSubject, freshCompletion, matchesCompletion, pendingCompletion, verifiedCompletion } from "./browser-outcomes";
import { parseAgentRequest } from "./validation";
import type { PageSnapshot } from "./contracts";

const page = (notice = "", url = "https://example.com/workshops/pottery"): PageSnapshot => ({
  url, title: "Pottery Basics", headings: ["Pottery Basics"], text: `Pottery Basics ${notice}`,
  successes: notice ? [notice] : [], errors: [], elements: [], selection: "",
  frames: { count: 0, inaccessible: 0 }, capturedAt: 1, revision: 1,
});

describe("completion bound to the requested outcome", () => {
  it("identifies named subjects and recipients without inventing an object from a generic request", () => {
    expect(completionSubject("Register for Pottery Basics, then save the receipt.")).toBe("Pottery Basics");
    expect(completionSubject("Confirm the Pottery Basics registration")).toBe("Pottery Basics");
    expect(completionSubject("Send this message to Alex Morgan")).toBe("Alex Morgan");
    expect(completionSubject("Register for this workshop")).toBeUndefined();
    expect(completionSubject("Buy the cheapest option")).toBeUndefined();
  });
  it("rejects a fresh same-kind confirmation for another named subject", () => {
    const pending = pendingCompletion("Register for Pottery Basics", "Register now", page());
    for (const notice of ["Registration confirmed for Photography Workshop", "Registration for Photography Workshop confirmed", "Photography Workshop registration confirmed", "Registered for Photography Workshop"])
      expect(freshCompletion(pending, page(notice))).toBeUndefined();
    const matching = freshCompletion(pending, page("Registration confirmed for Pottery Basics"));
    expect(matching).toMatchObject({ subject: "Pottery Basics", fromUrl: page().url, control: "Register now" });
  });
  it("accepts a generic confirmation from the matching held action and keeps its subject binding", () => {
    const pending = pendingCompletion("Register for Pottery Basics", "Register for Pottery Basics", page());
    const completion = freshCompletion(pending, page("Registration confirmed"));
    expect(completion?.subject).toBe("Pottery Basics");
    expect(matchesCompletion("Register for Pottery Basics", completion)).toBe(true);
    expect(matchesCompletion("Register for Photography Workshop", completion)).toBe(false);
    expect(verifiedCompletion("Register for Photography Workshop", [{ action: { type: "click", target: "register" }, result: { ok: true, changed: true, message: "Registered", completion }, at: 1 }])).toBe(false);
  });
  it("does not attach a generic receipt to the wrong named control or an unrelated destination", () => {
    expect(freshCompletion(pendingCompletion("Register for Pottery Basics", "Register for Photography Workshop", page()), page("Registration confirmed"))).toBeUndefined();
    const pending = pendingCompletion("Register for Pottery Basics", "Register", page(), "https://registration.example.com/pottery");
    expect(freshCompletion(pending, page("Registration confirmed", "https://unrelated.example.net/thanks"))).toBeUndefined();
    expect(freshCompletion(pending, page("Registration confirmed", "https://registration.example.com/receipt"))).toMatchObject({ destination: "https://registration.example.com/pottery" });
  });
  it("preserves bounded subject/action/destination receipts through the model history parser", () => {
    const pending = pendingCompletion("Register for Pottery Basics", "Register", page(), "https://example.com/register");
    const completion = freshCompletion(pending, page("Registration confirmed"));
    const input = { requestId: "proof", goal: "Register for Pottery Basics", message: "Continue", mode: "browse", page: page("Registration confirmed"),
      history: [{ action: { type: "click", target: "register" }, result: { ok: true, changed: true, message: "Registered", completion, pendingCompletion: pending }, at: 1 }] };
    expect(parseAgentRequest(input)?.history[0].result).toMatchObject({ completion, pendingCompletion: pending });
    expect(parseAgentRequest({ ...input, history: [{ ...input.history[0], result: { ...input.history[0].result, completion: { ...completion, subject: "x".repeat(201) } } }] })).toBeNull();
  });
});
describe("requested completion boundaries", () => {
  it("does not require booking proof for flight research that explicitly forbids booking", () => {
    expect(completionKind("Find roundtrip flights and show me the options. Don't book anything.")).toBeUndefined();
    expect(verifiedCompletion("Compare flights; do not book or pay", [])).toBe(true);
    expect(completionKind("Compare two options and stop before checkout")).toBeUndefined();
  });
  it("still requires proof for a positive commitment alongside a different prohibited action", () => {
    expect(completionKind("Book the chosen flight, but do not pay for extras")).toBe("booking");
    expect(verifiedCompletion("Book the chosen flight, but do not pay for extras", [])).toBe(false);
    expect(completionKind("Do not send the draft yet; then publish the approved page")).toBe("publication");
  });
  it.each([
    ["Do not book Rome; reserve Paris", "booking", "Paris", "Reserve Paris", "Reservation confirmed for Paris", "Reservation confirmed for Rome"],
    ['Do not book "Rome"; reserve "Paris"', "booking", "Paris", "Reserve Paris", "Reservation confirmed for Paris", "Reservation confirmed for Rome"],
    ["Do not delete the old draft; publish the approved page", "publication", "the approved page", "Publish", "Published: approved page", "Published: old draft"],
    ["Book Paris, but do not pay for extras", "booking", "Paris", "Book Paris", "Reservation confirmed for Paris", "Reservation confirmed for Rome"],
  ])("binds and verifies the positive subject in %s", (goal, kind, subject, control, notice, wrongNotice) => {
    expect(completionKind(goal)).toBe(kind);
    expect(completionSubject(goal)).toBe(subject);
    const pending = pendingCompletion(goal, control, page());
    expect(pending).toMatchObject({ kind, subject });
    expect(freshCompletion(pending, page(wrongNotice))).toBeUndefined();
    const completion = freshCompletion(pending, page(notice));
    expect(completion).toMatchObject({ kind, subject, evidence: notice });
    expect(verifiedCompletion(goal, [{ action: { type: "click", target: "commit" }, result: { ok: true, changed: true, message: notice, completion }, at: 1 }])).toBe(true);
  });
});
