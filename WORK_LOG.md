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
