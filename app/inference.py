"""Explicit vLLM-Omni image-edit protocol; never retry uncertain GPU work."""
import base64
import json
import httpx


class InferenceError(Exception):
    def __init__(self, message, uncertain=False):
        super().__init__(message)
        self.uncertain = uncertain


async def request(config, method, route, **kwargs):
    headers = {"Accept": "application/json"}
    if config.get("api_key"):
        headers["Authorization"] = "Bearer " + config["api_key"]
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(config["timeout"], connect=10),
                                     follow_redirects=False) as client:
            async with client.stream(method, config["base_url"].rstrip("/") + route,
                                     headers=headers, **kwargs) as response:
                if response.status_code >= 300:
                    # Provider bodies can echo credentials or infrastructure details.
                    raise InferenceError(f"Inference returned HTTP {response.status_code} for {route}.",
                                         method == "POST" and response.status_code >= 500)
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 30 * 1024 * 1024:
                        raise InferenceError("Inference response exceeds 30 MB.", method == "POST")
        return json.loads(body)
    except InferenceError:
        raise
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise InferenceError("Cannot connect to inference. Check the URL and server.") from None
    except httpx.HTTPError:
        raise InferenceError("Inference connection interrupted. Check the backend before retrying.",
                             method == "POST") from None
    except (ValueError, TypeError):
        raise InferenceError("Inference did not return valid JSON.") from None


async def models(config):
    value = await request(config, "GET", "/models")
    try:
        names = [item["id"] for item in value["data"]]
        if not all(isinstance(name, str) for name in names):
            raise ValueError()
        return names
    except (TypeError, KeyError, ValueError):
        raise InferenceError("Inference returned an invalid model list.") from None


async def generate(config, spec, inputs):
    fields = {"model": config["model"], "prompt": spec["prompt"], "size": "1024x1024",
              "n": "1", "response_format": "b64_json", "output_format": "png",
              "seed": str(spec["seed"]), "num_inference_steps": "4", "guidance_scale": "1.0"}
    value = await request(config, "POST", "/images/edits", data=fields,
                          files=[("image", (f"image-{i+1}.png", data, "image/png"))
                                 for i, data in enumerate(inputs)])
    try:
        if len(value["data"]) != 1 or value["data"][0].get("revised_prompt"):
            raise ValueError()
        result = base64.b64decode(value["data"][0]["b64_json"], validate=True)
        if not result:
            raise ValueError()
        return result
    except (KeyError, TypeError, ValueError):
        raise InferenceError("Inference returned invalid image data or changed the fixed prompt.") from None
