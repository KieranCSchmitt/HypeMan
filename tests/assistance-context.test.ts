// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPracticeContext, getSelectionContext } from "../apps/extension/src/runtime/assistance-context";
import { PageObserver } from "../apps/extension/src/runtime/page";

const page = () => new PageObserver().snapshot();
const practice = (host?: Element) => getPracticeContext(document, host, page());
const selectedContext = (host?: Element) => getSelectionContext(document, host, page());
function select(selector: string, text?: string) {
  const element = document.querySelector(selector)!;
  const range = document.createRange();
  if (text) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = node.textContent?.indexOf(text) ?? -1;
      if (offset < 0) continue;
      range.setStart(node, offset);
      range.setEnd(node, offset + text.length);
      break;
    }
  } else range.selectNodeContents(element);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
  document.title = "Practice and reading";
  history.replaceState(null, "", "/");
});

describe("speculative practice context", () => {
  it("grounds an inline MathPapa-style equation before feedback and never includes typed answers", () => {
    document.body.innerHTML = `<main><h1>Division practice</h1>
      <div>24 ÷ <input aria-label="Answer" id="answer"> = 3
        <button>Try it</button><p id="feedback"></p><time id="clock">12:00</time></div></main>`;
    const before = practice()!;
    expect(before.page.text).toBe("24 ÷ [answer] = 3");
    expect(before.concept).toBe("Division practice");
    (document.getElementById("answer") as HTMLInputElement).value = "wrong-answer-secret";
    document.getElementById("answer")!.id = "replaced-target-id";
    document.getElementById("feedback")!.textContent = "Try Again";
    document.getElementById("clock")!.textContent = "12:01";
    const after = practice()!;
    expect(after.key).toBe(before.key);
    expect(after.page.text).toBe(before.page.text);
    expect(after.page.elements).toEqual([]);
    expect(after.page.errors).toEqual([]);
    expect(after.page.successes).toEqual([]);
    expect(JSON.stringify(after)).not.toContain("wrong-answer-secret");
    expect(JSON.stringify(after)).not.toContain("replaced-target-id");
  });

  it("finds the dedicated prompt just outside its form and ignores later unrelated changes", () => {
    document.body.innerHTML = `<main><h1>Division practice</h1>
      <p id="question">72 divided by what number equals 9?</p>
      <form><label>Answer <input id="answer"></label><button>Check answer</button></form>
      <p id="feedback"></p><p id="unrelated">Practice at your own pace.</p></main>`;
    const first = practice()!;
    expect(first.page.text).toBe("72 divided by what number equals 9?");
    document.getElementById("feedback")!.textContent = "Incorrect. Check your work.";
    document.getElementById("unrelated")!.append(" · 1234");
    expect(practice()!.key).toBe(first.key);
  });

  it("invalidates question or heading changes and separates pages", () => {
    document.body.innerHTML = `<main><h1>Algebra practice</h1><p>Find x: 3x + 5 = 20.</p>
      <form><input aria-label="Your answer"><button>Check answer</button></form></main>`;
    const first = practice()!.key;
    document.querySelector("p")!.textContent = "Find x: 3x + 5 = 29.";
    const second = practice()!.key;
    expect(second).not.toBe(first);
    document.querySelector("h1")!.textContent = "A new algebra question";
    const third = practice()!.key;
    expect(third).not.toBe(second);
    history.replaceState(null, "", "/another-question");
    expect(practice()!.key).not.toBe(third);
  });

  it("supports non-math questions with an explicit answer field", () => {
    document.body.innerHTML = `<main><h1>Biology</h1><p>What organelle converts sunlight into chemical energy?</p>
      <form><input aria-label="Answer"><button>Check</button></form></main>`;
    expect(practice()!.page.text).toBe("What organelle converts sunlight into chemical energy?");
  });

  it("recognizes a simple quiz prompt directly in the body without reading the whole body", () => {
    document.body.innerHTML = '<h1>Quiz</h1><p>Solve 3x = 12.</p><input aria-label="Answer"><aside>Unrelated prose.</aside>';
    expect(practice()!.page.text).toBe("Solve 3x = 12.");
  });

  it("ignores feedback inserted as a separate text node in the equation container", () => {
    document.body.innerHTML = '<main><h1>Quiz</h1><div>24 ÷ <input aria-label="Answer"> = 3</div></main>';
    const first = practice()!.key;
    document.querySelector("main div")!.append(document.createTextNode("Try Again"));
    expect(practice()!.key).toBe(first);
  });

  it("does not preload an article, search, sign-in, contact, or shipping form", () => {
    document.body.innerHTML = `<main><h1>What is cellular respiration?</h1><p>Learn about the process.</p>
      <form role="search"><input aria-label="Search articles"></form>
      <form><label>Username<input></label><label>Password<input type="password"></label></form>
      <form><label>Your full name<input></label><input type="email" aria-label="Email"></form>
      <form><label>Shipping address<input></label></form></main>`;
    expect(practice()).toBeNull();
    document.body.innerHTML = `<main><h1>Contact us</h1><p>How can we help you today?</p>
      <form><input aria-label="Message"></form></main>`;
    expect(practice()).toBeNull();
  });

  it("does not infer a question merely from a label, article heading, or feedback", () => {
    document.body.innerHTML = `<main><h1>Practice</h1><input aria-label="Answer">
      <p role="alert">Incorrect. Try solving again.</p></main>`;
    expect(practice()).toBeNull();
  });

  it("rejects hidden, private, disabled, readonly, and companion-owned fields", () => {
    for (const attribute of ["hidden", 'style="display:none"', 'style="opacity:0"', "data-private"]) {
      document.body.innerHTML = `<main ${attribute}><h1>Quiz</h1><p>Solve 2x = 8.</p><input aria-label="Answer"></main>`;
      expect(practice(), attribute).toBeNull();
    }
    for (const attribute of ["disabled", "readonly", 'autocomplete="one-time-code"', 'aria-label="Verification code"']) {
      document.body.innerHTML = `<main><h1>Quiz</h1><p>Solve 2x = 8.</p><input ${attribute}></main>`;
      expect(practice(), attribute).toBeNull();
    }
    document.body.innerHTML = `<aside id="pet"><h1>Quiz</h1><p>Solve 2x = 8.</p><input aria-label="Answer"></aside>`;
    expect(practice(document.getElementById("pet")!)).toBeNull();
  });

  it("keeps adjacent private text, result messages, and source snapshot secrets out of the payload", () => {
    document.body.innerHTML = `<main><h1>Quiz</h1><div>Solve 2x = 8.
      <span data-private>private-note-123</span><input aria-label="Answer" value="999">
      <p role="status">Correct!</p><span class="clock">14:22</span></div></main>`;
    const source = page();
    source.text += "\nOther source text that must not be sent.";
    source.selection = "Unrelated selection";
    source.video = { id: "video", title: "Unrelated video", time: 0, duration: 10, paused: true, rate: 1 };
    const context = getPracticeContext(document, undefined, source)!;
    expect(context.page.text).toBe("Solve 2x = 8. [answer]");
    expect(context.page.selection).toBe("");
    expect(context.page.video).toBeUndefined();
    expect(JSON.stringify(context)).not.toMatch(/private-note|999|14:22|Correct|Other source|Unrelated/);
  });
});

describe("selected reading context", () => {
  it("explains a selected term using only nearby source text and relevant headings", () => {
    document.title = "Neurology — encyclopedia";
    document.body.innerHTML = `<h1>Neurology</h1><h2>Cells</h2><article>
      <p>The dendrites receive signals from other neurons through synapses.</p></article>
      <aside>Unrelated distant text and controls <input value="private-value"></aside>`;
    select("p", "dendrites");
    const context = selectedContext()!;
    expect(context.selected).toBe("dendrites");
    expect(context.concept).toBe("Cells");
    expect(context.page.title).toBe("Neurology — encyclopedia");
    expect(context.page.headings).toEqual(["Neurology", "Cells"]);
    expect(context.page.text).toBe("The dendrites receive signals from other neurons through synapses.");
    expect(context.page.selection).toBe("dendrites");
    expect(context.page.elements).toEqual([]);
    expect(JSON.stringify(context)).not.toMatch(/Unrelated|private-value/);
  });

  it("bounds a long paragraph around the selected phrase and never sends the entire page", () => {
    document.body.innerHTML = `<h1>Reading</h1><article><p>${"Earlier sentence. ".repeat(150)}
      <span>neuroplasticity</span> describes the brain's ability to adapt. ${"Later sentence. ".repeat(150)}</p>
      <p>Distant secret unrelated paragraph.</p></article>`;
    select("span", "neuroplasticity");
    const context = selectedContext()!;
    expect(context.page.text.length).toBeLessThanOrEqual(1200);
    expect(context.page.text).toContain("neuroplasticity");
    expect(context.page.text).toContain("brain's ability to adapt");
    expect(context.page.text).not.toContain("Distant secret");
  });

  it("keys the surrounding meaning as well as the selected word", () => {
    document.body.innerHTML = `<h1>Words</h1><p id="river">A river bank holds sediment.</p>
      <p id="money">A bank stores money.</p>`;
    select("#river", "bank");
    const river = selectedContext()!.key;
    select("#money", "bank");
    expect(selectedContext()!.key).not.toBe(river);
    select("#river", "bank");
    expect(selectedContext()!.key).toBe(river);
  });

  it("accepts ordinary linked article terms without requiring learning forms", () => {
    document.body.innerHTML = '<article><p>A <a href="/dendrite">dendrite</a> receives signals.</p></article>';
    select("a", "dendrite");
    expect(selectedContext()!.selected).toBe("dendrite");
    expect(practice()).toBeNull();
  });

  it("rejects absent, collapsed, single-character, and oversized selections", () => {
    document.body.innerHTML = `<p id="short">x</p><p id="long">${"a".repeat(601)}</p>`;
    expect(selectedContext()).toBeNull();
    select("#short");
    expect(selectedContext()).toBeNull();
    select("#long");
    expect(selectedContext()).toBeNull();
    document.getSelection()!.collapseToStart();
    expect(selectedContext()).toBeNull();
  });

  it("rejects selections in private, editable, hidden, password-label, and companion text", () => {
    for (const attribute of ["data-private", "contenteditable", 'role="textbox"', "hidden", 'style="display:none"']) {
      document.body.innerHTML = `<p ${attribute}>private content</p>`;
      select("p");
      expect(selectedContext(), attribute).toBeNull();
    }
    document.body.innerHTML = '<label for="secret">Private password details</label><input id="secret" type="password">';
    select("label");
    expect(selectedContext()).toBeNull();
    document.body.innerHTML = '<aside id="pet"><p>HypeMan assistant reply</p></aside>';
    select("p");
    expect(selectedContext(document.getElementById("pet")!)).toBeNull();
  });

  it("rejects a range crossing private or editable content even with safe endpoints", () => {
    for (const attribute of ["data-private", "contenteditable"]) {
      document.body.innerHTML = `<p>Safe start <span ${attribute}>secret middle</span> safe end</p>`;
      select("p");
      expect(selectedContext(), attribute).toBeNull();
    }
  });

  it("does not use a stale snapshot selection when the live selection is gone", () => {
    document.body.innerHTML = "<p>ordinary article text</p>";
    const source = page();
    source.selection = "private stale text";
    expect(getSelectionContext(document, undefined, source)).toBeNull();
  });

  it("rejects actual ranges belonging to another document or a shadow tree", () => {
    const otherDocument = document.implementation.createHTMLDocument("Other frame");
    otherDocument.body.innerHTML = "<p>Cross document content</p>";
    const foreign = otherDocument.createRange();
    foreign.selectNodeContents(otherDocument.querySelector("p")!);
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>Shadow tree content</p>";
    const shadowRange = document.createRange();
    shadowRange.selectNodeContents(shadow.querySelector("p")!);
    const source = page();
    for (const range of [foreign, shadowRange]) {
      const spy = vi.spyOn(document, "getSelection").mockReturnValue({
        isCollapsed: false,
        rangeCount: 1,
        toString: () => range.toString(),
        getRangeAt: () => range,
      } as unknown as Selection);
      try {
        expect(getSelectionContext(document, undefined, source)).toBeNull();
      } finally { spy.mockRestore(); }
    }
  });
});
