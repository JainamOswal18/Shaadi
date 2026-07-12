"""
Shaadi face-embedding microservice.

A tiny FastAPI wrapper around InsightFace `buffalo_l` (SCRFD detector + ArcFace
recognition, 512-d L2-normalized embeddings) — the SAME model the gallery was
indexed with, so selfie embeddings match the indexed photos.

Why this exists: the embedding model's Python dependencies (~550 MB) exceed
Vercel Hobby's 500 MB serverless-function limit, so face embedding runs here
instead of inside the Next.js app. Deploy this container anywhere (Fly.io,
Hugging Face Spaces, Render, Railway, a VPS), then point the Vercel app at it:

    vercel env add EMBED_FN_URL production   # e.g. https://<this-service>/api/embed

Contract (identical to the in-repo `api/embed/index.py`):
    POST /api/embed
      headers: Authorization: Bearer <EMBED_API_KEY>  (required only if EMBED_API_KEY is set)
      body: raw image bytes (any Content-Type), OR JSON {"imageBase64": "..."}
      200 -> {"faces": [{"embedding": [512 floats], "bbox": [x1,y1,x2,y2], "det_score": float}, ...]}
      400 -> {"error": "..."}  on empty/undecodable input
      401 -> {"error": "unauthorized"}  on missing/wrong bearer token (only when EMBED_API_KEY is set)
    GET  /healthz -> {"ok": true, "model_ready": bool}  (never requires auth, so uptime checks/load
                                                          balancers can probe it unauthenticated)

Auth: set EMBED_API_KEY in the container's environment to require every
POST /api/embed request to carry `Authorization: Bearer <EMBED_API_KEY>` —
this is the only thing standing between the public internet and your EC2
CPU, so set it before exposing the port. Leaving EMBED_API_KEY unset allows
all requests through (dev/local only).
"""

import base64
import io
import os
import threading
import urllib.request

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps

# The two model files we actually use (detection + recognition). They are
# hosted on the project's public R2 bucket so the container doesn't need to
# pull the full ~600 MB buffalo_l pack. Override MODEL_BASE_URL if you move them.
MODEL_BASE_URL = os.environ.get(
    "MODEL_BASE_URL",
    "https://YOUR_R2_PUBLIC_BUCKET.r2.dev/models/buffalo_l",
)
MODEL_FILES = {
    "det_10g.onnx": 16_923_827,
    "w600k_r50.onnx": 174_383_860,
}
INSIGHTFACE_HOME = os.environ.get("INSIGHTFACE_HOME", "/root/.insightface")

# Shared-secret auth for POST /api/embed. When set, callers must send
# `Authorization: Bearer <EMBED_API_KEY>`; when unset, all requests are
# allowed (dev/local convenience — never leave it unset on a publicly
# reachable host, see the module docstring).
EMBED_API_KEY = os.environ.get("EMBED_API_KEY")

_app = None
_lock = threading.Lock()


def _authorized(request: Request) -> bool:
    if not EMBED_API_KEY:
        return True
    return request.headers.get("authorization") == f"Bearer {EMBED_API_KEY}"


def _ensure_models() -> None:
    """Download the det + recognition ONNX files into the buffalo_l dir if absent."""
    dest = os.path.join(INSIGHTFACE_HOME, "models", "buffalo_l")
    os.makedirs(dest, exist_ok=True)
    for name, expected_size in MODEL_FILES.items():
        path = os.path.join(dest, name)
        if os.path.exists(path) and os.path.getsize(path) >= expected_size:
            continue
        urllib.request.urlretrieve(f"{MODEL_BASE_URL}/{name}", path)


def _get_app():
    global _app
    if _app is None:
        with _lock:
            if _app is None:
                _ensure_models()
                from insightface.app import FaceAnalysis

                a = FaceAnalysis(
                    name="buffalo_l",
                    root=INSIGHTFACE_HOME,
                    allowed_modules=["detection", "recognition"],
                )
                a.prepare(ctx_id=-1, det_size=(640, 640))  # ctx_id=-1 -> CPU
                _app = a
    return _app


def get_faces(image_bytes: bytes) -> list[dict]:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = ImageOps.exif_transpose(img)
    bgr = np.array(img)[:, :, ::-1]  # RGB -> BGR for InsightFace
    faces = _get_app().get(bgr)
    return [
        {
            "embedding": f.normed_embedding.tolist(),
            "bbox": [float(x) for x in f.bbox.tolist()],
            "det_score": float(f.det_score),
        }
        for f in faces
    ]


app = FastAPI()


@app.get("/healthz")
def healthz():
    return {"ok": True, "model_ready": _app is not None}


@app.post("/api/embed")
async def embed(request: Request):
    if not _authorized(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    ctype = request.headers.get("content-type", "")
    body = await request.body()
    try:
        if ctype.startswith("application/json"):
            import json

            data = json.loads(body or b"{}")
            b64 = data.get("imageBase64")
            if not b64:
                return JSONResponse({"error": "imageBase64 required"}, status_code=400)
            image_bytes = base64.b64decode(b64)
        else:
            image_bytes = body
        if not image_bytes:
            return JSONResponse({"error": "empty body"}, status_code=400)
        return {"faces": get_faces(image_bytes)}
    except Exception as e:  # noqa: BLE001 - surface a clean 400 to the caller
        return JSONResponse({"error": f"could not process image: {e}"}, status_code=400)
