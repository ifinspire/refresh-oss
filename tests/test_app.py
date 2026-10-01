import asyncio
import base64
import io
import tempfile
import time
import unittest
from unittest.mock import patch
import httpx
from PIL import Image
from fastapi.testclient import TestClient
from app import inference
from app.main import Engine, create_app
from test_core import picture

HEADERS = {"x-refresh-request": "1", "origin": "http://localhost:7520"}


class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.client = TestClient(create_app(self.temp.name), base_url="http://localhost:7520", headers=HEADERS)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def upload(self):
        response = self.client.post("/api/photos?name=test.png", content=picture())
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def wait_job(self):
        for _ in range(150):
            job = self.client.get("/api/jobs").json()[0]
            if job["status"] not in ("running", "queued"):
                return job
            time.sleep(.02)
        self.fail("Job did not finish")

    def test_settings_secret_and_boundary(self):
        response = self.client.put("/api/settings", json={"base_url": "http://omni:8000/v1", "model": "test", "api_key": "test-private-value"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("test-private-value", response.text)
        self.assertTrue(response.json()["has_api_key"])
        self.client.put("/api/settings", json={"base_url": "http://omni:8000/v1", "model": "changed"})
        self.assertTrue(self.client.get("/api/settings").json()["has_api_key"])
        bad = self.client.put("/api/settings", json={"base_url": "http://user:test-private-value@server", "model": "test"})
        self.assertEqual(bad.status_code, 422)
        self.assertNotIn("test-private-value", bad.text)
        self.assertEqual(self.client.post("/api/photos", headers={"origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(self.client.get("/api/settings", headers={"host": "evil.example"}).status_code, 403)

    def test_real_job_pipeline_with_fake_provider_and_refinement(self):
        key = self.upload()
        calls = []
        async def provider(config, spec, inputs):
            calls.append((spec.copy(), inputs))
            return inputs[0]
        with patch("app.inference.generate", provider):
            response = self.client.post("/api/jobs", json={"photo_id": key})
            self.assertEqual(response.status_code, 202, response.text)
            job = self.wait_job()
            self.assertEqual(job["status"], "complete", job)
            self.assertEqual(set(job["results"]), {"natural", "balanced", "reimagined"})
            self.assertIn("clean up lines", calls[1][0]["prompt"])
            result = self.client.get(f'/api/jobs/{job["id"]}/natural.webp?download=true')
            self.assertEqual(Image.open(io.BytesIO(result.content)).size, (1024, 512))
            self.client.post("/api/jobs", json={"photo_id": key, "parent_id": job["id"], "parent_mode": "natural"})
            refined = self.wait_job()
            self.assertEqual(refined["status"], "complete", refined)
            self.assertEqual(refined["results"]["natural"]["prompt"], job["results"]["natural"]["prompt"])
            self.assertEqual(self.client.delete(f'/api/jobs/{job["id"]}').status_code, 200)
            self.assertEqual(self.client.get(f'/api/jobs/{refined["id"]}/natural.webp').status_code, 200)
        self.assertEqual(self.client.delete(f"/api/photos/{key}").status_code, 200)
        self.assertEqual(self.client.get("/api/jobs").json(), [])

    def test_uncertain_completion_blocks_until_acknowledged(self):
        key = self.upload()
        async def uncertain(*args):
            raise inference.InferenceError("Connection interrupted", True)
        with patch("app.inference.generate", uncertain):
            self.client.post("/api/jobs", json={"photo_id": key})
            job = self.wait_job()
        self.assertEqual(job["status"], "uncertain")
        self.assertEqual(self.client.post("/api/jobs", json={"photo_id": key}).status_code, 409)
        self.assertEqual(self.client.delete(f"/api/photos/{key}").status_code, 409)
        self.assertEqual(self.client.post(f'/api/jobs/{job["id"]}/acknowledge').status_code, 200)

    def test_reference_order_crop_and_partial_results(self):
        key, reference = self.upload(), self.upload()
        seen = []
        async def provider(config, spec, inputs):
            seen.append(spec["mode"])
            self.assertEqual(len(inputs), 2)
            self.assertIn("Image 2", spec["prompt"])
            if spec["mode"] == "natural":
                raise inference.InferenceError("Model rejected this image.")
            return inputs[0]
        with patch("app.inference.generate", provider):
            response = self.client.post("/api/jobs", json={"photo_id": key, "references": [reference], "crop": [10, 5, 30, 30]})
            self.assertEqual(response.status_code, 202)
            job = self.wait_job()
        self.assertEqual(job["status"], "partial")
        self.assertEqual(seen, ["natural", "reimagined"])
        self.assertEqual(job["steps"][1]["status"], "skipped")
        self.assertEqual(job["results"]["reimagined"]["transform"]["crop"], [10, 5, 30, 30])
        anchor = self.client.get(f'/api/jobs/{job["id"]}/anchor.png')
        self.assertEqual(Image.open(io.BytesIO(anchor.content)).size, (1024, 1024))
        self.assertEqual(self.client.delete(f"/api/photos/{reference}").status_code, 200)
        self.assertEqual(self.client.get("/api/jobs").json(), [])

    def test_wrong_size_never_becomes_a_successful_result(self):
        key = self.upload()
        async def provider(*args):
            return picture((10, 10))
        with patch("app.inference.generate", provider):
            self.client.post("/api/jobs", json={"photo_id": key})
            job = self.wait_job()
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["results"], {})
        self.assertIn("dimensions", job["steps"][0]["error"])

    def test_restart_never_retries_gpu_work(self):
        store = self.client.app.state.engine.store
        key = store.create("jobs")
        store.save("jobs", {"id": key, "created": 1, "status": "running"})
        restarted = Engine(self.temp.name)
        self.assertEqual(restarted.store.get("jobs", key)["status"], "uncertain")
        self.assertTrue(restarted.blocked())

    def test_invalid_image_and_path(self):
        self.assertEqual(self.client.post("/api/photos", content=b"invalid").status_code, 400)
        self.assertEqual(self.client.get("/api/photos/not-an-id/original").status_code, 400)


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_multipart_fields_and_output_validation(self):
        actual = httpx.AsyncClient
        def provider(request):
            self.assertEqual(request.url.path, "/v1/images/edits")
            body = request.content
            for field in (b'name="image"', b'name="seed"', b'name="guidance_scale"', b'name="num_inference_steps"'):
                self.assertIn(field, body)
            self.assertEqual(request.headers["authorization"], "Bearer local-test")
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(picture()).decode()}]})
        transport = httpx.MockTransport(provider)
        with patch("app.inference.httpx.AsyncClient", side_effect=lambda **kw: actual(transport=transport, **kw)):
            output = await inference.generate({"base_url": "http://omni/v1", "model": "klein", "api_key": "local-test", "timeout": 10},
                                              {"prompt": "keep likeness", "seed": 12}, [picture()])
            self.assertEqual(output, picture())

    async def test_errors_do_not_echo_provider_secrets(self):
        actual = httpx.AsyncClient
        transport = httpx.MockTransport(lambda r: httpx.Response(503, text="private token and hostname"))
        with patch("app.inference.httpx.AsyncClient", side_effect=lambda **kw: actual(transport=transport, **kw)):
            with self.assertRaises(inference.InferenceError) as caught:
                await inference.generate({"base_url": "http://omni/v1", "model": "klein", "timeout": 10},
                                         {"prompt": "test", "seed": 1}, [picture()])
            self.assertTrue(caught.exception.uncertain)
            self.assertNotIn("private", str(caught.exception))
