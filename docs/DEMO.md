# Demo walkthrough

Start with [README setup](../README.md) and `npm run demo`. The extension connects automatically. Every listing, attendee, registration, and scripted provider response below is demonstration data. There are no real charges or bookings.

## Flagship: beginner workshop under $75

1. Open the rooftop New Tab page. Enter:

   > Find a beginner workshop under $75, compare two options, prepare registration, and request confirmation before submission.

2. Include `http://127.0.0.1:8787/demo/workshops/` in that same prompt, then press Enter or the arrow icon. Pasted links need no separate field.
3. HypeMan reads the comparison: Pottery Basics is $60 and Printmaking for Everyone is $70. Both are beginner sessions with supplies included. It saves sources, opens Pottery Basics, and prepares fictional attendee **Alex Morgan**, **alex@example.com**.
4. At **Submit registration**, the companion opens a confirmation dialog. The page must still be unsubmitted. Choose **Cancel action** to show that it does not submit.
5. Send “Prepare registration and request confirmation before submitting.” Review the new dialog, then choose **Yes, continue**. The page displays **Registration confirmed**. The task completes from that visible result.
6. Open **Tasks** and **Notes**. Expand **Completed actions** inside Tasks. Inspect completion and source excerpts. Edit a note and use **Export workspace** to download local JSON.

For persistence, start a new task, pause it, then close and reopen Chrome with the same profile. The rooftop shows **Continue task**; work resumes after choosing it. Starting another task pauses the current task.

## Separate demonstrations

| Demonstration    | Steps                                                                                                                                                                                  | Expected result                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Site pause       | Open the extension popup on a demo page and choose **Pause HypeMan on this site**. Attempt a page request and reload.                                                                  | No page analysis or action is sent. Re-enable the hostname to continue.                                                                        |
| Learning         | Enable **Learning mode** from the companion’s More → Preferences. Visit `/demo/learning/`. Ask for a learning plan, a small hint, and an analogous sketch. Enter an answer and check it on the page.              | Optional plan, hint, sketch, and actual page-feedback evidence, separate from task notes.                                                      |
| Teach-back       | In Learning mode, send “I learned that applying the same operation to both sides preserves equality.” Review the card and request a check.                                             | Explanation recorded. Demo feedback is labeled and does not establish assessed mastery.                                                        |
| Video            | Visit `/demo/video/`; ask “Pause video,” “Rewind 5 seconds,” or “Summarize the captions.” Or open the Video overlay, load VTT/SRT or paste a transcript, and choose **Find the thread**. | Native controls and caption-backed notes/chapters. Demo analysis is labeled.                                                                   |
| Missing captions | In live mode without a transcript service, visit `/demo/video/uncaptioned.html` and request a summary.                                                                                 | Captions unavailable; controls still work. Demo mode may intentionally return a labeled fixture.                                               |
| Drawing          | Open **Whiteboard** over any webpage. Draw, Undo/Redo, open the sparkle coaching control, then save PNG.                                                                                                      | Local drawing works. Demo coaching clearly says demonstration feedback.                                                                        |
| Notebook         | Open **More → Paper camera**. Choose a photo, or Start camera and take a photo. Choose **Read handwriting**.                                                                    | Demo transcription is scripted. Stop, switching away, or closing stops the camera.                                                             |
| Customization    | Upload a simple PNG/JPEG/WebP in **Customize companion**. Adjust cutout/colors/size, name it, and choose **Save & use companion**. Reload.                                             | Character remains selected in the saved shelf. Provider palette suggestions are optional.                                                      |
| Accessibility    | Tab through controls, use Enter/Space, and set Motion to **Reduce motion**.                                                                                                            | Visible focus and immediate motion updates. Alt+Shift+P toggles the panel.                                                                     |
| Optional context | Enable screenshots or other-tab context in Settings. Choose **More → Capture this page**, then explicitly attach it to the next message. Ask “Show open tabs.”           | Capture previews stay local until attached; an attachment is sent once. Tab context contains titles/links, without page bodies or URL queries. |

Prefix relative demo URLs with `http://127.0.0.1:8787`. Chrome can reassign shortcuts; configure them at `chrome://extensions/shortcuts`.

The pixel companion opens a compact icon dock. Hover an icon for its label, or use keyboard focus. The bookmark opens notes; the plus opens additional tools. Video controls appear directly when a video is on the page. The rooftop prompt defaults to task mode; use its chat or search icon for Ask HypeMan or web search. Task progress is available from the checklist icon. The arrow sends a message; while working it becomes Stop. There are no speech controls.

## Live ChatGPT connection

Set `DEMO_MODE=0`, run `npm start`, and choose **Continue with ChatGPT** in regular Google Chrome. HypeMan connects to the local server automatically. Approve ChatGPT plan usage in the browser. The setup page shows **ChatGPT connected** and reveals **Let’s go**. On a benign workshop page, ask “Summarize this page” and “Highlight Compare workshops.” Verify source facts and targets. Stop cancels inference. Sign out and verify AI requests ask you to sign in again without trying a different provider.

Drawing and notebook images use this same ChatGPT connection. No local-model installation or provider API key is required. Image support depends on the selected account model; unsupported attachments produce an explicit error.

## Automated deterministic checks

```sh
npm run check
npm run e2e:install
npm run e2e:ui
npm run e2e
```

The focused `e2e:ui` suite checks the single input, icon keyboard controls, inline notes/tasks/settings, and interactive wallpaper. The full browser suite starts its own demo gateway on a temporary port with an isolated Chrome profile. It verifies pending registration, confirmation, durable notes/completion, paused-page silence, specialist fixtures, and explicit restart continuation. Screenshots go to `tests/screenshots/`. No provider credentials are required.

## Credential-dependent live checks

These are separate from the deterministic suite. Set `DEMO_MODE=0`, restart with `npm start`, sign in with ChatGPT, and inspect onboarding connection status first.

- **ChatGPT:** compare two benign real page sources. Check saved excerpts, stale-page handling, cancellation, and final confirmation. An unavailable model must produce a visible failure.
- **ChatGPT vision:** test readable, blank, covered, and ambiguous writing in Drawing and Notebook. Uncertainty stays visible; previous writing cannot be invented as current content.
- **Transcript service:** test a supported URL, an unavailable transcript, and native captions. Missing captions must never become a claimed live summary.
- **Optional context/input:** enable the capability being tested, grant its Chrome permission if requested, then verify disabling it takes effect immediately.

Live credentials and recognition quality are not tested by the no-key demo. Use benign test pages and sample personal data for exploratory runs.
