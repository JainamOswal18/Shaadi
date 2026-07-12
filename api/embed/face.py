"""Shared face-detection + embedding logic.

Single source of truth for turning image bytes into face embeddings, used by
both the live Vercel function (`index.py`) and the local ingest pipeline
(Task 16). Keep all InsightFace/model concerns here so they are never
duplicated.

The model (`buffalo_l`, detection + recognition only) is lazily initialized as a
module global on first use and reused across invocations — on Vercel this means
the ~326MB model loads once per warm container, not per request. Set
``INSIGHTFACE_HOME`` to control where the model pack is cached/loaded from
(defaults to InsightFace's own ``~/.insightface``).
"""

from __future__ import annotations

import io
import os
import threading
import urllib.request

import numpy as np
from PIL import Image

# Lazily-initialized singleton FaceAnalysis app and a lock to make the
# first-call initialization safe under concurrent requests within one container.
_app = None
_app_lock = threading.Lock()

# Only these two ONNX files are needed given
# ``allowed_modules=["detection", "recognition"]`` below (~191MB total) — the
# rest of the buffalo_l pack (landmark/gender-age models, ~326MB unpacked) is
# never loaded, so it isn't worth shipping or downloading. Vercel's CLI caps
# bundled source at 100MB and Vercel's own /tmp is ~512MB, so the full pack
# can't be bundled *or* fully downloaded at cold start — but these two fit
# either way. Sizes are the known-good byte counts of our local copies
# (``api/embed/models/models/buffalo_l/*.onnx``); ensure_models() uses them to
# detect truncated downloads.
_MODEL_FILES = {
    "det_10g.onnx": 16_923_827,
    "w600k_r50.onnx": 174_383_860,
}

# Public R2 bucket ("shaadi-previews") holding just those two files, uploaded
# via `wrangler r2 object put` (see task-18b). Overridable via env in case the
# bucket/domain ever changes.
_DEFAULT_MODEL_BASE_URL = (
    "https://YOUR_R2_PUBLIC_BUCKET.r2.dev/models/buffalo_l"
)


def ensure_models() -> None:
    """Make sure the 2 required buffalo_l ONNX files exist under
    ``<INSIGHTFACE_HOME>/models/buffalo_l/``, downloading any missing/
    truncated ones from R2.

    No-ops when the files are already present with the expected size — this
    is the case locally, where ``.venv``'s ``INSIGHTFACE_HOME`` already points
    at the full model pack checked into ``api/embed/models``.
    """
    root = os.environ.get("INSIGHTFACE_HOME") or os.path.expanduser("~/.insightface")
    model_dir = os.path.join(root, "models", "buffalo_l")
    os.makedirs(model_dir, exist_ok=True)

    base_url = os.environ.get("MODEL_BASE_URL", _DEFAULT_MODEL_BASE_URL)

    for filename, expected_size in _MODEL_FILES.items():
        dest = os.path.join(model_dir, filename)
        if os.path.exists(dest) and os.path.getsize(dest) >= expected_size:
            continue
        url = f"{base_url}/{filename}"
        tmp_dest = dest + ".part"
        urllib.request.urlretrieve(url, tmp_dest)  # noqa: S310 - trusted, fixed R2 URL
        if os.path.getsize(tmp_dest) < expected_size:
            os.remove(tmp_dest)
            raise RuntimeError(
                f"downloaded {filename} is truncated "
                f"({os.path.getsize(tmp_dest) if os.path.exists(tmp_dest) else 0} "
                f"< {expected_size} bytes) from {url}"
            )
        os.replace(tmp_dest, dest)


def _get_app():
    """Return the process-wide FaceAnalysis app, initializing it on first use."""
    global _app
    if _app is not None:
        return _app
    with _app_lock:
        if _app is None:
            # Import here so importing this module (e.g. for the HTTP handler
            # class) doesn't pay the heavy insightface/onnxruntime import cost
            # until a request actually needs the model.
            from insightface.app import FaceAnalysis

            root = os.environ.get("INSIGHTFACE_HOME")
            ensure_models()
            kwargs = {
                "name": "buffalo_l",
                "allowed_modules": ["detection", "recognition"],
            }
            if root:
                # FaceAnalysis looks for models under ``<root>/models/<name>``.
                kwargs["root"] = root
            app = FaceAnalysis(**kwargs)
            # ctx_id=-1 forces CPU (no CUDA on Vercel / typical dev machines).
            app.prepare(ctx_id=-1, det_size=(640, 640))
            _app = app
    return _app


def get_faces(image_bytes: bytes) -> list[dict]:
    """Detect faces in ``image_bytes`` and return their embeddings.

    Returns one dict per detected face::

        {
            "embedding": list[float],   # 512, L2-normalized (unit norm)
            "bbox": [x1, y1, x2, y2],   # floats, pixel coords
            "det_score": float,
        }

    Returns ``[]`` when no faces are detected.
    """
    # PIL decodes to RGB; InsightFace (OpenCV-convention) expects BGR ndarray.
    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    rgb = np.asarray(pil)
    bgr = rgb[:, :, ::-1]  # RGB -> BGR

    faces = _get_app().get(bgr)
    return [
        {
            "embedding": f.normed_embedding.tolist(),
            "bbox": [float(x) for x in f.bbox.tolist()],
            "det_score": float(f.det_score),
        }
        for f in faces
    ]
