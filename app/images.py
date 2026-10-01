"""Deterministic, metadata-free sRGB preparation in oriented source coordinates."""

import io
import math
import warnings
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()  # HEIC/HEIF from phones; opens the primary image.

SIZE = 1024
# Stored results are high-quality WebP (about 5x smaller than PNG); downloads are converted to PNG.
RESULT_WEBP_QUALITY = 92
MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 50_000_000
GRAY = (128, 128, 128)
VERSION = "srgb-square-v1"
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
PROFILE = SRGB.tobytes()
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
NAMES = "JPEG, PNG, HEIC, WebP, AVIF, TIFF, BMP or GIF"
# Stills whose extra frames are depth maps, bursts or pages: use the primary one.
STILLS = {"JPEG", "MPO", "HEIF", "TIFF", "BMP"}
# Formats where several frames mean animation.
ANIMATED = {"PNG", "GIF", "WEBP", "AVIF"}
TOO_LARGE = "Photos can be at most 50 megapixels. Resize this one and try again."


def decode(data: bytes) -> Image.Image:
    if len(data) > MAX_BYTES:
        raise ValueError("This photo is over 20 MB. Choose a smaller copy.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                image = Image.open(io.BytesIO(data))
            except UnidentifiedImageError:
                raise ValueError(
                    f"This file isn't an image we can read. Choose a {NAMES} photo."
                ) from None
            except (Image.DecompressionBombError, Image.DecompressionBombWarning):
                raise ValueError(TOO_LARGE) from None
            if image.format not in STILLS | ANIMATED:
                raise ValueError(
                    f"{image.format} files aren't supported. Choose a {NAMES} photo."
                )
            if image.format in ANIMATED and getattr(image, "n_frames", 1) != 1:
                raise ValueError(
                    "Animated images aren't supported. Choose a still photo."
                )
            if image.width * image.height > MAX_PIXELS:
                raise ValueError(TOO_LARGE)
            image.load()
        image = ImageOps.exif_transpose(image)
        profile = image.info.get("icc_profile")
        if image.mode.startswith("I;16") or image.mode == "I":
            # 16-bit grayscale (PNG/TIFF): keep the top eight bits.
            image = image.convert("I").point(lambda v: v / 256).convert("L")
        if image.mode not in ("RGB", "RGBA", "RGBX", "L", "LA", "P", "PA", "1", "CMYK"):
            raise ValueError(
                "This photo's colors can't be read. Save it again as a JPEG or PNG and try again."
            )
        alpha = (
            image.convert("RGBA").getchannel("A")
            if image.mode in ("RGBA", "LA", "P", "PA")
            else None
        )
        if profile:
            source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
            color = (
                image if image.mode in ("RGB", "L", "CMYK") else image.convert("RGB")
            )
            image = ImageCms.profileToProfile(color, source, SRGB, outputMode="RGB")
        else:
            if image.mode == "CMYK":
                raise ValueError(
                    "This photo's colors can't be read. Save it again as a JPEG or PNG and try again."
                )
            image = image.convert(
                "RGB"
            )  # documented sRGB assumption for untagged RGB/gray/palette
        if alpha is not None:
            background = Image.new("RGB", image.size, GRAY)
            background.paste(image, mask=alpha)
            image = background
        return image
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(
            "The image or its embedded color profile cannot be read. Export a valid sRGB JPEG or PNG."
        ) from exc


def png(image: Image.Image) -> bytes:
    clean = Image.new("RGB", image.size)
    clean.paste(image)
    stream = io.BytesIO()
    clean.save(stream, format="PNG", icc_profile=PROFILE)
    return stream.getvalue()


def thumbnail(image: Image.Image) -> bytes:
    """Small display derivative; never used as an inference input."""
    small = image.copy()
    small.thumbnail((256, 256), Image.Resampling.LANCZOS)
    square = Image.new("RGB", (256, 256), GRAY)
    square.paste(small, ((256 - small.width) // 2, (256 - small.height) // 2))
    stream = io.BytesIO()
    square.save(stream, format="JPEG", quality=80, optimize=True)
    return stream.getvalue()


def prepare(
    data: bytes, crop: list[int] | None = None, size: int = SIZE
) -> tuple[bytes, dict]:
    if size not in (512, 1024):
        raise ValueError("Unsupported working image size.")
    image = decode(data)
    width, height = image.size
    if crop is not None:
        if len(crop) != 4 or any(type(x) is not int for x in crop):
            raise ValueError("Crop coordinates must be four integers.")
        x, y, w, h = crop
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
            raise ValueError("Choose a crop entirely inside the photograph.")
        image = image.crop((x, y, x + w, y + h))
    else:
        x, y, w, h = 0, 0, width, height
    scale = size / max(w, h)
    # Round halves upward, once; odd padding's extra pixel is on right/bottom.
    rw, rh = max(1, math.floor(w * scale + 0.5)), max(1, math.floor(h * scale + 0.5))
    left, top = (size - rw) // 2, (size - rh) // 2
    result = Image.new("RGB", (size, size), GRAY)
    result.paste(image.resize((rw, rh), Image.Resampling.LANCZOS), (left, top))
    return png(result), {
        "version": VERSION,
        "working_size": size,
        "source_size": [width, height],
        "crop": [x, y, w, h],
        "scale": scale,
        "content": [left, top, rw, rh],
    }


def output(data: bytes, transform: dict) -> bytes:
    image = decode(data)  # Untagged vLLM output is explicitly assumed SDR sRGB.
    size = transform.get("working_size", SIZE)
    if size not in (512, 1024) or image.size != (size, size):
        raise ValueError(
            f"Inference returned the wrong dimensions; expected {size} × {size}."
        )
    x, y, w, h = transform["content"]
    result = Image.new("RGB", (size, size), GRAY)
    result.paste(image.crop((x, y, x + w, y + h)), (x, y))
    return png(result)


def unpad(data: bytes, content: list[int]) -> bytes:
    image = decode(data)
    x, y, w, h = content
    if (
        x < 0
        or y < 0
        or w <= 0
        or h <= 0
        or x + w > image.width
        or y + h > image.height
    ):
        raise ValueError(
            "The saved photo framing is invalid. Prepare the original again."
        )
    return png(image.crop((x, y, x + w, y + h)))


TONE_ANCHOR = "lab-global-v2"
_LAB = ImageCms.createProfile("LAB")
_TO_LAB = ImageCms.buildTransform(SRGB, _LAB, "RGB", "LAB")
_FROM_LAB = ImageCms.buildTransform(_LAB, SRGB, "LAB", "RGB")


def _decode_lab(index: int, band: int) -> int:
    # Pillow stores a* and b* offset by 128 (128 is neutral).
    return index if band == 0 else index - 128


def _band_stats(band: Image.Image, index: int) -> tuple[float, float]:
    counts = band.histogram()
    total = sum(counts) or 1
    values = [_decode_lab(i, index) for i in range(256)]
    mean = sum(v * c for v, c in zip(values, counts)) / total
    variance = sum((v - mean) ** 2 * c for v, c in zip(values, counts)) / total
    return mean, math.sqrt(variance)


def anchor_tone(data: bytes, anchor: bytes, content: list[int]) -> bytes:
    """Match the result's overall tone and color to the original photo inside its content area.

    The model tends to brighten faces, lighten skin and invent color, and repeated
    refinement compounds it. A global per-channel Lab match removes that drift without
    touching local detail: brightness and color follow the original, but contrast is
    never reduced, so the model's added crispness is kept. Padding stays neutral.
    """
    x, y, w, h = content
    box = (x, y, x + w, y + h)
    result = Image.open(io.BytesIO(data)).convert("RGB")
    reference = Image.open(io.BytesIO(anchor)).convert("RGB")
    if result.size != reference.size:
        reference = reference.resize(result.size, Image.Resampling.LANCZOS)
    source = ImageCms.applyTransform(result.crop(box), _TO_LAB)
    target = ImageCms.applyTransform(reference.crop(box), _TO_LAB)
    bands = []
    for index, (band, ref) in enumerate(zip(source.split(), target.split())):
        mean, std = _band_stats(band, index)
        ref_mean, ref_std = _band_stats(ref, index)
        # Never amplify contrast or color by more than 2x; a monochrome original removes color.
        scale = min(2.0, ref_std / std) if std > 1 else 1.0
        if index == 0:
            scale = max(
                1.0, scale
            )  # keep sharper contrast; only restore a flattened one
        low, high = (0, 255) if index == 0 else (-128, 127)
        table = []
        for i in range(256):
            value = (_decode_lab(i, index) - mean) * scale + ref_mean
            value = max(low, min(high, round(value)))
            table.append(value if index == 0 else value + 128)
        bands.append(band.point(table))
    matched = ImageCms.applyTransform(Image.merge("LAB", bands), _FROM_LAB)
    result.paste(matched, (x, y))
    return png(result)


def is_webp(data: bytes) -> bool:
    return data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def stored_result(data: bytes) -> bytes:
    """Encode a finished result for storage: sRGB WebP at high quality, no metadata."""
    image = Image.open(io.BytesIO(data)).convert("RGB")
    stream = io.BytesIO()
    image.save(
        stream,
        format="WEBP",
        quality=RESULT_WEBP_QUALITY,
        method=4,
        icc_profile=PROFILE,
    )
    return stream.getvalue()


def as_png(data: bytes) -> bytes:
    """PNG for downloads; results stored before WebP are already PNG."""
    return png(Image.open(io.BytesIO(data)).convert("RGB")) if is_webp(data) else data
