"""Single-user self-hosted app. Exactly one process owns the local job queue."""
import asyncio
from contextlib import asynccontextmanager
import json
import logging
import os
from pathlib import Path
import secrets
import shutil
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import images, inference, prompts
from .store import Store, identifier

log = logging.getLogger("refresh")
WEB = Path(__file__).resolve().parent.parent / "web"
DEFAULTS = {"base_url": "http://omni:8000/v1", "model": "black-forest-labs/FLUX.2-klein-4B",
            "api_key": "", "timeout": 600}


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str = Field(max_length=2048)
    model: str = Field(min_length=1, max_length=200)
    api_key: str | None = Field(default=None, max_length=4096)
    timeout: int = Field(default=600, ge=10, le=1800)

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        url = urlsplit(value)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("Use an HTTP(S) base URL without credentials, query or fragment.")
        try:
            url.port
        except ValueError:
            raise ValueError("Use a valid server port.") from None
        return value.rstrip("/")

    @field_validator("api_key", "model")
    @classmethod
    def no_control_chars(cls, value):
        if value is not None and any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Control characters are not allowed.")
        return value


class Generation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    photo_id: str
    references: list[str] = Field(default_factory=list, max_length=3)
    crop: list[int] | None = Field(default=None, min_length=4, max_length=4)
    preset: str = "unblur"
    parent_id: str | None = None
    parent_mode: str | None = None


class Engine:
    def __init__(self, root):
        self.store = Store(root)
        self.busy = False
        self.tasks = set()
        # A stopped client cannot know whether external GPU work completed.
        for job in self.store.list("jobs"):
            if job["status"] in ("queued", "running"):
                job.update(status="uncertain", error="App restarted during inference. Check that the backend is idle, then acknowledge before retrying.")
                self.store.save("jobs", job)

    def config(self):
        path = self.store.root / "settings.json"
        return json.loads(path.read_text()) if path.exists() else DEFAULTS.copy()

    def blocked(self):
        return self.busy or any(j["status"] == "uncertain" for j in self.store.list("jobs"))

    def submit(self, spec, verification=False):
        if self.blocked():
            raise HTTPException(409, "Inference is busy or a previous completion is uncertain. Check the job details.")
        photo = self.store.get("photos", spec.photo_id)
        refs = [self.store.get("photos", key) for key in spec.references]
        if spec.preset not in prompts.ACTIONS:
            raise ValueError("Unknown reconstruction preset.")
        if spec.crop is not None:
            images.prepare((self.store.path("photos", photo["id"]) / "original").read_bytes(), spec.crop)
        parent = None
        if spec.parent_id:
            parent = self.store.get("jobs", spec.parent_id)
            if parent["photo_id"] != spec.photo_id or spec.parent_mode not in parent["results"]:
                raise ValueError("Choose a completed result from this photo.")
            if parent["status"] in ("queued", "running", "uncertain"):
                raise ValueError("Wait for the parent job to finish.")
            spec.references = parent["references"]
            refs = [self.store.get("photos", key) for key in spec.references]
            spec.crop = parent["crop"]
            spec.preset = parent["preset"]
        key = self.store.create("jobs")
        job = dict(id=key, created=time.time(), status="queued", kind="verification" if verification else "reconstruction",
                   **spec.model_dump(), results={}, steps=[], error=None)
        self.store.save("jobs", job)
        config = self.config()
        self.busy = True
        task = asyncio.create_task(self.run(job, config, parent))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return job

    async def run(self, job, config, parent):
        directory = self.store.path("jobs", job["id"])
        try:
            job["status"] = "running"
            job["started"] = time.time()
            self.store.save("jobs", job)
            original = (self.store.path("photos", job["photo_id"]) / "original").read_bytes()
            anchor, transform = await asyncio.to_thread(images.prepare, original, job["crop"])
            (directory / "anchor.png").write_bytes(anchor)
            refs = []
            for index, key in enumerate(job["references"]):
                data, _ = await asyncio.to_thread(images.prepare, (self.store.path("photos", key) / "original").read_bytes())
                refs.append(data)
                (directory / f"reference-{index+1}.png").write_bytes(data)
            modes = [job["parent_mode"]] if parent else (["natural"] if job["kind"] == "verification" else ["natural", "balanced", "reimagined"])
            natural = None
            for mode in modes:
                if mode == "balanced" and not parent and natural is None:
                    job["steps"].append({"mode": mode, "status": "skipped", "error": "Natural did not complete."})
                    continue
                if parent:
                    saved = parent["results"][mode]
                    prompt, version = saved["prompt"], saved["prompt_version"]
                    source, _ = images.prepare((self.store.path("jobs", parent["id"]) / f"{mode}.webp").read_bytes())
                else:
                    prompt = prompts.build_crisp(len(refs)) if mode == "reimagined" else prompts.build(job["preset"], len(refs), mode == "balanced")
                    version = {"natural": prompts.VERSION, "balanced": prompts.BALANCED_VERSION, "reimagined": prompts.CRISP_VERSION}[mode]
                    source = natural if mode == "balanced" else anchor
                spec = dict(mode=mode, prompt=prompt, prompt_version=version, seed=secrets.randbelow(2**32),
                            model=config["model"], inference_size=1024, num_inference_steps=4,
                            guidance_scale=1.0, transform=transform, tone_anchor=images.TONE_ANCHOR,
                            status="running", started=time.time())
                job["steps"].append(spec)
                self.store.save("jobs", job)
                (directory / f"{mode}-input.png").write_bytes(source)
                log.info("job=%s mode=%s started", job["id"], mode)
                try:
                    raw = await inference.generate(config, spec, [source, *refs])
                    output = await asyncio.to_thread(images.output, raw, transform)
                    output = await asyncio.to_thread(images.anchor_tone, output, anchor, transform["content"])
                    if mode == "natural":
                        natural = output
                    result = images.stored_result(images.unpad(output, transform["content"]))
                    (directory / f"{mode}.webp").write_bytes(result)
                    spec.update(status="complete", elapsed=round(time.time()-spec["started"], 2))
                    job["results"][mode] = spec.copy()
                except (inference.InferenceError, ValueError) as exc:
                    spec.update(status="failed", error=str(exc), elapsed=round(time.time()-spec["started"], 2))
                    if getattr(exc, "uncertain", False):
                        job.update(status="uncertain", error=str(exc))
                        break
                self.store.save("jobs", job)
            if job["status"] != "uncertain":
                job["status"] = "complete" if len(job["results"]) == len(modes) else "partial" if job["results"] else "failed"
        except asyncio.CancelledError:
            job.update(status="uncertain", error="App stopped during inference. Check the backend before retrying.")
            raise
        except Exception:
            # Never leak settings, tokens, provider bodies or arbitrary exception strings.
            job.update(status="failed", error="Local processing failed. Check image files and available disk space.")
            log.error("job=%s local processing failed", job["id"])
        finally:
            job["finished"] = time.time()
            self.store.save("jobs", job)
            self.busy = False
            log.info("job=%s status=%s", job["id"], job["status"])


def create_app(root=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.engine = Engine(root or os.environ.get("DATA_DIR", "/data"))
        yield
        tasks = list(app.state.engine.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    app = FastAPI(title="refresh — self hosted", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    origins = {url.strip().rstrip("/") for url in os.environ.get("ALLOWED_ORIGINS", "http://localhost:7520,http://127.0.0.1:7520").split(",")}
    hosts = {urlsplit(url).netloc for url in origins} | {"localhost:8080"}

    @app.middleware("http")
    async def local_boundary(request, call_next):
        if request.headers.get("host") not in hosts:
            return JSONResponse({"detail": "Host not allowed. Configure ALLOWED_ORIGINS."}, 403)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if (origin and origin not in origins) or request.headers.get("x-refresh-request") != "1":
                return JSONResponse({"detail": "Request origin or local request header rejected."}, 403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, 400)

    @app.exception_handler(FileNotFoundError)
    async def missing(request, exc):
        return JSONResponse({"detail": "That local file no longer exists."}, 404)

    # Pydantic errors normally include submitted values, which could contain API keys.
    from fastapi.exceptions import RequestValidationError
    @app.exception_handler(RequestValidationError)
    async def validation(request, exc):
        return JSONResponse({"detail": "Invalid settings or request fields. Check their format and limits."}, 422)

    def engine():
        return app.state.engine

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/settings")
    def settings():
        config = engine().config()
        return {k: v for k, v in config.items() if k != "api_key"} | {"has_api_key": bool(config["api_key"])}

    @app.put("/api/settings")
    async def save_settings(value: Settings):
        if engine().blocked():
            raise HTTPException(409, "Wait for inference or acknowledge uncertain work before changing settings.")
        config = value.model_dump()
        if config["api_key"] is None:
            config["api_key"] = engine().config()["api_key"]
        engine().store.write_json(engine().store.root / "settings.json", config)
        return settings()

    @app.post("/api/settings/check")
    async def check():
        config = engine().config()
        try:
            names = await inference.models(config)
            return {"available": config["model"] in names,
                    "detail": "Model is listed; run the image test to verify editing." if config["model"] in names else "Configured model is not listed by this server."}
        except inference.InferenceError as exc:
            return JSONResponse({"available": False, "detail": str(exc)}, 502)

    @app.get("/api/prompts")
    def prompt_preview(preset: str = "unblur", references: int = 0):
        return {"natural": prompts.build(preset, references), "balanced": prompts.build(preset, references, True),
                "reimagined": prompts.build_crisp(references)}

    @app.get("/api/photos")
    def photos():
        return engine().store.list("photos")

    def import_photo(data, name):
        decoded = images.decode(data)
        key = engine().store.create("photos")
        directory = engine().store.path("photos", key)
        try:
            (directory / "original").write_bytes(data)
            preview = decoded.copy()
            preview.thumbnail((1024, 1024), images.Image.Resampling.LANCZOS)
            (directory / "preview.png").write_bytes(images.png(preview))
            (directory / "thumbnail.jpg").write_bytes(images.thumbnail(decoded))
            photo = dict(id=key, name=name[:160], created=time.time(), width=decoded.width, height=decoded.height)
            engine().store.save("photos", photo)
            return photo
        except Exception:
            shutil.rmtree(directory)
            raise

    @app.post("/api/photos", status_code=201)
    async def upload(request: Request, name: str = "Photo"):
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > images.MAX_BYTES:
                raise HTTPException(413, "Photos can be at most 20 MB.")
        return await asyncio.to_thread(import_photo, bytes(data), name)

    @app.get("/api/examples")
    def examples():
        return json.loads((WEB / "examples" / "sources.json").read_text())

    @app.post("/api/examples/{name}", status_code=201)
    def example(name: str):
        if name not in ("man", "girl", "woman", "elder", "youth"):
            raise HTTPException(404)
        return import_photo((WEB / "examples" / f"{name}-before.webp").read_bytes(), f"Demo — {name}")

    @app.post("/api/settings/verify", status_code=202)
    async def verify():
        if engine().blocked():
            raise HTTPException(409, "Inference is busy or needs acknowledgement.")
        photo = example("man")
        return engine().submit(Generation(photo_id=photo["id"]), verification=True)

    @app.get("/api/photos/{key}/{kind}")
    def photo_file(key: str, kind: str):
        allowed = {"original": ("application/octet-stream", "original"), "preview.png": ("image/png", None), "thumbnail.jpg": ("image/jpeg", None)}
        if kind not in allowed:
            raise HTTPException(404)
        path = engine().store.path("photos", key) / kind
        if not path.is_file():
            raise HTTPException(404)
        media, filename = allowed[kind]
        return FileResponse(path, media_type=media, filename=filename)

    @app.delete("/api/photos/{key}")
    async def delete_photo(key: str):
        engine().store.get("photos", key)
        affected = [j for j in engine().store.list("jobs") if key == j["photo_id"] or key in j["references"]]
        if any(j["status"] in ("queued", "running", "uncertain") for j in affected):
            raise HTTPException(409, "Photo is in use by pending inference.")
        for job in affected:
            shutil.rmtree(engine().store.path("jobs", job["id"]))
        shutil.rmtree(engine().store.path("photos", key))
        return {"deleted_jobs": len(affected)}

    @app.get("/api/jobs")
    def jobs():
        return engine().store.list("jobs")

    @app.post("/api/jobs", status_code=202)
    async def generate(value: Generation):
        return engine().submit(value)

    @app.post("/api/jobs/{key}/acknowledge")
    async def acknowledge(key: str):
        job = engine().store.get("jobs", key)
        if job["status"] != "uncertain":
            raise HTTPException(409, "Only uncertain jobs need acknowledgement.")
        job.update(status="partial" if job["results"] else "failed", acknowledged=time.time())
        engine().store.save("jobs", job)
        return job

    @app.delete("/api/jobs/{key}")
    async def delete_job(key: str):
        job = engine().store.get("jobs", key)
        if job["status"] in ("queued", "running", "uncertain"):
            raise HTTPException(409, "Job is still pending.")
        shutil.rmtree(engine().store.path("jobs", key))
        return {"deleted": True}

    @app.get("/api/jobs/{key}/anchor.png")
    def anchor_file(key: str):
        job = engine().store.get("jobs", key)
        completed = next(iter(job["results"].values()), None)
        if not completed:
            raise HTTPException(404)
        data = (engine().store.path("jobs", key) / "anchor.png").read_bytes()
        return Response(images.unpad(data, completed["transform"]["content"]), media_type="image/png")

    @app.get("/api/jobs/{key}/{mode}.webp")
    def result(key: str, mode: str, download: bool = False):
        job = engine().store.get("jobs", key)
        if mode not in job["results"] or mode not in ("natural", "balanced", "reimagined"):
            raise HTTPException(404)
        path = engine().store.path("jobs", key) / f"{mode}.webp"
        if download:
            return Response(images.as_png(path.read_bytes()), media_type="image/png",
                            headers={"Content-Disposition": f'attachment; filename="refresh-{mode}.png"'})
        return FileResponse(path, media_type="image/webp")

    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
    return app


app = create_app()
