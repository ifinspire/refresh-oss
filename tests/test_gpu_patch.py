"""Check that the version-specific patch is idempotent and fails on upstream drift."""
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

SCRIPT = Path(__file__).resolve().parents[1] / 'inference/scripts/patch-flux-reference-limit.py'
HEADER = '''from dataclasses import dataclass
@dataclass
class DiffusionModelMetadata:
    supports_multimodal_inputs: bool
    max_multimodal_image_inputs: int
'''


class PatchTests(unittest.TestCase):
    def test_expected_layout_and_changed_contract(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'metadata.py'
            path.write_text(HEADER + '_DIFFUSION_MODEL_METADATA: dict[str, DiffusionModelMetadata] = {\n}\n')
            with patch('importlib.metadata.distribution', return_value=SimpleNamespace(locate_file=lambda _: path)):
                runpy.run_path(str(SCRIPT))
                once = path.read_text()
                runpy.run_path(str(SCRIPT))
                self.assertEqual(path.read_text(), once)
                path.write_text(once.replace('max_multimodal_image_inputs=4', 'max_multimodal_image_inputs=2'))
                with self.assertRaisesRegex(RuntimeError, 'reference limit changed'):
                    runpy.run_path(str(SCRIPT))
