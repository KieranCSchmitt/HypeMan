# Demo walkthrough

Start with [README setup](../README.md) and `npm run demo`. The extension connects automatically. Every listing, attendee, registration, and scripted provider response below is demonstration data. There are no real charges or bookings.

## Flagship: beginner workshop under $75

1. Open the rooftop New Tab page. Enter:

   > Find a beginner workshop under $75, compare two options, prepare registration, and request confirmation before submission. Wait for me between milestones.

2. Include `http://127.0.0.1:8787/demo/workshops/` in that same prompt, then press Enter or the arrow icon. Pasted links need no separate field.
3. HypeMan saves a three-step project: compare the options, prepare registration, then review and confirm it. It shows the first milestone and waits for you. A simple question or one-off action does not create a project.
4. Send “Help me compare the two workshop options.” HypeMan reads and saves the comparison: Pottery Basics is $60 and Printmaking for Everyone is $70. The visible comparison completes the first milestone; the next step appears in chat.
5. Send “Help me prepare the Pottery Basics registration.” HypeMan opens the chosen workshop, saves its source, and fills fictional attendee **Alex Morgan**, **alex@example.com**. It stops for review. The prepared fields complete the second milestone without submitting the form.
6. Send “Submit the prepared registration after asking for confirmation.” At **Submit registration**, the companion opens a confirmation dialog. The page remains unsubmitted. Choose **Cancel action** to demonstrate that nothing is sent.
7. Send “Prepare registration and request confirmation before submitting.” Review the new dialog, then choose **Yes, continue**. **Registration confirmed** on the page completes the final milestone. A successful click or a final assistant reply alone cannot complete the project.
8. Open the checklist icon and the bookmark icon for projects and notes. Expand **Completed actions** inside the project tools. Inspect the three milestone quotes and source excerpts. Edit a note and use **Export workspace** to download local JSON.

This walkthrough explicitly waits between milestones. Omit that instruction to start browser work after planning and continue automatically after verified progress. You can also do a milestone yourself: HypeMan checks visible page progress and advances only the current step. If completion is not visible, say **done step 1** (using the current number) or use the check icon to confirm it. On another website, open the checklist icon and choose **Continue project here** to move observation there without replaying actions.

For persistence, start a new project with multiple concrete steps, pause it, then close and reopen Chrome with the same profile. The rooftop shows **Continue project**; work resumes after choosing it. Only one project runs at a time.

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

The pixel companion opens a compact icon dock. Hover an icon for its label, or use keyboard focus. The bookmark opens notes; the plus opens additional tools. Video controls appear directly when a video is on the page. The rooftop prompt defaults to **Ask HypeMan**; use its chat or search icon for **Quick answer** or web search. Project progress is available from the checklist icon. The arrow sends a message; while working it becomes Stop. There are no speech controls.

## Live ChatGPT connection

Set `DEMO_MODE=0`, run `npm start`, and choose **Continue with ChatGPT** in regular Google Chrome. HypeMan connects to the local server automatically. Approve ChatGPT plan usage in the browser. The setup page shows **ChatGPT connected** and reveals **Let’s go**. On a benign workshop page, ask “Summarize this page” and “Highlight Compare workshops.” Verify source facts and targets. Stop cancels inference. Sign out and verify AI requests ask you to sign in again without trying a different provider.

Drawing and notebook images use this same ChatGPT connection. No local-model installation or provider API key is required. Image support depends on the selected account model; unsupported attachments produce an explicit error.

## Automated deterministic checks

```sh
npm run check
npm run e2e:install
npm run e2e:ui
npm run e2e:hints
npm run e2e:projects
npm run e2e:execution
npm run e2e
```

The focused `e2e:ui` suite checks the single input, icon keyboard controls, inline notes/tasks/settings, and interactive wallpaper. `e2e:hints` checks prepared hints and selection explanations. `e2e:projects` checks one-off chat, collaborative milestones, current-step confirmation, stale/cancelled assessments, website ownership, and restart recovery. `e2e:execution` verifies that one laptop request opens three source tabs, compares their observed facts, and continues configuration with the saved sources intact. The full browser suite starts its own demo gateway on a temporary port with an isolated Chrome profile. It verifies the collaborative workshop workflow, pending registration, confirmation, durable notes/completion, paused-page silence, specialist fixtures, and explicit restart continuation. Screenshots go to `tests/screenshots/`. No provider credentials are required.

## Credential-dependent live checks

These are separate from the deterministic suite. Set `DEMO_MODE=0`, restart with `npm start`, sign in with ChatGPT, and inspect onboarding connection status first.

- **ChatGPT:** compare two benign real page sources. Check saved excerpts, stale-page handling, cancellation, and final confirmation. An unavailable model must produce a visible failure.
- **ChatGPT vision:** test readable, blank, covered, and ambiguous writing in Drawing and Notebook. Uncertainty stays visible; previous writing cannot be invented as current content.
- **Transcript service:** test a supported URL, an unavailable transcript, and native captions. Missing captions must never become a claimed live summary.
- **Optional context/input:** enable the capability being tested, grant its Chrome permission if requested, then verify disabling it takes effect immediately.

Live credentials and recognition quality are not tested by the no-key demo. Use benign test pages and sample personal data for exploratory runs.
