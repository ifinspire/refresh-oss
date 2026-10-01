"""One local library: regular images and atomic JSON files, no account namespace."""
import json
import os
import re
import tempfile
import uuid
from pathlib import Path


def identifier(value):
    if not re.fullmatch(r"[a-f0-9]{32}", value):
        raise ValueError("Invalid identifier.")
    return value


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        for kind in ("photos", "jobs"):
            (self.root / kind).mkdir(exist_ok=True)

    def path(self, kind, key):
        if kind not in ("photos", "jobs"):
            raise ValueError("Invalid collection.")
        return self.root / kind / identifier(key)

    def create(self, kind):
        key = uuid.uuid4().hex
        self.path(kind, key).mkdir()
        return key

    def write_json(self, path, data):
        fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".write-")
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(data, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def save(self, kind, item):
        self.write_json(self.path(kind, item["id"]) / "meta.json", item)

    def get(self, kind, key):
        return json.loads((self.path(kind, key) / "meta.json").read_text())

    def list(self, kind):
        return sorted((json.loads(p.read_text()) for p in (self.root / kind).glob("*/meta.json")),
                      key=lambda item: item["created"], reverse=True)
