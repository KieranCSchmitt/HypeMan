# HypeMan

A Y2K pixel companion that helps you get things done in Chrome. Describe a goal, compare page content, prepare ordinary fields, and review consequential actions before they happen. Learning is an optional mode.

This release is a local, single-user portfolio/demo application built with TypeScript. Its interface uses chrome windows, neon accents, an animated rooftop, and HypeMan artwork.

Created by **Kieran Schmitt**.

## Run HypeMan

Use **Node 24**, npm, and a current desktop Chrome. The lockfile is committed.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

The gateway listens on `http://127.0.0.1:8787`. HypeMan connects automatically; there is no pairing key to copy. A private transport secret stays in `.hypeman-token` with owner-only permissions. The gateway shares it only with HypeMan’s pinned extension origin, then authenticates API requests with it. `HYPEMAN_TOKEN` can override this internal value for advanced setups.

1. In your regular Google Chrome browser, open `chrome://extensions` and enable **Developer mode**. Use this browser for real ChatGPT sign-in; Chrome for Testing is reserved for automated checks.
2. Choose **Load unpacked** and select `apps/extension/dist`.
3. Open HypeMan’s onboarding page. It connects to the running local server automatically. The server address is available under connection settings if you use a different port.
4. Open an ordinary webpage and activate the little HypeMan avatar. Chat there, highlight content, or ask HypeMan to open the tool you need.
5. A new tab is a quiet rooftop. The local server address displays connection status; it does not open a playground or tool menu.

The separate [development walkthrough](docs/DEMO.md) describes deterministic browser fixtures and automated checks. `npm run demo` starts that fixture gateway without paid credentials; `/demo/*` pages are test inputs, not the product entry point.

After rebuilding, reload the extension in `chrome://extensions` and refresh website tabs. `npm run dev` watches the gateway and extension build; `npm run demo` starts only the deterministic demo gateway.

## What is included

- A task companion with highlights, navigation, ordinary form filling, confirmation, cancellation, and verified action history.
- Projects are saved only when a request needs at least two meaningful milestones. Questions, explanations, and one-off actions stay in chat.
- One running project at a time, paused projects, source-linked notes, workspace export, and explicit continuation after a browser restart.
- A quiet new-tab rooftop and a little avatar on ordinary webpages. Conversation and requested tools unfold from the avatar beside the current page; there is no playground or separate dashboard.
- Caption-backed video help, a shared whiteboard with locally rendered equations, PDF drag-and-drop and document help, learning plans, hints, teach-back, and a learner evidence graph.

Enable **Automatic hints** to explain highlighted words or phrases after the selection settles. A small preview appears beside the character; open it to continue in chat. Selection explanations work with Learning mode off and never create a task or learning evidence.

In **Practice**, also enable **Learning mode**. HypeMan silently prepares the first hint for a stable, recognizable question and reveals it when wrong-answer feedback appears. Typing an answer reuses the prepared hint; a changed question gets its own context. If preparation is still running, the trigger reuses that request. Ask for another hint to move to the next level of help. A six-entry, five-minute session cache and request budget limit speculative work; background tabs, paused sites, and active tasks stop it. Automatic assistance cannot fill or submit anything.

For a project, HypeMan saves meaningful milestones and begins ordinary browser work immediately. Research can open several source tabs and carry their saved findings into the comparison and later steps. Verified completion starts the next milestone; essential questions and consequential actions still wait for you. Say **just make a plan** or **wait for me** to work through the steps yourself. You can say **done** or **confirm this project step complete** to confirm the current step. On another website, ask to open Projects, select one, and say **continue this project here** to carry the plan over without replaying browser actions. Uncertain or changed pages never advance progress automatically.

See the [feature checklist and limits](docs/FEATURES.md). Demo mode is a scripted demonstration, not general-purpose offline reasoning. Live mode reports unavailable services instead of substituting fabricated results.

## Interface and artwork

Activate the avatar on an ordinary webpage to open the shared composer, which decides whether to answer, open a tool, search, or continue browser work. Ask **open whiteboard**, **find my notes about gravity**, **show projects**, **preferences**, or **open phone**. Chat and tools open as independent pixel windows. Drag their title bars, resize from any edge or corner, and click a window to bring it forward. Each window has minimize, maximize, restore, and close controls. Compact toolbars provide direct drawing, file, note, and account actions. Multiple tools can stay open; closing one preserves its work. Keyboard users can focus a title bar to move a window with the arrow keys or focus its lower-right grip to resize it (Shift moves farther). The avatar and Chrome toolbar open the conversation beside the page. The new-tab rooftop stays quiet until you activate its avatar.

Draw directly on the shared whiteboard; double-click text or equations to edit them, drag objects to move them, and use keyboard undo/redo and Delete. Ask for style changes, review, clearing, or a combined PNG export. Assistant additions append by default and save as undoable transactions. Drop a PDF onto the conversation (25 MiB per file) to open a local preview with selectable text. Ask about a page or highlighted passage, request a summary, or ask for a whiteboard explanation. Answers cite real saved-document pages. Scanned-page reading is explicit and marked as an inferred image reading; passwords stay local. Original PDF bytes live in extension-owned IndexedDB, independently of webpage observation or site pause.

Notes edit directly and autosave; ask to save, find, delete, or undo deletion. Select projects, transcript passages, saved excerpts, and messages as the subject of your next request. Native media controls and source/download links remain usable. Paste or drop images, or ask **capture a screen region** on a webpage. Use **show saved work**, **new chat**, and **export workspace** to manage durable conversations and artifacts. Workspace JSON includes saved content and document metadata; ask **export this PDF** for the original PDF. Enter sends, Shift+Enter inserts a line, and Escape stops a request before dismissing tools/chat. Failed submissions retain the draft.
HypeMan artwork powers a live layered rooftop and character atlas. Move the pointer for parallax; click the sky for a blimp, the pigeons to scatter them, the clock to cycle time, and the boombox for a silent dance. Click the rooftop floor to walk; activate HypeMan to greet. Scenery has no tool shortcuts; activate the mascot to focus the conversation. Each prop also supports keyboard focus and Enter/Space. `npm run art:export` regenerates the packaged art; normal builds use the included PNGs. See [art sources](scripts/art/README.md). Motion responds immediately to system or app preferences, and background tabs stop animating.

Press Start 2P and Tiny5 retain their included font licenses. The silent equation lesson is generated specifically for HypeMan; `node scripts/generate-demo-video.mjs` regenerates it with Playwright and FFmpeg. Normal builds use the included clip.

## Live integrations

Set `DEMO_MODE=0` in `.env`, then run `npm start`. Ask **sign in** or **open connection**, then use the contextual **Continue with ChatGPT** consent control. HypeMan connects to the local gateway automatically. Complete the sign-in in your regular Chrome browser and approve **Use your ChatGPT plan**. Choose one of the models returned for your account. No pairing key or OpenAI API key is needed for this connection.

This uses OpenAI's [Sign in with ChatGPT integration for local apps](https://developers.openai.com/siwc/token-sharing-open-source). It requires an eligible ChatGPT Plus or Pro account and counts toward that plan's existing usage limits. **Manage usage** opens ChatGPT settings. It does not give HypeMan access to your ChatGPT conversations. Local/personal use is supported; paid or remotely hosted distribution requires separate access from OpenAI.

HypeMan saves account registrations and OAuth credentials in `~/.config/hypeman/` with owner-only permissions and refreshes credentials when needed. Credentials stay in the gateway; the extension receives account labels and connection status. Use the account picker to switch saved registrations, reconnect, or add an account. Sign-out clears local tokens and attempts remote session revocation; disconnect the app in ChatGPT settings to remove its access entirely.

ChatGPT sign-in is the live AI connection. Browser reasoning, learning feedback, video summaries, drawing analysis, and uploaded-document help use the signed-in account. Signing out, disabling plan permission, expired authorization, and usage-limit errors stop AI requests and prompt recovery.

| Setting                        | Purpose                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| ChatGPT connection in Settings | All live AI features through your eligible ChatGPT plan                                   |
| `CHATGPT_MODEL`                | Optional preferred model; available choices come from the signed-in account               |
| `SUPADATA_API_KEY`             | Optional transcript retrieval for supported YouTube URLs; native captions work without it |

Configuration and deadlines are documented in [.env.example](.env.example). ChatGPT credentials stay in the Node process. Live integrations need separate account-dependent checks; deterministic demos use labeled fixtures and never substitute for failed live requests.

## Phone companion with Photon

HypeMan can hold a personal text conversation, start Chrome requests from your paired phone, save ideas and goal drafts to a phone inbox, and send reminders and accountability check-ins through [Photon Spectrum](https://photon.codes/docs/spectrum-ts/getting-started). The gateway pins `spectrum-ts` to **12.10.1** and uses the managed iMessage provider. It opens an outbound connection, so no public webhook or tunnel is required. SMS/RCS fallback depends on the Photon project, sending line, and recipient support.

1. Create a Free iMessage/RCS project at the [Photon dashboard](https://app.photon.codes).
2. Open your avatar's **Account** settings and add and verify your phone. In the project's **Users** page, add that same phone number. Free projects require registered recipients. **Get started** then shows the shared number assigned to your phone.
3. Copy the project's ID and secret from its Settings into `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` in the gateway's `.env`. Keep `DEMO_MODE=0`, then restart `npm start`. Demo mode never connects to Photon.
4. In HypeMan chat, say **pair my phone +14155551234** with your number in international format. From that phone, text `PAIR <desktop code>` to the assigned Photon number within ten minutes. The desktop code stays available even if the invitation's delivery is uncertain. Only that owner's direct conversation is accepted; group texts and outgoing echoes are ignored.
5. Confirm the paired status, then text **open YouTube**, **open https://example.com**, or a browser request. HypeMan queues the request for Chrome and reports when Chrome accepts it. Browser requests open a separate chat and tab, and consequential actions still require confirmation in Chrome. **SAVE** and **QUEUE** keep ideas in your inbox for later; select a capture and say **continue this capture in Chrome** to start that saved work.

If Photon reports **Target not allowed for this project**, check the project's Users page and the actual number or email Apple uses to send iMessages. Photon's [iMessage troubleshooting guide](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage) describes checking the sender handle. HypeMan's owner pairing requires the registered phone number, so an iPhone that starts conversations from an email must be changed to start from that phone number before pairing. A connected gateway alone does not establish that Photon has authorized a recipient.

Chrome owns saved projects and source-linked notes. The gateway keeps phone history, browser requests, freeform captures, commitments, reminders, and delivery records in an owner-only file under `~/.config/hypeman/`. Chrome syncs every 30 seconds and after workspace changes; phone replies describe the saved snapshot and its age. Browser requests have durable claims and dispatch receipts to prevent duplicate launches after retries or restarts. Requests expire after ten minutes; an uncertain dispatch is not automatically repeated. Captures import with durable acknowledgements. Select a saved note or project and say **text this to me**.

Planning and reflection default to **9 AM** and **7 PM** in **America/New_York**, with editable times and timezone. Automated check-ins and opt-in project updates respect 9 PM–9 AM quiet hours. Explicit reminders keep their requested time. Missed daily check-ins are skipped; overdue one-time reminders are sent once with a late label. `STOP` mutes proactive messages and `START` restores them; these commands do not control Chrome tasks. Self-reported commitments remain separate from verified browser milestones. The first Chrome sync establishes a baseline and does not announce old completed projects.

`SAVE your idea` and `QUEUE your goal` work without AI. `STATUS` reports saved project progress; `REMINDERS` lists up to ten pending reminders with IDs. Use `CANCEL <id>` or `SNOOZE <id> 30` to manage one, or `SNOOZE 30` for the last delivered reminder. `DONE` marks a single open commitment for today as self-reported complete. Ask conversationally for new one-time reminders, including a clear date and time; HypeMan asks about ambiguous times. Daily check-in times can be set between 9 AM and 9 PM in Settings.

The computer and gateway must be running for texts and reminders. Chrome must be running for a fresh saved-workspace snapshot. Spectrum reconnects transient interruptions, but incoming messages sent while the gateway is offline are not guaranteed to replay. Failed or uncertain delivery is shown in Settings; HypeMan does not blindly resend an uncertain message. Status, messaging controls, and scheduled reminders work without ChatGPT; conversational AI requires the same signed-in ChatGPT account as the browser companion. Account changes cancel phone inference.

Phone APIs are authenticated local `POST /api/messaging/:action` calls, using the extension's existing bearer token. Pairing and owner details stay behind authentication; public health exposes only capability availability. Photon credentials never enter extension storage or API responses. This initial release supports one owner and text-only DMs.

### Photon smoke test

Deterministic tests cover transport normalization, pairing, ownership, deduplication, persistence, scheduling, and local API authentication without Photon credentials. For the live check, use your actual Free project to pair an iPhone, exchange a text in both directions, send a saved note, receive a short one-time reminder, and verify `STOP`/`START`. Repeat with Android to verify SMS/RCS fallback where available. Test a gateway restart and Chrome restart, and inspect delivery status and synchronization age. Dashboard recipient registration, actual carrier delivery, and offline replay require this account-dependent check; automated fixtures do not verify them.

The pinned SDK currently brings OpenTelemetry dependencies with a moderate [baggage-parsing advisory](https://github.com/advisories/GHSA-8988-4f7v-96qf), reported through 18 transitive entries by `npm audit`. HypeMan disables Spectrum telemetry and does not extract incoming baggage headers. A compatible upstream dependency update is needed to clear those audit entries; overrides outside Photon's declared dependency ranges have not been applied.

## Local security and browser limits

The gateway binds to loopback and checks Host and browser Origin. Automatic connection accepts only the exact HypeMan extension origin; web pages, other extensions, and requests without an Origin cannot discover the private token. API requests require the internally managed bearer token. The inert connection-status page and explicitly addressed fictional test pages are public on that local port. This development gateway is intended to stay on your computer.

The extension has HTTP/HTTPS page access so the companion can appear on websites. Screenshot context, other-tab context, and real browser input default off; real input requests Chrome’s optional debugger permission when enabled. Ask **pause HypeMan on this site** to stop page observation, outgoing page work, and actions for that hostname. Local PDF viewing and uploaded-document help remain independent of site observation. PDF passwords stay in the reader; original files stay in extension-owned IndexedDB.

Interaction supports the top frame. Embedded players, cross-origin frames, browser settings, and Chrome-protected pages can be inaccessible. Passwords, payment details, and verification fields stay user-operated. Confirmation uses semantic page information and form behavior; review the visible action and page yourself. Saved notes and tasks use local extension storage. The optional phone companion synchronizes the workspace with the local gateway.

## Development and verification

```sh
npm run typecheck
npm test
npm run build
npm run e2e:install
npm run e2e
npm run e2e:auth
npm run e2e:projects
npm run e2e:messaging
npm run e2e:execution
```

`npm run check` runs typecheck, unit/integration tests, and build. The Playwright suite runs separately with a real MV3 extension, an isolated profile, and a deterministic gateway. `npm run e2e:auth` checks automatic connection, sign-in, model selection, streamed inference, sign-out, and credential isolation using mocked OpenAI authorization and inference. It does not sign in to a real account or consume plan usage. Screenshots are saved under `tests/screenshots/`. The [walkthrough](docs/DEMO.md) separates scripted checks from credential-dependent checks.

| Path                            | Responsibility                                                        |
| ------------------------------- | --------------------------------------------------------------------- |
| `packages/core/src`             | Contracts, validators, settings, task storage model, learner evidence |
| `apps/extension/src/runtime`    | Observation, target registry, action policy/execution, task loop      |
| `apps/extension/src/background` | Canonical persistence, tab ownership, permissions, gateway transport  |
| `apps/extension/src/ui`         | Companion, interactive rooftop, inline collections, specialist workspaces             |
| `apps/gateway/src`              | Loopback HTTP server and provider adapters                            |
| `apps/gateway/public/demo`      | Fictional workshop, learning, and video browser-test fixtures                |

## Next steps

1. **Reusable task recipes:** turn successful workflows into editable routines that re-check each page before acting.
2. **Searchable, source-aware memory:** retrieve previous findings and flag facts that may need refreshing.
3. **Task replay and evaluation:** explain completed actions and measure completion, corrections, latency, and provider cost.
4. **Optional synchronized workspaces:** add accounts, cross-device continuation, and sharing after the local experience is dependable.
