// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { freshCompletion, matchesCompletion, pendingCompletion } from "@core";
import { PageObserver } from "./page";

beforeEach(() => {
  document.body.innerHTML = `<h1>Register for Pottery Basics</h1><form id="registration"><label>Full name<input name="fullName"></label><button>Submit registration</button></form><section id="registration-success" role="status" hidden><h2>Registration confirmed</h2><p>Your fictional place is reserved. No real charge was made.</p></section>`;
});

function registeredPage() {
  const observer = new PageObserver();
  const before = observer.snapshot();
  document.querySelector<HTMLFormElement>("#registration")!.hidden = true;
  document.querySelector<HTMLElement>("#registration-success")!.hidden = false;
  return { before, after: observer.snapshot() };
}

describe("completion receipts from observed status sections", () => {
  it("keeps the exact multiline source span for the minimal registration status fixture", () => {
    const { before, after } = registeredPage();
    const notice = "Registration confirmed Your fictional place is reserved. No real charge was made.";
    expect(after.successes).toContain(notice);
    expect(after.text).not.toContain(notice);
    const pending = pendingCompletion("Register for Pottery Basics", "Submit registration", before);
    const completion = freshCompletion(pending, after);
    expect(completion?.evidence).toBe("Registration confirmed\nYour fictional place is reserved. No real charge was made.");
    expect(after.text).toContain(completion!.evidence);
    expect(matchesCompletion("Register for Pottery Basics", completion)).toBe(true);
  });

  it("rejects an existing notice and a notice whose words are absent from the source", () => {
    const { before, after } = registeredPage();
    expect(freshCompletion(pendingCompletion("Register for Pottery Basics", "Submit registration", after), after)).toBeUndefined();
    const pending = pendingCompletion("Register for Pottery Basics", "Submit registration", before);
    expect(freshCompletion(pending, { ...after, text: after.text.replace("reserved", "unavailable") })).toBeUndefined();
  });

  it("keeps named-subject checks intact when the exact evidence spans nodes", () => {
    const observer = new PageObserver();
    const before = observer.snapshot();
    const status = document.querySelector<HTMLElement>("#registration-success")!;
    status.innerHTML = "<h2>Registration confirmed</h2><p>for Photography Workshop</p>";
    status.hidden = false;
    const after = observer.snapshot();
    expect(freshCompletion(pendingCompletion("Register for Pottery Basics", "Submit registration", before), after)).toBeUndefined();
    const other = freshCompletion(pendingCompletion("Register for Photography Workshop", "Submit registration", before), after);
    expect(other?.evidence).toBe("Registration confirmed\nfor Photography Workshop");
    expect(matchesCompletion("Register for Pottery Basics", { ...other!, subject: "Pottery Basics" })).toBe(false);
  });
});
