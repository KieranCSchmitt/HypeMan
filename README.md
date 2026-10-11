# HypeMan

A Y2K pixel companion that helps you get things done in Chrome. Describe a goal, compare page content, prepare ordinary fields, and review consequential actions before they happen. Learning is an optional mode.

This release is a local, single-user portfolio/demo application. The TypeScript application, runtime, gateway, and tests have been rewritten. The interface now uses chrome windows, neon accents, an animated rooftop, and the supplied HypeMan artwork. Original Burrow materials and the new art sources retain [attribution](ATTRIBUTION.md).

## Run the local demo

Use **Node 24**, npm, and a current desktop Chrome. The lockfile is committed.

```sh
npm ci
cp .env.example .env
npm run build
npm run demo
```

The gateway listens on `http://127.0.0.1:8787`. HypeMan connects automatically; there is no pairing key to copy. A private transport secret stays in `.hypeman-token` with owner-only permissions. The gateway shares it only with HypeMan’s pinned extension origin, then authenticates API requests with it. `HYPEMAN_TOKEN` can override this internal value for advanced setups. Legacy `BURROW_TOKEN` and `.burrow-token` remain compatible.

1. In your regular Google Chrome browser, open `chrome://extensions` and enable **Developer mode**. Use this browser for real ChatGPT sign-in; Chrome for Testing is reserved for automated checks.
2. Choose **Load unpacked** and select `apps/extension/dist`.
3. Open HypeMan’s onboarding page. It connects to the running local server automatically. The server address is available under connection settings if you use a different port.
4. Open a new tab for the rooftop, or visit `http://127.0.0.1:8787/demo/workshops/`.
5. Follow the [demo walkthrough](docs/DEMO.md). No paid keys are needed for these labeled fixtures.

After rebuilding, reload the extension in `chrome://extensions` and refresh website tabs. `npm run dev` watches the gateway and extension build; `npm run demo` starts only the deterministic demo gateway.

## What is included

- A task companion with highlights, navigation, ordinary form filling, confirmation, cancellation, and verified action history.
- One running task at a time, paused tasks, source-linked notes, workspace export, and explicit continuation after a browser restart.
- An interactive rooftop with one prompt. Tasks, notes, activity, permissions, and learning unfold inside the companion; there is no separate dashboard.
- Caption-backed video help, sketches, a drawing board, camera notebook transcription, custom characters, learning plans, hints, teach-back, and a learner evidence graph.

Enable **Automatic hints** to explain highlighted words or phrases after the selection settles. A small preview appears beside the character; open it to continue in chat. Selection explanations work with Learning mode off and never create a task or learning evidence.

In **Practice**, also enable **Learning mode**. HypeMan silently prepares the first hint for a stable, recognizable question and reveals it when wrong-answer feedback appears. Typing an answer reuses the prepared hint; a changed question gets its own context. If preparation is still running, the trigger reuses that request. The bulb requests the next level of help. A six-entry, five-minute session cache and request budget limit speculative work; background tabs, paused sites, and active tasks stop it. Automatic assistance cannot fill or submit anything.

See the [feature checklist and limits](docs/FEATURES.md). Demo mode is a scripted demonstration, not general-purpose offline reasoning. Live mode reports unavailable services instead of substituting fabricated results.

## Interface and artwork

The rooftop has one prompt: choose the task, chat, or web-search icon, then press Enter. Task mode is the default. The companion shows its latest reply, with conversation history and extra tools available on demand. Icon controls retain accessible names, keyboard focus, and hover labels; consequential confirmations keep explicit text. Tasks, paper-style notes, a pixel whiteboard, video help, camera, preferences, and mascot editing open as movable overlays over the current webpage. There are no separate tool pages or nested dashboard toolbars. Closing the whiteboard preserves unfinished work for that page session.

The updated HypeMan-2 art powers a live layered rooftop and character atlas. Move the pointer for parallax; click the sky for a blimp, the pigeons to scatter them, the clock to cycle time, and the boombox to play its packaged music loop while HypeMan dances; the music pauses in background tabs. Click the rooftop floor to walk; activate HypeMan to greet. The CRT opens saved notes and the graffiti opens customization. Each prop also supports keyboard focus and Enter/Space. `npm run art:export` regenerates the packaged art; normal builds use the included PNGs. See [art sources](scripts/art/README.md). Motion responds immediately to system or app preferences, and background tabs stop animating.

## Live integrations

Set `DEMO_MODE=0` in `.env`, then run `npm start`. Select **Continue with ChatGPT** in onboarding or the companion’s Settings → Connection icon. HypeMan connects to the local gateway automatically. Complete the sign-in in your regular Chrome browser and approve **Use your ChatGPT plan**. Choose one of the models returned for your account. No pairing key or OpenAI API key is needed for this connection.

This uses OpenAI's [Sign in with ChatGPT integration for local apps](https://developers.openai.com/siwc/token-sharing-open-source). It requires an eligible ChatGPT Plus or Pro account and counts toward that plan's existing usage limits. **Manage usage** opens ChatGPT settings. It does not give HypeMan access to your ChatGPT conversations. Local/personal use is supported; paid or remotely hosted distribution requires separate access from OpenAI.

HypeMan saves account registrations and OAuth credentials in `~/.config/hypeman/` with owner-only permissions and refreshes credentials when needed. Existing validated credentials from `~/.config/burrow/` are copied when the new location is empty, preserving sign-ins and leaving the old file intact. Credentials stay in the gateway; the extension receives account labels and connection status. Use the account picker to switch saved registrations, reconnect, or add an account. Sign-out clears local tokens and attempts remote session revocation; disconnect the app in ChatGPT settings to remove its access entirely.

ChatGPT sign-in is the only live AI connection. Browser reasoning, learning feedback, video summaries, character suggestions, drawing analysis, and notebook transcription all use the signed-in account. Signing out, disabling plan permission, expired authorization, and usage-limit errors stop AI requests and prompt recovery. There is no API-key alternative or local-model fallback. Existing provider keys in an older `.env` are ignored.

| Setting                        | Purpose                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| ChatGPT connection in Settings | All live AI features through your eligible ChatGPT plan                                   |
| `CHATGPT_MODEL`                | Optional preferred model; available choices come from the signed-in account               |
| `SUPADATA_API_KEY`             | Optional transcript retrieval for supported YouTube URLs; native captions work without it |

Configuration and deadlines are documented in [.env.example](.env.example). ChatGPT credentials stay in the Node process. Live integrations need separate account-dependent checks; deterministic demos use labeled fixtures and never substitute for failed live requests.

## Local security and browser limits

The gateway binds to loopback and checks Host and browser Origin. Automatic connection accepts only the exact HypeMan extension origin; web pages, other extensions, and requests without an Origin cannot discover the private token. API requests require the internally managed bearer token. Health and fictional demo pages are public on that local port. This development gateway is intended to stay on your computer.

The extension has HTTP/HTTPS page access so the companion can appear on websites. Screenshot context, other-tab context, and real browser input default off; real input requests Chrome’s optional debugger permission when enabled. The notebook camera requires browser consent. **Pause HypeMan on this site** in the popup stops page observation, outgoing page work, and actions for that hostname.

Interaction supports the top frame. Embedded players, cross-origin frames, browser settings, and Chrome-protected pages can be inaccessible. Passwords, payment details, and verification fields stay user-operated. Confirmation uses semantic page information and form behavior; review the visible action and page yourself. Saved notes and tasks use local extension storage, without accounts or synchronization.

## Development and verification

```sh
npm run typecheck
npm test
npm run build
npm run e2e:install
npm run e2e
npm run e2e:auth
```

`npm run check` runs typecheck, unit/integration tests, and build. The Playwright suite runs separately with a real MV3 extension, an isolated profile, and a deterministic gateway. `npm run e2e:auth` checks automatic connection, sign-in, model selection, streamed inference, sign-out, and credential isolation using mocked OpenAI authorization and inference. It does not sign in to a real account or consume plan usage. Screenshots are saved under `tests/screenshots/`. The [walkthrough](docs/DEMO.md) separates scripted checks from credential-dependent checks.

| Path                            | Responsibility                                                        |
| ------------------------------- | --------------------------------------------------------------------- |
| `packages/core/src`             | Contracts, validators, settings, task storage model, learner evidence |
| `apps/extension/src/runtime`    | Observation, target registry, action policy/execution, task loop      |
| `apps/extension/src/background` | Canonical persistence, tab ownership, permissions, gateway transport  |
| `apps/extension/src/ui`         | Companion, interactive rooftop, inline collections, specialist workspaces             |
| `apps/gateway/src`              | Loopback HTTP server and provider adapters                            |
| `apps/gateway/public/demo`      | Fictional workshop, learning, and video demonstrations                |

## Next steps

1. **Reusable task recipes:** turn successful workflows into editable routines that re-check each page before acting.
2. **Searchable, source-aware memory:** retrieve previous findings and flag facts that may need refreshing.
3. **Task replay and evaluation:** explain completed actions and measure completion, corrections, latency, and provider cost.
4. **Optional synchronized workspaces:** add accounts, cross-device continuation, and sharing after the local experience is dependable.
