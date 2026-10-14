# Echo microsite

The public site is plain HTML, CSS and JavaScript. It has no framework, CDN,
remote font or runtime package dependency. Node dependencies are development
and verification tools only. The intended Pages URL is
<https://worxbend.github.io/echo/>.

## Local verification

Use Node.js 22 or newer (the Pages workflow uses Node 24):

```sh
npm ci --ignore-scripts
npm test
npm run build:site
npx playwright install chromium
npm run test:browser -- --workers=2
npm run serve:site
```

Open <http://127.0.0.1:4173/echo/>. On a Linux runner without browser system
libraries, use `npx playwright install --with-deps chromium`. The browser test
configuration launches its own server; stop a manually started server before
running the suite. Do not run the browser suite against unbuilt source files.

To inspect a root deployment instead:

```sh
SITE_BASE=/ PORT=4174 npm run serve:site
```

This tooling does not build or test the Go application. Follow the repository's
application instructions separately.

## Publishing boundary

`site-build.mjs` replaces `_site/` with `index.html`, allowlisted static files
under `assets/`, and `build.json`. It excludes this README, dotfiles, source
notes, test output, package files and unrelated repository content. The font
exception is exactly `assets/fonts/manrope-latin.woff2` and its
`assets/fonts/OFL.txt` license; no other font-directory files are published.
Symlinks in the copied source tree are rejected. Source/output directory overlap
is also rejected before deleting any output.

`build.json` records the checkout commit, build timestamp, and exact published
source-file list. In Actions it uses `GITHUB_SHA`; locally it uses `git rev-parse
HEAD`. Local uncommitted edits can therefore exist alongside the recorded HEAD;
only a clean CI checkout gives commit-exact provenance.

`site-check.mjs` checks every built HTML/SVG `href`, `src`, `srcset`, `poster`,
object resource, CSS `url()` and CSS import. Local targets must exist with exact
case, and fragments must name IDs in the referenced document. Root-relative
paths, traversal, symlinks, inline script/style/event handlers and remote
resources fail validation. HTTPS/HTTP/mailto outbound navigation and canonical
metadata links are allowed, but not downloaded or checked for remote uptime.
The shared publishing allowlist keeps builder and checker consistent. Run the
checker against an alternative artifact with:

```sh
node scripts/site-check.mjs /absolute/path/to/artifact
```

## Browser coverage and evidence

Chromium tests use the real `/echo/` deployment subpath and also smoke-test `/`.
They cover 320, 390, 768 and 1440px layouts in light and dark themes, with and
without JavaScript, including expanded native install/FAQ disclosures. Enhanced
pages receive axe WCAG A/AA audits; script-disabled pages instead exercise native
links, disclosures, theme fallback and readable content directly.

Additional tests cover all three matrix scenes, exact clipboard payloads for all
five command blocks (setup, token, event, Docker and native),
granted/denied/unavailable clipboard APIs, stored and system theme preferences,
blocked storage, keyboard controls, reduced motion, static demo behavior,
horizontal overflow, decoded self-hosted fonts, failed requests, external
requests, console/page errors and CSP violations. The preview is illustrative,
not a connected hardware test. Automated axe checks are not a complete manual
accessibility certification.

Each full suite captures 16 full-page screenshots after font decoding:

- `artifacts/site/screenshots/`: PNGs and capture metadata;
- `artifacts/site/manifest.json`: count, completeness, dimensions, browser version,
  commit provenance and SHA-256 hashes for captures and published assets;
- `artifacts/site/gallery.html`: offline screenshot gallery;
- `artifacts/site/playwright-report/`: HTML test report;
- `artifacts/site/test-results/`: failure screenshots and retained traces.

Open `gallery.html` directly in a browser. The manifest lists missing captures
when a filtered or failing run produces partial evidence. Evidence is outside
prunable scratch storage and never included in `_site/`. Each new browser run
clears old screenshots so stale captures cannot masquerade as current results.

## GitHub Pages workflow

`.github/workflows/pages.yml` runs infrastructure regressions, builds/checks the
artifact and runs Chromium acceptance tests with two workers for relevant
main-branch pushes, pull requests and manual dispatch. Browser evidence is
uploaded separately. Only successful non-PR runs on `main` upload `_site/` to
Pages and enter the protected `github-pages` deployment environment. Deployment
uses the official configure/upload/deploy Pages actions; Pages write and OIDC
permissions are limited to the deploy job. No application workflow is changed.

A repository administrator must separately select **GitHub Actions** as the
Pages source. Creating this workflow does not enable Pages or publish the site
by itself. After an authorized deployment, check the live site's `build.json`
against the deployed workflow commit and verify served assets before claiming
publication.
