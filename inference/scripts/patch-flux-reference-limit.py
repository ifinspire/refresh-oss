"""Declare the native klein pipeline's four-reference API contract.

vLLM-Omni 0.28.0rc1 handles lists in Flux2KleinPipeline.forward, but omits
its serving metadata, making /v1/images/edits reject more than one image.
Fail on upstream drift rather than silently overriding a future declaration.
"""
from importlib.metadata import distribution
from pathlib import Path
import runpy

path = Path(distribution("vllm-omni").locate_file("vllm_omni/diffusion/model_metadata.py"))
source = path.read_text()
namespace = runpy.run_path(str(path))
registry = namespace["_DIFFUSION_MODEL_METADATA"]
name = "Flux2KleinPipeline"
if name not in registry:
    anchor = "_DIFFUSION_MODEL_METADATA: dict[str, DiffusionModelMetadata] = {\n"
    if source.count(anchor) != 1:
        raise RuntimeError("vLLM-Omni metadata layout changed; review the klein patch")
    source = source.replace(anchor, anchor + '''    "Flux2KleinPipeline": DiffusionModelMetadata(
        supports_multimodal_inputs=True,
        max_multimodal_image_inputs=4,
    ),
''', 1)
    path.write_text(source)
metadata = runpy.run_path(str(path))["_DIFFUSION_MODEL_METADATA"][name]
if not metadata.supports_multimodal_inputs or metadata.max_multimodal_image_inputs != 4:
    raise RuntimeError("Upstream klein reference limit changed; review the local contract")
print("Flux2KleinPipeline: up to four reference images enabled")
