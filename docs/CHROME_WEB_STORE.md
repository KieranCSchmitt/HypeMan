# Chrome Web Store release

This is the release preparation and listing copy for the current local-gateway edition. A ZIP is not a published extension: Google must accept a submission, review it, and publish its store item. No store publication has been confirmed yet.

## Release package

Run `npm ci`, `npm run typecheck`, and `npm run package:store` from the repository root with Node 24. The packaging script requires PowerShell on Windows or `zip` on macOS/Linux. It creates `release/hypeman-<version>-chrome-web-store.zip`, an unpacked staging folder, and `release/package-report.json` with the file inventory and SHA-256 hash. The manifest sits at ZIP root. The source development key is omitted from the store package. Generated releases are ignored by Git.

The package contains only the extension build, including bundled fonts, PDF runtime assets, sprites, fountain artwork, and boombox music. It excludes the Node gateway, repository files, OAuth credentials, environment files, source maps, private keys, logs, and private launch-film assets. Package inspection fails if a prohibited file is found.

Run `npm run store:assets` after packaging to capture listing assets from an isolated install of the staged extension. Set `HYPEMAN_TEST_CHROMIUM` to an installed Chrome-for-Testing executable if the default Playwright Chromium is unavailable. To verify the actual ZIP after extraction, set `HYPEMAN_STORE_PACKAGE_DIR` to that extracted directory. The Windows ZIP writer uses forward-slash entry names for portability. The captured profile contains no real account or workspace data, and no mocked AI responses are used in these listing images. Committed copies are available here:

| Asset | Size |
| --- | --- |
| [Rooftop](media/store/01-rooftop-1280x800.png) | 1280×800 |
| [Skin gallery](media/store/02-skins-1280x800.png) | 1280×800 |
| [Local whiteboard](media/store/03-whiteboard-1280x800.png) | 1280×800 |
| [Settings](media/store/04-settings-1280x800.png) | 1280×800 |
| [Small promotional tile](media/store/promo-440x280.png) | 440×280 |
| [Store icon](media/store/icon-128.png) | 128×128 |

Version 0.2.1 preparation checks passed on Windows: 1,075 unit tests, typecheck, documentation checks, isolated packaged-install/local-whiteboard checks, music/skin/TV browser checks, and wallpaper checks at 1×/1.25×/2× display density up to 7680px wide. The TV checks observe automatic playback without forcing it and verify restart at the end. Live AI account eligibility, live Photon delivery, Google's assigned store identity, and Web Store review still require their separate external checks.

## Public listing copy

**Name:** HypeMan — your browser companion

**Short description:** A pixel companion for browser tasks, source-backed notes, and optional learning.

**Category:** Productivity. **Language:** English. **Price:** Free extension; optional external services have their own account requirements and usage limits.

**Description:**

HypeMan puts a tiny pixel companion beside the page you are working on. Save source-linked notes, organize projects, edit a shared whiteboard, and read PDFs in movable browser windows. Your new tab becomes an interactive pixel rooftop with six character skins, an animated fountain, a looping demo on its TV, and optional boombox music.

The rooftop, local notes, whiteboard, and PDF viewer work without an AI account. AI assistance and phone features require a separate local Node 24 gateway running on your computer. This release does not include a hosted AI service. Follow the linked setup guide to install and start the gateway; then connect an eligible ChatGPT account and explicitly authorize plan usage. AI features use that account's applicable limits. Phone messaging needs a separately configured Photon project and phone pairing.

Ask HypeMan to compare pages, prepare a plan, save useful passages, or help with learning. Supported ordinary browser actions can run as part of your request; detected consequential actions ask for confirmation. Passwords, payment details, and verification codes remain user-operated.

Your workspace is stored locally. Disable automatic help, pause HypeMan on a site, and control screenshot, other-tab, learning, and real-input settings. See the privacy policy for content sent to connected services. Installing HypeMan replaces Chrome's new-tab page.

**Homepage:** https://github.com/KieranCSchmitt/HypeMan

**Support:** https://github.com/KieranCSchmitt/HypeMan/issues

**Privacy policy:** publish `docs/PRIVACY.md` to the public repository, then use its stable public HTTPS page. Confirm the policy is accessible while signed out before entering the URL in the dashboard.

## Permission explanations

Use these explanations in the dashboard, matched to the uploaded manifest:

| Permission | Reason |
| --- | --- |
| `storage` | Save settings, notes, conversations, projects, and other workspace data locally. |
| `activeTab` | Work with the page the user activates and capture its visible area when screenshot assistance is enabled. |
| `tabs` | Identify the active page, open requested pages, and manage browser-task ownership and handoff. Other-tab content assistance is off by default. |
| `scripting` | Initialize the companion on supported pages, inspect requested page context, and perform validated browser actions. |
| `contextMenus` | Provide the selection action Explain with HypeMan. |
| `alarms` | Schedule local background synchronization and configured phone reminder processing. |
| `declarativeNetRequestWithHostAccess` | Supply the HypeMan app identity required by YouTube only for the demo's embed request initiated by this extension. It does not block ads or modify ordinary browsing requests. |
| HTTP/HTTPS host access | Display the companion on supported websites, inspect relevant context, execute requested tasks, and communicate with the user's loopback gateway. These features are not limited to a fixed set of websites. |
| Optional `debugger` | Requested only when the user enables real browser input for supported tasks; it starts disabled. |
| Optional `<all_urls>` | Requested only when the user enables screenshot assistance, because Chrome's visible-tab capture requires the additional host grant. Screenshot assistance starts disabled. |

**Single purpose:** Help the user work with the webpage and its related local workspace through a browser companion. The rooftop is the companion's new-tab home.

**Remote code:** Application logic is bundled. The optional YouTube TV is an isolated third-party embed; it has no extension API access, is sandboxed, and is removed when switched off. AI responses are treated as typed task instructions subject to the extension's validators and confirmation rules, not executed as downloaded JavaScript. Explain the embed in the dashboard rather than asserting there are no third-party frames.

## Data disclosure review

Declare the data categories that match the actual features: website content, requested browser interactions, locally saved user content, account identity, optional phone information, and credentials handled by the separate gateway. Document which optional flows transmit that content to OpenAI, Photon, Supadata, Google/YouTube, or Wikipedia. Local storage does not justify a blanket claim that the product handles no user data. Match the form to [the privacy policy](PRIVACY.md), and make the Limited Use certification only after the publisher has reviewed the actual practices.

## Reviewer instructions

1. Install the uploaded extension and open a new tab. Verify skins, music, TV, scenery resizing, and the animated fountain without a gateway.
2. Activate the avatar or use the toolbar. Open whiteboard, notes, projects, preferences, or the PDF viewer. These local tools do not require paid AI access.
3. For AI testing, install Node 24 and clone the repository. Run `npm ci`, copy `.env.example` to `.env`, set `HYPEMAN_STORE_EXTENSION_ID` to the exact ID of the store-installed extension, and run `npm start`. Keep the gateway running. No publisher credentials are bundled or provided.
4. Connect an eligible ChatGPT account through Continue with ChatGPT and explicitly consent to plan usage. Test against an ordinary HTTP/HTTPS page. Sign-in and plan eligibility are controlled by OpenAI; mocks must not be presented as working live AI.
5. Phone features are optional and require the reviewer's own Photon configuration and explicit pairing. They cannot be tested from the extension ZIP alone.

## Before submission

- Register the publisher account, pay Google's displayed one-time registration fee, and complete required account verification. The currently inspected account was at the registration screen.
- Decide whether the local-gateway requirement is appropriate for the intended audience. A hosted edition requires a separate architecture, operational funding, and supported public authentication; do not advertise the current package as standalone AI.
- Upload the ZIP as a draft. Record Google's assigned item ID. Configure that exact ID for the local gateway and verify the uploaded/store installation, rather than relying only on the development identity.
- Upload the 128px icon, at least one current 1280×800 screenshot, and a 440×280 promotional tile from `release/store-assets/`. Do not use private launch-film files.
- Publish the privacy policy at a public URL and verify support/contact information. Complete the listing, privacy declarations, reviewer instructions, and public distribution settings.
- Confirm the publisher has rights to distribute all bundled artwork, the imported character/fountain assets, the supplied boombox recording, and branding. Preserve third-party font notices. Existing repository visibility is not proof of a redistribution license.
- Run the checks and inspect the actual packaged ZIP. Google may request changes; preparation is not a guarantee of approval.
- Submit for review using the publisher account, then verify the final public listing and a fresh store installation after approval.

Official references: [Prepare an extension](https://developer.chrome.com/docs/webstore/prepare), [Publish](https://developer.chrome.com/docs/webstore/publish), [Listing assets](https://developer.chrome.com/docs/webstore/images), [Privacy disclosures](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), and [ChatGPT plan usage for locally hosted apps](https://developers.openai.com/siwc/token-sharing-open-source).
