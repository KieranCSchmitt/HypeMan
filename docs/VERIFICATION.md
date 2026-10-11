# Verification

Run HypeMan on ordinary webpages with the built Chrome extension and a live local gateway. There is no bundled demo website.

## Automated checks

```sh
npm run check
npm run check:docs
npm run e2e:install
npm run e2e
npm run e2e:ui
npm run e2e:workbench
npm run e2e:pdf
npm run e2e:projects
npm run e2e:execution
npm run e2e:auth
npm run e2e:messaging
npm run package:store
npm run store:assets
```

Browser checks use isolated Chromium profiles, minimal test-only pages, and controlled provider responses. They verify browser policy, persistence, tool interactions, transport, and failure recovery. Mocked authentication does not sign in to an actual account or consume plan usage.

Store preparation also loads the staged package without the development manifest key and verifies local tools without a gateway, privacy defaults, and listing-image dimensions. Store-ID tests check the exact configured origin and continued API authentication. Atomic-file tests cover Windows lock retries, preservation of the previous state, and bounded failure. POSIX permission-bit and privileged file-symlink assertions run on supported platforms; Windows uses filesystem ACLs, which those POSIX assertions do not validate.

## Live checks

Start `npm start`, connect ChatGPT in regular Chrome, and choose an available model. On a real public webpage, ask a question about the visible content and verify the reply against the source. Select a passage, save it, reload, and check its text and source link. Create a multi-step project, review the plan, and verify evidence before accepting progress. Test cancellation and sign-out recovery.

For PDFs, check selectable text, page citations, scanned pages, password handling, and export. For video, use a real captioned source or provide an actual transcript; verify chapter seeking and distinguish unavailable captions from a summary. Whiteboard edits, drawing, undo, and export should work locally.

Actual ChatGPT eligibility and model quality, transcript providers, and Photon delivery require live account checks. For phone pairing and delivery, follow [setup](SETUP.md#phone-companion-with-photon).

The [judging walkthrough](JUDGING.md) provides a short real-page evaluation. [Screenshot details](SHOWCASE.md) identify the interactions shown in the README.
