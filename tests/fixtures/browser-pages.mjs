import { readFile } from "node:fs/promises";

// Small, unstyled DOM inputs for automated browser tests. They are only installed
// through Playwright interception and are never served by the application gateway.
const document = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const captions = "WEBVTT\n\n00:00.000 --> 00:03.000\nAn equation is a balance between two expressions.\n\n00:03.000 --> 00:06.000\nApply the same operation to both sides to preserve equality.\n\n00:06.000 --> 00:10.000\nExplain the reasoning yourself.\n";
const options = '<h2>Pottery Basics</h2><p>$60 total · Beginner · Saturday 10 am–12 pm. Materials and firing included.</p><h2>Printmaking for Everyone</h2><p>$70 total · Beginner · Saturday 2–4 pm. All supplies included.</p>';
const registration = '<h1>Register for Pottery Basics</h1><p>Sample attendee: Alex Morgan · alex@example.com</p><form id="registration"><label>Full name<input name="fullName" autocomplete="name" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label><button type="submit">Submit registration</button></form><section id="registration-success" role="status" hidden><h2>Registration confirmed</h2><p>Your fictional place is reserved. No real charge was made.</p></section><script>document.querySelector("form").onsubmit=event=>{event.preventDefault();event.currentTarget.hidden=true;document.querySelector("#registration-success").hidden=false}</script>';
const pages = {
  "/__test/workshops/": document("Workshop test", `<h1>Beginner workshops</h1>${options}<a href="compare.html">Compare workshops</a>`),
  "/__test/workshops/compare.html": document("Comparison test", `<h1>Workshop comparison</h1>${options}<p>Both are under $75. Pottery costs $10 less; printmaking starts later.</p><a href="pottery.html">Choose Pottery Basics</a><a href="printmaking.html">View Printmaking for Everyone</a>`),
  "/__test/workshops/pottery.html": document("Workshop detail test", '<h1>Pottery Basics</h1><p>$60 total · Beginner · Saturday 10 am–12 pm. Materials and firing included.</p><a href="register.html">Register for Pottery Basics</a>'),
  "/__test/workshops/printmaking.html": document("Workshop detail test", '<h1>Printmaking for Everyone</h1><p>$70 total · Beginner · Saturday 2–4 pm. Supplies included.</p><a href="compare.html">Back to comparison</a>'),
  "/__test/workshops/register.html": document("Registration test", registration),
  "/__test/learning/": document("Equation test", '<h1>Keep both sides in balance.</h1><p>Apply the same operation to each side of an equation to keep equality true.</p><h2>Try: 3x + 6 = 18</h2><label>Your reasoning<textarea id="reasoning"></textarea></label><label>Value of x<input id="answer"></label><button id="check">Check answer</button><p id="feedback" role="status"></p><script>document.querySelector("#check").onclick=()=>{document.querySelector("#feedback").textContent=document.querySelector("#answer").value.trim()==="4"?"Correct: x = 4. Explain why both operations preserve equality.":"Try again: subtract 6 from each side, then divide by 3."}</script>'),
  "/__test/guide/": document("Document isolation test", "<h1>Untrusted webpage</h1><p>This page has no document-reader authorization.</p>"),
  "/__test/video/": document("Captioned video test", '<h1>Captioned lesson</h1><video controls preload="auto" src="/__test/video.webm"><track kind="captions" src="/__test/captions.vtt" srclang="en" label="English" default></video>'),
  "/__test/video/uncaptioned.html": document("Uncaptioned video test", '<h1>Video without captions</h1><video controls preload="auto" src="/__test/video.webm"></video>'),
};

export async function installBrowserFixtures(context) {
  const video = await readFile(new URL("./video.webm", import.meta.url));
  await context.route("**/__test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/__test/captions.vtt") return route.fulfill({ contentType: "text/vtt", body: captions });
    if (path === "/__test/video.webm") {
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || "");
      if (range) {
        const start = Number(range[1]), end = Math.min(Number(range[2] || video.length - 1), video.length - 1);
        if (start > end) return route.fulfill({ status: 416, headers: { "content-range": `bytes */${video.length}` } });
        return route.fulfill({ status: 206, contentType: "video/webm", headers: { "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${video.length}` }, body: video.subarray(start, end + 1) });
      }
      return route.fulfill({ contentType: "video/webm", headers: { "accept-ranges": "bytes" }, body: video });
    }
    return route.fulfill({ status: pages[path] ? 200 : 404, contentType: "text/html", body: pages[path] || document("Missing test input", "<h1>Not found</h1>") });
  });
}
