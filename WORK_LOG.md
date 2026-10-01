# Build notes

## 1. Image core and local files

Started a new history from selected source files, without importing the hosted
product's Git history, environment files, account logic or operating records.
Preserved deterministic photo preparation, three public prompt variants and
brightness/color matching. Files use a single local library with atomic JSON
records. Added the Compose build and isolated test service.

Validation: `docker compose --profile test run --build --rm tests` — 4 tests passed.
At this commit the image components can be tested; the web application follows.
