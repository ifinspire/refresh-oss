# Publish a version people can download

A GitHub release names a version of the source code. Its Docker package contains
the ready-made app. The image server and model weights are separate downloads.

## First package: the already-published preview

The first release was published before the package workflow existed. To publish
its package without changing that release or moving its tag:

1. Open **Actions → Publish Docker package → Run workflow**.
2. Leave the branch as **main** and enter `v0.1.0-preview.1` in **tag**.
3. Choose **Run workflow** and wait for all checks and the build to finish.
4. Open the package under the repository's **Packages** section. In its settings,
   change visibility to **Public**. GitHub initially creates packages as private,
   even when the source repository is public.
5. Confirm the README's package commands work on a computer that is not signed
   into GitHub's container registry.

The package will be `ghcr.io/ifinspire/refresh-oss:0.1.0-preview.1`. The workflow's
summary also records its exact content identifier (the image digest).
GitHub Actions uses its own temporary token; no personal access token or SSH key
needs to be added to repository secrets.

## Future releases

1. Merge the intended changes and let **Checks** pass.
2. Create a release with a new tag such as `v0.1.0-preview.2` or `v0.1.0`.
3. Describe the changes, setup requirements and known limitations. Mark previews
   as **pre-releases** in GitHub.
4. Publish the release. **Publish Docker package** starts automatically.
5. Confirm that the workflow succeeds and the package can be downloaded.

Publishing creates only the exact version tag, without the leading `v`. There
is no moving `latest` tag, so a preview cannot silently replace someone's chosen
version. The workflow refuses to replace an existing package version. If a run
fails before publishing, fix the workflow and use **Run workflow** with the same
release tag. If the package already exists, inspect it before attempting recovery;
use a new release for changes to the app.

## What gets checked and packaged

The workflow accepts only version tags attached to published releases. It resolves
the tag to one commit, then checks and builds that exact commit, even if `main`
has moved on. It runs the unit/integration and browser checks on native Intel/AMD
and ARM Linux runners, validates the optional GPU configuration, and scans history
for secrets before publishing. These CPU checks do not validate GPU inference.

The production image is built for `linux/amd64` and `linux/arm64`. Packaging appends
a copy of the release's `LICENSE` and `NOTICE` to its Dockerfile so the original
preview, which predates packaging, also carries those notices. This does not
change its application code or Git tag. Demo credits remain under `web/examples`.
The package includes source/version labels, build provenance and a software
inventory. Personal photos, `.env`, Git history and test outputs are excluded.

Use the [README's package commands](../README.md#use-a-ready-made-app-package) to
try a published version. Keep the source-build option available for development.

References: [GitHub container packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
and [Docker multi-platform builds](https://docs.docker.com/build/ci/github-actions/multi-platform/).
