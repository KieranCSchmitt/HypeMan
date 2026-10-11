# Feature checklist

Checked items describe implemented behavior. Live provider success requires valid credentials, available models, and the separate checks in [DEMO.md](DEMO.md).

## Companion and tasks

- [x] Typed and validated actions follow observe → decide → policy → execute → verify.
- [x] Semantic top-frame extraction, stable IDs, sensitive field redaction, highlights, and stale-target rejection.
- [x] Click, type, select, scroll, navigate, Back, tab handoff, native video controls, and optional trusted browser input.
- [x] Confirmation before detected consequential actions and default form submissions. Ordinary registration links open the form; its final submission is confirmed.
- [x] Passwords, payment fields, and verification codes remain user-operated.
- [x] Cancellation through runtime, worker, gateway, and providers. Late cancelled replies cannot act.
- [x] Persisted goal, steps, last page, next instruction, and action evidence. One task owns execution; starting another pauses the previous task.
- [x] Browser restart restores paused tasks and requires explicit continuation. Back/Forward cache restoration does not replay completed actions.
- [x] Notes retain text, source URL/title, excerpt, and capture time. Edit, remove, search, and export inside the companion’s Saved notes tray.
- [x] Live settings and per-site pause. Paused sites stop observation, page analysis, and actions.
- [x] Optional automatic learning hints: quietly preload the first rung for a stable visible question, then reveal it after wrong-answer feedback (including plain “Try Again”). Answer edits reuse preparation; changed questions invalidate it. Bounded session cache, single in-flight request, request budget, graduated manual follow-ups, cooldown, and cancellation. Preparation is never learning evidence.
- [x] Stable page selections receive brief contextual explanations with Automatic hints enabled, even outside Learning mode. Clear a selection to clear its preview; reselect to reuse the cached explanation. Editable/private fields and inaccessible frames are excluded. All automatic assistance is read-only.
- [x] Opt-in other-tab titles and URLs, excluding paused hosts and query strings. Explicit screenshot attachment is used once for the next model request and is never persisted.
- [x] Keyboard controls, visible focus, and live reduced-motion settings.
- [x] Minimal icon dock: single composer, quick actions, notes, and a collapsed tool tray. Task details and activity appear on demand. Confirmations retain explicit text.
- [x] ChatGPT sign-in is the only live AI connection. Sign-out disables AI; failures never fall back to API keys or a local model.
- [x] Text-only interaction: no microphone, synthesized speech, offscreen audio, or speech permissions.

Progress is conservative: a click alone does not complete an entire milestone. A consequential task needs visible completion evidence before it is marked completed. Complex custom widgets may need user guidance or optional real input.

## Interactive rooftop and inline tools

- [x] Live layered rooftop with four time-of-day phases, pointer parallax, clouds, blimp, lights, water, pigeons, walking HypeMan, and a boombox that plays a packaged music loop while HypeMan dances (off by default, paused in background tabs). Activating the graffiti also dissolves in a palette-matched pixel portrait on the wall beneath it. Keyboard-accessible scene hotspots and live reduced motion.
- [x] One prompt with distinct task, **Web search**, and **Ask HypeMan** modes; Enter submits directly.
- [x] Consistent Y2K styling across the companion, popup, onboarding, inline tool trays, drawing, video, customization, notebook, and demo pages. Extra settings and history unfold on demand.
- [x] Tasks, notes, recent action history, workspace export, permissions, customization, and optional Learning view unfold from icons inside the companion. Old dashboard links redirect into these inline tools.
- [x] Health distinguishes demo, live, local, and unavailable services.
- [x] Local character cutout, pixel preview, saved library, and name customization. Optional provider suggestions return a name and palette.

## Specialist workspaces

| Feature  | Implemented experience                                                                              | Without paid credentials                                             |
| -------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Video    | Native controls, page captions, VTT/SRT upload, pasted transcript, timestamped notes/chapters       | Local caption notes and labeled demo responses                       |
| Sketches | Companion chalkboard text and simple shapes                                                         | Deterministic demonstration sketches                                 |
| Drawing  | Mouse/touch/stylus canvas, undo/redo, eraser, PNG export, requested coaching                        | Labeled scripted feedback in demo; live OCR requires ChatGPT sign-in |
| Notebook | In-page photo/camera overlay, editable transcription, uncertainty, explicit capture/read, stop on hidden/closed overlay | Labeled scripted notebook in demo; no live transcription is claimed  |
| Learning | Optional plans, hints, page-feedback evidence, teach-back review, concept graph                     | ChatGPT feedback; demo feedback never establishes mastery            |

Task notes and learner diagnostics are separate. Teach-back records an explanation; assessed evidence is accepted only when grounded in that explanation. Demo assessment does not establish mastery. The graph presents practice history, not a grade.

## Scope and limits

- Local single-user Chrome MV3 release; no accounts, cloud sync, shared workspace, or store publication.
- Top-frame HTTP/HTTPS support. Inaccessible frames and Chrome-protected pages cannot be operated.
- Caption-based video understanding. HypeMan does not infer unheard narration from frames; live missing captions are reported as unavailable.
- Missing credentials and invalid provider output produce explicit failures. Handwriting/notebook fixtures are used only in explicit demo mode.
- Live AI requires eligible ChatGPT plan permission. Images require a supported account model; unavailable features fail explicitly.
- Recognizable legacy settings and learner keys are read through validators; arbitrary old profiles and character formats are not guaranteed to migrate.
- Site pause is hostname-wide. Paper camera stays in an isolated extension frame over the page and stops when closed or hidden.
- Optional screenshot/other-tab context and debugger input are capability switches, not an idle remote monitoring service.

## Verification

Unit/integration coverage includes persisted-record validation, serialized task storage, deduplication, action policy, stale targets, malformed decisions, cancellation, paused-site silence, lifecycle restoration, trusted transport, video intents, and grounded teach-back. The deterministic browser suite covers registration, notes/export, live settings, specialist fixtures, and restart continuation.

OCR accuracy, transcript-service availability, and live model completion need credential-dependent checks. A fixture response does not validate them.
