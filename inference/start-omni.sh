#!/usr/bin/env bash
set -euo pipefail
args=(vllm serve "${OMNI_MODEL:-black-forest-labs/FLUX.2-klein-4B}"
  --omni --host 0.0.0.0 --port 8000
  --served-model-name "${OMNI_MODEL:-black-forest-labs/FLUX.2-klein-4B}"
  --max-num-seqs 1 --gpu-memory-utilization "${OMNI_GPU_MEMORY_UTILIZATION:-0.22}")
# Keep the native Klein pipeline. The app supplies four steps and guidance 1.0.
# Remote Python code is not enabled. Do not add --trust-remote-code casually.
exec "${args[@]}"
