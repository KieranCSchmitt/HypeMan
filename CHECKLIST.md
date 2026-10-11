# Release checks

Run `npm run check` and `npm run e2e` using Node 24. See [feature status](docs/FEATURES.md) and the [demo walkthrough](docs/DEMO.md).

Run `npm run model:check` for local readiness. With no OpenAI key and `DEMO_MODE=0`, verify real local summaries/highlights, model attribution, cancellation, missing-model errors, and explicit confirmation. The default text model must reject image attachments. Speech controls and permissions must be absent.

For credential-dependent checks, start the live server and open HypeMan in regular Chrome, then verify:

- Live browser reasoning respects confirmations and leaves private fields user-operated.
- Handwriting and notebook results match the actual image, and unclear regions remain uncertain.
- Service transcripts remain source-backed; missing captions are reported accurately.
- Provider disconnection, cancellation, and invalid responses leave no pending action.

For visual regression, inspect the rooftop in day/night, all Control Center views, popup, pairing, companion confirmation, drawing, video, customization, and notebook at desktop and narrow widths. Check icon labels by hover and keyboard focus, no horizontal overflow, immediate reduced motion, and direct Enter submission. `npm run art:export` must preserve transparent hard-edged sprites and regenerate the packaged scenes.
