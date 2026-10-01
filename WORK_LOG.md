# Build notes

## 1. Image core and local files

Started a new history from selected source files, without importing the hosted
product's Git history, environment files, account logic or operating records.
Preserved deterministic photo preparation, three public prompt variants and
brightness/color matching. Files use a single local library with atomic JSON
records. Added the Compose build and isolated test service.

Validation: `docker compose --profile test run --build --rm tests` — 4 tests passed.
At this commit the image components can be tested; the web application follows.

## 2. Image server settings and reconstruction jobs

Added saved image-server settings, separate connection and real image-edit checks,
photo upload and deletion, three-version jobs, repeat refinement, PNG downloads,
and readable work records. Access keys stay in the local settings file and are
excluded from API responses, work records and errors. Interrupted work is never
automatically retried. The owner must confirm the image server is idle first.
Host/origin checks reduce unwanted browser requests; they are not user accounts.

Validation: Compose tests — 11 passed, including the complete processing path
with a test-only provider, wire format, restart recovery and error redaction.
No live GPU quality or compatibility claim is made by these tests.

## 3. Optional Spark image server

Packaged a self-contained Compose profile from the donor's GB10 image-server
recipe. Kept the native Klein pipeline and four-input compatibility patch; removed
private paths, unrelated service settings, remote-code enablement and published
GPU ports. Added a plain-language setup guide.

Validation: combined GPU Compose configuration validates. The patch test checks
repeat application and rejects an unexpected upstream limit. The full CPU suite
now has 14 passing tests. GB10 image build/start and real GPU generation remain
unverified on this CPU-only development environment.

## 4. Plain-language browser experience and examples

Built a small browser interface with a local photo library, crop selection,
reference-photo selection, progress, before/after sliders, downloads and refinement.
Settings use “image server,” “check connection” and “try a test image”; technical
records and prompts stay available in expandable sections. Included five credited
historical example sets, preserving the difference between public domain and no
known copyright restrictions. Did not publish mismatched donor seed/version claims.
Pinned the app's resolved Python dependencies.

Validation: 14 CPU tests passed. Isolated Chromium checks passed for import,
visible prompts, saved settings, connection failure, image verification, three
versions, PNG download, mobile layout and deletion. The HTTP image server used by
browser checks is test-only and is absent from the production image. Inspected
the desktop screenshot. No customer photos or actual API keys were used.

## 5. Release packaging

Added Apache-2.0 notices, a contributor copyright-assignment agreement template,
manual signing/review instructions, GitHub checks, a history secret scanner, a
plain-language README, and high-level hosted/self-hosted architecture diagrams.
The agreement needs legal review and a private signing process before accepting
outside contributions. No proprietary account/database implementation was copied.

Selected local port 7520 so the OSS app can run alongside the existing hosted-product
development stack. The default listener remains limited to this computer.

Release verification: `docker compose up -d --build --wait` completed with the app
healthy on loopback port 7520. Gitleaks scanned all five commits across all local
branches and reported no leaks. A separate targeted review found no private donor
paths, hosted ingress names, authentication keys or payment secrets in the release
files. The Gitea remote is unchanged; nothing has been pushed or published.

## 6. Gallery, reconstruction and settings redesign

Used Anthropic's **frontend-design** plugin from **claude-plugins-official** for
this version, following its design-plan, review and screenshot-critique workflow.
See `docs/DESIGN.md` for the design choices and plugin credit.

Replaced the long landing page with three focused screens. The gallery opens
first; each photo has a large reconstruction/comparison workspace and its own
history. Settings holds connection checks and test images. Examples live in a
picker, crop/reference options expand when needed, and instructions/work records
remain available in detail dialogs. Added reference upload without leaving the
photo, drag-and-drop upload, exact crop controls and bookmarkable photo addresses.
The save/check action is combined, and temporary test images stay out of the gallery.

Kept the existing backend, local files and image model behavior. The local-only
network settings remain in the ignored `.env`; no local hostname is in this change.

Validation: all 14 backend tests passed. The rewritten isolated Chromium suite
passed navigation, example selection, prompt access, reference upload, exact crop
controls, connection failure/success, image verification, gallery separation,
three-version generation, comparisons, downloads, refinements, history selection,
refresh/bookmark/back navigation, mobile layout and deletion. Reviewed screenshots
of the gallery, settings and reconstruction screens, including the phone layout.
Image generation in these checks uses only the test provider, not a real GPU.

## 7. Versioned Docker packages

Added a release-triggered GitHub Packages workflow with a manual option for the
already-published `v0.1.0-preview.1`. It checks the release's exact commit on native
AMD64 and ARM64 runners before publishing a two-platform production image, with
license notices, source labels, provenance and a software inventory. It publishes
only the chosen version and refuses to replace an existing version. Registry
access uses GitHub's temporary workflow token with package-write permission only
in the publishing job.

Added a Compose override for downloading a package, plus plain-language install,
update and release instructions. The existing local library and network defaults
are retained. Model weights and the optional GPU server remain separate.

Local validation: actionlint passed; the package and optional GPU Compose files
validated; all 14 backend tests passed. Built the production package from tracked
source and passed the complete browser suite against that image in an isolated
Compose project. Checked that the package carries LICENSE, NOTICE and demo credits,
without `.env` or Git history. GitHub's native ARM checks and registry publication
run on GitHub; the first package requires a manual workflow run and a one-time
Public visibility setting because the release predates this workflow.
