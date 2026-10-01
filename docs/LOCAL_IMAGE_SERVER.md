# Create images on a DGX Spark

The app needs an **image server**: a program that runs the image model. You can
connect to one you already have, or start this optional server on an NVIDIA DGX
Spark / GB10 computer. A normal laptop can run the app and view saved examples,
but this optional server is specifically for the Spark's ARM-based NVIDIA hardware.

You need Docker Compose and the NVIDIA Container Toolkit working on that computer.
The first launch downloads a large container and model files. Allow several tens
of gigabytes of free disk space and time for the download. Internet access is
needed for those downloads; the app itself does not require a cloud account.

From the project folder, after the README's setup steps:

```sh
docker compose -f compose.yaml -f compose.gpu.yaml --profile gpu up -d --build --wait --wait-timeout 1800
```

Open the app, choose **Settings**, and save:

| Setting | Value |
| --- | --- |
| Server address | `http://omni:8000/v1` |
| Model name | `black-forest-labs/FLUX.2-klein-4B` |
| Access key | Leave empty |

Choose **Save & check**, then **Try a test image**. A successful connection
alone does not prove that the server can edit images. The second check makes a
real image and checks its format and size; it does not judge likeness or quality.
The test photo stays in Settings until you remove it; it does not clutter your gallery.

To see startup progress or stop everything, use the same two files:

```sh
docker compose -f compose.yaml -f compose.gpu.yaml --profile gpu logs -f omni
docker compose -f compose.yaml -f compose.gpu.yaml --profile gpu down
```

## If you already have an image server

Use its address and exact served model name in Settings. Include `/v1` in the
address if that is where it serves its API. A server on the same computer is
usually reached as `http://host.docker.internal:PORT/v1`; `localhost` inside the
app means the app's own container. Your server must listen on an interface the
container can reach. A server on another computer needs that computer's reachable
address. Your photos are sent to that address, so choose a server you trust.

This app expects vLLM-Omni's image-edit interface. “OpenAI compatible” by itself
is not enough: some servers offer only chat, omit image editing, or use different
image fields. This is not a direct integration with Black Forest Labs' hosted API.

## Build details for maintainers

The optional build is distilled from the company's `dgx-vllm-omni` launcher.
It carries only the container recipe and Klein reference-limit patch. It has no
dependency on the donor checkout, private caches, host paths or other GPU services.

The recipe uses the community GB10 vLLM image
`timothystewart6/vllm-gb10:v0.28.0-gb10.2` with `vllm-omni==0.28.0rc1`.
It skips the unavailable ARM `fa3-fwd` dependency and installs the remaining
runtime dependencies explicitly. The patch fails if the expected upstream
reference-image contract changes. Review both pieces before changing versions.
The app sends one source plus at most three references, four steps and guidance
1.0, as appropriate for the distilled 4B model. It does not enable remote Python
model code. The server port is available only on the private Compose network.

This package's CPU checks validate the Compose configuration, launcher and patch
logic. **The optional image has not been built or run on GB10 hardware as part of
this extraction.** Treat the first successful image test on your machine as a
required setup check. Container tags and Python dependencies in this GPU recipe
are not fully locked by digest; it is not a reproducible GPU environment guarantee.

Model source and usage: [Black Forest Labs' model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B).
