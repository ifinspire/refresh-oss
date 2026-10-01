VERSION = "portrait-v2-conservative"
ACTIONS = {
    "unblur": "Reduce blur in image 1 only where the original provides clear visual evidence for the detail. Keep the same photograph and the same person. Prefer residual blur to invented detail.",
    "sharpen": "Apply a very slight clarity improvement to details already visible in image 1. Keep the same photograph and allow softness to remain. Prefer an unchanged detail to an invented one.",
}
PRESERVE = "Keep the head orientation, eye shape, eyelid position, and gaze direction exactly as in image 1. Keep each iris and pupil in its original position relative to the eyelids; do not redirect the eyes toward the camera or center the pupils. If eye detail is ambiguous, leave it soft rather than guessing. Do not add, remove, or strengthen facial marks, moles, freckles, scars, wrinkles, or skin texture. Do not turn blur, noise, shadows, or compression artifacts into skin features. Leave uncertain skin detail soft. Preserve facial proportions, expression, apparent age, hairstyle, clothing, framing, background, depth of field, exposure, white balance, lighting, and skin tone from image 1. Do not beautify, retouch, or redesign the face."


BALANCED_VERSION = "portrait-balanced-v1"
CLEAN_LINES = (
    "Also clean up lines that are already visible in image 1: make the edges of the eyes, eyelids, eyebrows, "
    "lips, nostrils, hairline, jaw and clothing crisper and free of blur halos, smearing or double edges. "
    "Do not add new lines, features or texture that image 1 does not show."
)


def build(preset: str, count: int, clean_lines: bool = False) -> str:
    if preset not in ACTIONS or count not in range(4):
        raise ValueError("Invalid preset or reference count.")
    text = ACTIONS[preset] + (" " + CLEAN_LINES if clean_lines else "") + "\n" + PRESERVE
    if count:
        images = image_list(count) + (" shows" if count == 1 else " show")
        text += f"\n{images} the same person more clearly. Use references only to help identify the person, never as replacement facial detail. Image 1 alone determines head orientation, gaze direction, iris and pupil positions, eyelids, expression, and skin appearance. Do not transfer eye direction, facial marks, skin texture, lighting, or scene details from the references. When a reference conflicts with image 1 or image 1 is ambiguous, preserve image 1 and leave the detail soft."
    return text


CRISP_VERSION = "portrait-reimagined-v3"
CRISP = (
    "Edit image 1 in place on its existing canvas. Keep the exact subject size, position and composition. Preserve all black borders and gray padding at their exact widths. Do not zoom, crop, expand the photograph, fill borders, or move any features.\n"
    "Create a clearly sharper reconstruction of image 1 that remains visually close to the original photograph. Image 1 is the primary source for the person's likeness, facial geometry, expression, gaze, hairstyle, pose, clothing, scene, framing, lighting and color.\n"
    "Reduce blur on the person and reconstruct natural detail within the existing facial shapes and contours. Preserve feature placement, proportions and asymmetries, including the original eye and mouth shapes. Keep the skin's existing appearance and visible distinguishing marks.\n"
    "Use natural photographic sharpness appropriate to the person's size in the frame and the original lighting. Keep fine skin, eyelash, hair and fabric detail understated. Preserve the background's existing softness and the original lighting transitions.\n"
    'Prioritize a recognizable match to image 1 over extra detail or complete removal of every artifact. The result should look like a clearer version of this same photograph, retaining its original photographic character.'
)

MAX_PROMPT_CHARS = 1800  # about 440 tokens at ~4 characters per token


def image_list(count: int) -> str:
    """'Image 2', 'Images 2 and 3', 'Images 2, 3 and 4' for 1-3 clear photos."""
    numbers = [str(n) for n in range(2, count + 2)]
    return "Image 2" if count == 1 else "Images " + ", ".join(numbers[:-1]) + " and " + numbers[-1]


def build_crisp(count: int) -> str:
    if count not in range(4):
        raise ValueError("Invalid reference count.")
    text = CRISP
    if count:
        one = count == 1
        text += (
            f"\n{image_list(count)} {'is a secondary reference' if one else 'are secondary references'} "
            "for this person's stable facial characteristics. "
            f"Use {'it' if one else 'them'} to clarify features obscured by blur while fitting them to "
            "image 1's existing facial geometry, expression and lighting. Details visible in image 1 "
            "take precedence. Keep image 1's eye direction, hairstyle, skin appearance and scene rather "
            f"than replacing them with those from the {'reference' if one else 'references'}."
        )
    return text
