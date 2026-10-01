# vLLM-Omni on DGX Spark (GB10 / sm_121a / aarch64).
#
# Base is a community vLLM build compiled for sm_121a on the CUDA 13 track.
# Stock vllm/vllm-openai images compile kernels only through sm_120 and will not
# run here. The base tag must match vllm-omni's required vLLM version exactly --
# vllm-omni is a plugin on top of vLLM, not a fork.
ARG OMNI_BASE_IMAGE=timothystewart6/vllm-gb10:v0.28.0-gb10.2
FROM ${OMNI_BASE_IMAGE}

ARG VLLM_OMNI_VERSION=0.28.0rc1

# vllm-omni declares fa3-fwd as an unconditional dependency, but that package
# publishes x86_64 wheels only, so a plain `pip install vllm-omni` cannot resolve
# on aarch64. This is upstream issue vllm-project/vllm-omni#1121.
#
# Every fa3_fwd_interface import in the package is wrapped in try/except with a
# None fallback (see vllm_omni/diffusion/attention/backends/), so the dependency
# is hard at resolution time and soft at runtime. Installing the package with
# --no-deps and its real dependencies separately therefore works: attention falls
# back to a non-FA3 backend, which is correct on GB10 regardless -- FA3 targets
# Hopper.
#
# The wheel itself is py3-none-any, so nothing needs compiling for aarch64.
#
# torchao is not in vllm-omni's dependency list but is required to load FP8
# diffusers checkpoints whose config carries a TorchAoConfig block: without
# >=0.15.0 startup aborts with "TorchAoConfig requires torchao >= 0.15.0 for
# construction from dict". Its wheel is py3-none-any, so aarch64 is fine.
RUN pip install --no-cache-dir --no-deps "vllm-omni==${VLLM_OMNI_VERSION}" \
 && pip install --no-cache-dir \
      'transformers<5.15,>=5.10.1' \
      'av>=14.0.0' \
      'omegaconf>=2.3.0' \
      'diffusers==0.40.0' \
      'safetensors>=0.8.0' \
      'accelerate==1.12.0' \
      'soundfile>=0.13.1' \
      'cache-dit==1.5.0' \
      'tqdm>=4.66.0' \
      'torchsde>=0.2.6' \
      'imageio[ffmpeg]>=2.37.2' \
      'x-transformers>=2.12.2' \
      'einops>=0.8.1' \
      'prettytable>=3.8.0' \
      'aenum==3.1.16' \
      'pyzmq>=25.0.0' \
      'janus>=1.0.0' \
      'msgpack>=1.0.0' \
      'pydantic>=2.1.0' \
      'pydantic-settings>=2.0.0' \
      'gguf>=0.10.0' \
      'onnxruntime>=1.23.2' \
      'torchao>=0.15.0'

# Fail the build rather than the first request if the plugin cannot import.
RUN python3 -c "import vllm_omni; print('vllm-omni', vllm_omni.__version__ if hasattr(vllm_omni,'__version__') else '${VLLM_OMNI_VERSION}')"

WORKDIR /workspace

COPY start-omni.sh /usr/local/bin/start-omni
RUN chmod +x /usr/local/bin/start-omni

ENTRYPOINT []

# 0.28.0rc1 omits klein from the serving capability table despite its native
# multi-reference implementation. Keep the admission limit model-specific.
COPY scripts/patch-flux-reference-limit.py /tmp/patch-flux-reference-limit.py
RUN python3 /tmp/patch-flux-reference-limit.py \
 && rm /tmp/patch-flux-reference-limit.py
