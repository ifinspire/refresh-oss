# Contributing

Thanks for helping improve refresh. Small, focused changes are easiest to review.
Explain what a person could do before your change and what they can do afterward.
Use plain language in the interface and docs; put technical detail where it helps
someone check or troubleshoot the work.

## Rights in contributions

This project requires the [contributor copyright assignment and license
agreement](CONTRIBUTOR_AGREEMENT.md) for outside code, documentation and artwork
contributions. It assigns the contributor's copyright in submitted work to
Imagination Frontier, LLC, and grants a license back to the contributor. It is
separate from the Apache-2.0 license that everyone receives for published code.

The agreement is a template pending legal review. Until the Company approves it
and arranges a private signing process, maintainers must not merge outside
copyrightable contributions. You may still open issues and discuss improvements.
Do not post your signed agreement or personal contact details in public issues.
Ask a maintainer on your pull request to arrange private signing. If your employer
owns the work, their authorization is needed too.

Before merging, a maintainer must confirm that all relevant rights holders signed,
record that check privately, and mark the pull request as agreement-reviewed.
Recheck if authorship or included material changes. A pull-request checkbox,
DCO sign-off, Git signature or automated test result does not replace the agreement.
The included template is not an automated signing service.

## Build and test

Everything runs through Docker Compose; you do not need to install Python or Node.
Follow the README to start the app. Run the isolated unit/integration suite:

```sh
docker compose --profile test run --build --rm tests
```

For browser checks, use a separate instance and test-only data folder:

```sh
mkdir -p test-results/data
docker compose -p refresh-oss-browser -f compose.yaml -f compose.browser.yaml --profile test up --build -d --wait app
docker compose -p refresh-oss-browser -f compose.yaml -f compose.browser.yaml --profile test run --build --rm browser-tests
docker compose -p refresh-oss-browser -f compose.yaml -f compose.browser.yaml down
```

Browser screenshots are saved in `test-results`. They and all test data are ignored
by Git. The browser suite does not send images to a real image server. Tests that
replace the image server are confined to `tests/`; the app has no fake-success mode.

Keep a logical commit history. Never copy the hosted product's history, credentials,
private settings or customer photos into this repository. Add source and rights
information for new bundled assets. The default app supports one process and one
local library; do not add multiple workers without redesigning file/job coordination.

After committing, scan all local branches for accidentally committed secrets:

```sh
docker compose -f compose.audit.yaml run --rm secret-check
```

This checks Git history, including deleted content; it does not replace review of
uncommitted files or asset provenance. Keep the donor's history out of this repository.
