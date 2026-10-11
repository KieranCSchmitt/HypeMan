# Release checks

Run `npm run check` and `npm run e2e` using Node 24. See [feature status](docs/FEATURES.md) and the [demo walkthrough](docs/DEMO.md).

With `DEMO_MODE=0`, verify ChatGPT sign-in, model selection, grounded summaries/highlights, cancellation, account-limit errors, sign-out, and explicit confirmation. Check image features with an account model that supports them. Use `npm run e2e:auth` for the deterministic authentication checks; actual account access requires a separate live check.

For credential-dependent checks, start the live server and open HypeMan in regular Chrome, then verify:

- Live browser reasoning respects confirmations and leaves private fields user-operated.
- Drawing review results match the actual image, and unclear regions remain uncertain.
- Service transcripts remain source-backed; missing captions are reported accurately.
- Provider disconnection, cancellation, and invalid responses leave no pending action.

For visual regression, inspect the rooftop in day/night, conversation tools/projects/notes/preferences, toolbar conversation opening, automatic gateway connection, consequential confirmation, shared whiteboard equations/ink, video and PDF reader at desktop and narrow widths. Audit the absence of permanent feature launchers and mode selectors; check essential controls and content keyboard focus, no horizontal overflow, immediate reduced motion, and direct Enter submission. `npm run art:export` must preserve transparent hard-edged sprites and regenerate the packaged scenes.
