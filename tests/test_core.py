import io
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from app import images, prompts
from app.store import Store


def picture(size=(80, 40), color=(70, 80, 90)):
    stream = io.BytesIO()
    Image.new("RGB", size, color).save(stream, "PNG")
    return stream.getvalue()


class CoreTests(unittest.TestCase):
    def test_framing_and_result_contract(self):
        data, transform = images.prepare(picture())
        self.assertEqual(transform["content"], [0, 256, 1024, 512])
        self.assertEqual(images.decode(images.unpad(data, transform["content"])).size, (1024, 512))
        with self.assertRaisesRegex(ValueError, "dimensions"):
            images.output(picture(), transform)
        with self.assertRaises(ValueError):
            images.prepare(picture(), [79, 0, 10, 10])

    def test_invalid_and_animated_upload(self):
        with self.assertRaises(ValueError):
            images.decode(b"not an image")
        stream = io.BytesIO()
        Image.new("RGB", (10, 10), "red").save(stream, "GIF", save_all=True,
            append_images=[Image.new("RGB", (10, 10), "blue")])
        with self.assertRaisesRegex(ValueError, "Animated"):
            images.decode(stream.getvalue())

    def test_all_prompt_variants_and_reference_numbering(self):
        for count in range(4):
            for preset in prompts.ACTIONS:
                for clean in (False, True):
                    prompt = prompts.build(preset, count, clean)
                    self.assertIn("image 1", prompt)
                    if count:
                        self.assertIn(prompts.image_list(count), prompt)
            self.assertLessEqual(len(prompts.build_crisp(count)), prompts.MAX_PROMPT_CHARS)
        with self.assertRaises(ValueError):
            prompts.build("invented", 0)

    def test_local_store_and_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            key = store.create("photos")
            value = {"id": key, "created": 1}
            store.save("photos", value)
            self.assertEqual(store.get("photos", key), value)
            self.assertEqual(store.list("photos"), [value])
            with self.assertRaises(ValueError):
                store.path("photos", "../settings")
            self.assertEqual((Path(root) / "photos" / key / "meta.json").stat().st_mode & 0o777, 0o600)
