# Development fixtures and verification

Everyday use starts with the little HypeMan avatar on an ordinary webpage; a new tab is a quiet rooftop. Follow [README setup](../README.md) for that flow. The local gateway root is an inert connection-status page.

This document describes development checks. `npm run demo` starts a deterministic fixture gateway, and the explicit `/demo/*` pages are inputs for isolated automated browser tests. They are not a playground, homepage, or feature menu. Listings, registrations, and provider responses are fictional; there are no real charges or bookings.

## Conversation and content

On the webpage you are working with, activate the little avatar or Chrome toolbar to open the compact pixel conversation. The new-tab rooftop starts without a composer or tool tray. Enter sends; Shift+Enter adds a line. Ask to open tools; highlight, draw, edit, select, or drop content directly. Tools float independently over the page and keep chat in place. Drag a title bar, resize any edge or corner, or use the minimize/maximize controls. Open notes and the whiteboard together, then close either without losing its work or pausing a project. Escape stops an active request, then dismisses the focused tool before chat.

1. Ask **open whiteboard**, then **draw a diagram explaining how to balance an equation**. Assistant content and your ink share the same scene. Double-click equations to edit their source, drag objects, use Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, or ask **undo**. Ask **export this board** for a combined PNG.
2. Drop a PDF onto chat, or activate its contextual file picker. Highlight a passage and ask about it. Ask **show page 2**, **summarize this PDF**, or **inspect scanned page 3**. Follow a citation to its saved page. Ask for a whiteboard explanation of the passage. Original files up to 25 MiB stay in extension-owned storage; password entry stays local. Ask **export this PDF** to download the original.
3. Say **save this** after selecting content, or **remember: a useful explanation**. Say **open notes** or **find my notes about equations**. Edit text directly; edits autosave. Select a note and ask to delete it, then say **undo**.
4. Ask **show saved work** to reopen a conversation and its artifacts. **New chat** starts another conversation. **Export workspace** downloads saved conversations, artifacts, notes, projects, and PDF metadata as JSON; original PDFs export separately.
5. Ask **preferences**, change values directly, or say **reduce motion**. Contextual browser permission controls appear only when needed. Ask **sign in**, **use model …**, **switch to account …**, or **reconnect** for connection recovery.

## Browser fixture: beginner workshop under $75

1. The browser test explicitly visits the workshop fixture, opens the avatar conversation, and sends:

   > At http://127.0.0.1:8787/demo/workshops/ find a beginner workshop under $75, compare two options, prepare registration, and request confirmation before submission. Wait for me between milestones.

2. HypeMan saves three meaningful milestones and opens the relevant browser page. A simple question or one-off action does not create a project.
3. Send **Help me compare the two workshop options.** HypeMan saves source findings: Pottery Basics is $60 and Printmaking for Everyone is $70. Visible comparison evidence completes the first milestone.
4. Send **Help me prepare the Pottery Basics registration.** HypeMan saves its source and fills fictional attendee Alex Morgan, alex@example.com. It stops for review; nothing is submitted.
5. Send **Submit the prepared registration after asking for confirmation.** Choose **Cancel action** to show that nothing is sent. Ask again and choose **Yes, continue**. Only visible confirmation completes the final milestone.
6. Ask **show projects**, **open notes**, and **show action history**. Select content to inspect or discuss it; note source links remain directly usable. Ask **export workspace** to download saved records.

Omit the wait instruction to continue browser work automatically after planning and verified progress. You can complete a milestone yourself; HypeMan verifies the current visible outcome. If verification is unavailable, explicitly confirm the current step. To continue on another website, ask **show projects**, select the project, then **continue this project here**. After restart, projects remain paused until explicitly continued.

## Other fixture coverage

| Demonstration | Conversation and content interaction | Expected result |
| --- | --- | --- |
| Site pause | On a webpage, say **pause HypeMan on this site**. On another webpage say **resume HypeMan on example.com**. | Observation and browser actions stop for paused hosts. Local PDFs remain usable. |
| Learning | Say **enable learning mode**, visit `/demo/learning/`, and ask for a plan, hint, or teach-back check. | Graduated help and evidence from actual practice. Demo feedback does not establish mastery. |
| Video | Visit `/demo/video/`; say **pause video**, **rewind 5 seconds**, or **summarize this video**. Click chapters/transcript passages to seek. Drop VTT/SRT or edit supplied captions directly. | Original playback, caption analysis, timestamped notes, and native media controls. Hidden local players pause. |
| Missing captions | Visit `/demo/video/uncaptioned.html` and ask for a summary in live mode without a transcript service. | Caption availability is explicit; unheard narration is never quoted. |
| Images | Paste/drop an image; on a webpage ask **capture a screen region**, grant access if required, then drag over the region. | An explicit image preview is used with the next question. Screenshots remain transient. |
| Phone | Say **pair my phone +14155551234**, complete the phone reply, then select a note and **text this to me**. Ask **open phone inbox**, select a capture, and **continue this capture in Chrome**. | Pairing, status, check-ins, reminders, inbox and unpairing remain available. Incoming texts never launch browser work. |
| Recovery | Stop an active request, close a tool, disconnect the gateway, or sign out. | Cancelled responses cannot reopen content; failed drafts remain editable. Local commands and saved work remain available. |

The test harness prefixes relative fixture URLs with its isolated local gateway address. A default local fixture server uses `http://127.0.0.1:8787`. Chrome shortcuts can be configured at `chrome://extensions/shortcuts`.

## Live checks

Set `DEMO_MODE=0`, run `npm start`, ask **sign in**, and use the contextual **Continue with ChatGPT** consent control in regular Chrome. Verify source facts, model/account switching, cancellation, and signed-out recovery. Test readable, blank, scanned, encrypted and ambiguous PDFs. Only requested scanned pages are sent as images, and inferred readings are identified. Drawing review asks evidence-linked questions rather than claiming a corrected solution.

Live credentials, model recognition quality, and Photon delivery require separate account-dependent checks. The deterministic suites use isolated profiles and labeled fixtures; they never fall back from a failed live request to fabricated reasoning.

## Automated checks

```sh
npm run check
npm run e2e:install
npm run e2e:ui
npm run e2e:pdf
npm run e2e:hints
npm run e2e:projects
npm run e2e:execution
npm run e2e:auth
npm run e2e:messaging
npm run e2e
```

`e2e:ui` audits controls and exercises shared board equations/ink/export, PDF passages/citations, notes autosave, and conversation continuation. `e2e:pdf` checks exact local originals, encrypted-file recovery, worker compatibility, export and frame authorization. Other suites retain hint privacy, milestone evidence, browser ownership, consequential confirmations, source handoff, mocked OAuth/accounts/models, and phone delivery/continuation checks. Screenshots go to `tests/screenshots/`.
