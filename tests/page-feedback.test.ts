// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageObserver } from "../apps/extension/src/runtime/page";

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("page feedback recognition", () => {
  it("preserves semantic task notices and rejects negative success wording", () => {
    document.body.innerHTML = `
      <p role="alert">Registration not complete</p>
      <p role="status">Not quite. Check your sign.</p>
      <p aria-live="polite">Registration confirmed</p>
      <p role="status">Incorrect. Try again.</p>`;
    const page = new PageObserver().snapshot();
    expect(page.errors).toEqual([
      "Registration not complete",
      "Not quite. Check your sign.",
      "Incorrect. Try again.",
    ]);
    expect(page.successes).toEqual(["Registration confirmed"]);
  });

  it("recognizes short ordinary quiz results without duplicate inline fragments", () => {
    document.body.innerHTML = `
      <h1>Solve 2x + 4 = 10</h1><input aria-label="Answer" value="4">
      <div class="answer-result"><span>Try Again</span></div>
      <p><strong>Incorrect.</strong> Check the subtraction.</p>
      <div>Not quite! Try the first step again.</div>
      <span>Correct!</span><output>That's right.</output>`;
    const page = new PageObserver().snapshot();
    expect(page.errors).toEqual([
      "Try Again",
      "Incorrect. Check the subtraction.",
      "Not quite! Try the first step again.",
    ]);
    expect(page.successes).toEqual(["Correct!", "That's right."]);
  });

  it("ignores controls, quotes, lesson prose, and large unrelated paragraphs", () => {
    document.body.innerHTML = `
      <button>Try Again</button><div role="button"><span>Incorrect</span></div>
      <nav><span>Correct!</span></nav><ul role="menu"><li>Try again</li></ul>
      <a href="/retry">Try Again</a>
      <p>Choose the button marked <span>Try Again</span> to start a new practice.</p>
      <div>What does the message <span>Incorrect</span> mean?</div>
      <blockquote><p>Incorrect. Try again.</p></blockquote>
      <q>Correct!</q><pre><span>Try Again</span></pre>
      <p>Incorrect answers are useful for learning. ${"This is explanatory lesson text. ".repeat(15)}</p>
      <p>Incorrect answers are useful for learning.</p><p>Correct answers are shown in green.</p>
      <p>Not quite clear which answer applies? Read this lesson.</p>
      <p>The correct response is a useful example, rather than a quiz result.</p>`;
    const page = new PageObserver().snapshot();
    expect(page.errors).toEqual([]);
    expect(page.successes).toEqual([]);
  });

  it("ignores hidden, private, editable, and companion-owned feedback", () => {
    document.body.innerHTML = `
      <div hidden><p>Try Again</p></div>
      <div aria-hidden="true"><span>Incorrect</span></div>
      <div style="display:none"><p role="alert">Incorrect</p></div>
      <div style="opacity:0"><p>Not quite</p></div>
      <p data-private>Incorrect</p><div contenteditable="true">Try Again</div>
      <script type="text/plain">Incorrect</script><style>/* Try Again */</style>
      <p aria-live="off">Correct!</p><textarea>Try Again</textarea>`;
    const host = document.createElement("div");
    host.innerHTML = '<p role="alert">Incorrect</p><p>Correct!</p>';
    document.body.append(host);
    const page = new PageObserver(document, host).snapshot();
    expect(page.errors).toEqual([]);
    expect(page.successes).toEqual([]);
  });

  it("redacts private and actionable descendants from semantic notices", () => {
    document.body.innerHTML = `
      <div role="alert">Invalid code.<span data-private>123456</span>
        <input type="password" value="secret"><button>Try Again</button></div>`;
    const page = new PageObserver().snapshot();
    expect(page.errors).toEqual(["Invalid code."]);
    expect(page.errors.join(" ")).not.toMatch(/123456|secret|Try Again/);
  });
});

describe("initial and live page observation", () => {
  it("schedules the already visible page once and cancels pending work on stop", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<p>Try Again</p>";
    const observer = new PageObserver();
    const listener = vi.fn(() => observer.snapshot());
    observer.watch(listener);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.results[0].value.errors).toEqual(["Try Again"]);
    observer.stop();
    observer.watch(listener);
    observer.stop();
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("observes CSS visibility changes while ignoring the companion's mutations", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<p id="result" style="display:none">Not quite</p><div id="pet"></div>';
    const host = document.getElementById("pet")!;
    const observer = new PageObserver(document, host);
    const listener = vi.fn(() => observer.snapshot());
    observer.watch(listener);
    vi.advanceTimersByTime(250);
    host.innerHTML = "<p>Try Again</p>";
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledTimes(1);
    document.getElementById("result")!.removeAttribute("style");
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.results[1].value.errors).toEqual(["Not quite"]);
    observer.stop();
  });
});
