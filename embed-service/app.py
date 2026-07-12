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
import json
import os
import shutil
import subprocess
import tempfile
import threading
import urllib.request

import boto3
import numpy as np
from fastapi import BackgroundTasks, FastAPI, Request
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
        # Cloudflare's r2.dev returns 403 to the default Python-urllib UA, so
        # send a browser-like User-Agent when fetching the model files.
        req = urllib.request.Request(
            f"{MODEL_BASE_URL}/{name}", headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req) as resp, open(path, "wb") as out:
            shutil.copyfileobj(resp, out)


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


# ---------------------------------------------------------------------------
# POST /reel — ffmpeg slideshow render (Reel maker, plan Task 9)
#
# Consumes the ReelDispatchPayload posted by src/lib/reel-client.ts. Renders
# in a FastAPI BackgroundTasks job so the request itself returns 202
# immediately; on completion (success or failure) it POSTs the result back
# to the payload's callbackUrl (src/app/api/reel/callback/route.ts).
# ---------------------------------------------------------------------------

R2_ENDPOINT = os.environ.get("R2_ENDPOINT")
R2_BUCKET_ORIGINALS = os.environ.get("R2_BUCKET_ORIGINALS", "shaadi-photos")


def _r2():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def _download_and_normalize(url: str, dest: str, width: int, height: int) -> None:
    """Fetch a preview and re-encode to a uniform cover-cropped ~90% JPEG."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        img = Image.open(io.BytesIO(resp.read())).convert("RGB")
    img = ImageOps.exif_transpose(img)
    img = ImageOps.fit(img, (width, height), method=Image.LANCZOS)  # cover-crop
    img.save(dest, "JPEG", quality=90)


def _build_ffmpeg_cmd(frames, audio, width, height, transition, total_seconds, out_path):
    """Compose the slideshow. Uniform WxH JPEG inputs (already cover-cropped)."""
    n = len(frames)
    xfade = 0.6  # crossfade seconds
    inputs = []
    for i, f in enumerate(frames):
        # Each still shown for its segment; +xfade padding on crossfade so the
        # overlap doesn't shorten a clip.
        dur = f["seconds"] + (xfade if transition == "crossfade" and i < n - 1 else 0)
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", f["path"]]

    filters = []
    if transition == "kenburns":
        fps = 30
        for i, f in enumerate(frames):
            d = max(1, int(f["seconds"] * fps))
            filters.append(
                f"[{i}:v]scale={width}:{height},setsar=1,"
                f"zoompan=z='min(zoom+0.0015,1.5)':d={d}:"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={width}x{height}:fps={fps},"
                # Bound each clip to exactly its own duration: zoompan emits `d`
                # frames PER input frame, and the looped still feeds many frames,
                # so without this trim the stream explodes to minutes/GBs. trim is
                # pull-based, so ffmpeg only ever generates the frames we keep.
                f"trim=duration={f['seconds']},setpts=PTS-STARTPTS[v{i}]"
            )
        labels = "".join(f"[v{i}]" for i in range(n))
        filters.append(f"{labels}concat=n={n}:v=1:a=0[vout]")
    elif transition == "crossfade":
        for i in range(n):
            filters.append(f"[{i}:v]scale={width}:{height},setsar=1,fps=30[v{i}]")
        prev, offset = "[v0]", 0.0
        for i in range(1, n):
            offset += frames[i - 1]["seconds"]
            out = "[vout]" if i == n - 1 else f"[x{i}]"
            filters.append(f"{prev}[v{i}]xfade=transition=fade:duration={xfade}:offset={offset:.3f}{out}")
            prev = out
        if n == 1:
            filters.append("[v0]null[vout]")
    else:  # cut
        for i in range(n):
            filters.append(f"[{i}:v]scale={width}:{height},setsar=1,fps=30[v{i}]")
        labels = "".join(f"[v{i}]" for i in range(n))
        filters.append(f"{labels}concat=n={n}:v=1:a=0[vout]")

    cmd = ["ffmpeg", "-y", *inputs]
    audio_idx = None
    if audio and audio.get("path"):
        audio_idx = n
        cmd += ["-ss", str(audio.get("startSec", 0)), "-t", str(total_seconds), "-i", audio["path"]]
    cmd += ["-filter_complex", ";".join(filters), "-map", "[vout]"]
    if audio_idx is not None:
        cmd += ["-map", f"{audio_idx}:a", "-c:a", "aac", "-b:a", "128k", "-shortest"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-r", "30",
            "-movflags", "+faststart", out_path]
    return cmd


def _callback(url: str, body: dict) -> None:
    data = json.dumps(body).encode()
    headers = {"content-type": "application/json"}
    if EMBED_API_KEY:
        headers["authorization"] = f"Bearer {EMBED_API_KEY}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:  # noqa: BLE001
        print(f"reel callback failed: {e}")


def _render_job(spec: dict) -> None:
    job_id = spec["jobId"]
    cb = spec.get("callbackUrl")
    try:
        with tempfile.TemporaryDirectory() as work:
            w, h = spec["width"], spec["height"]
            frames = []
            for i, fr in enumerate(spec["frames"]):
                p = os.path.join(work, f"f{i}.jpg")
                _download_and_normalize(fr["url"], p, w, h)
                frames.append({"path": p, "seconds": fr["seconds"]})
            audio = None
            au = spec.get("audio") or {}
            if au.get("url"):
                ap = os.path.join(work, "audio.src")
                req = urllib.request.Request(au["url"], headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req) as r, open(ap, "wb") as out:
                    shutil.copyfileobj(r, out)
                audio = {"path": ap, "startSec": au.get("startSec", 0)}
            out_path = os.path.join(work, "out.mp4")
            cmd = _build_ffmpeg_cmd(frames, audio, w, h, spec["transition"],
                                    spec["totalSeconds"], out_path)
            proc = subprocess.run(cmd, capture_output=True)
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.decode()[-500:])
            _r2().upload_file(out_path, R2_BUCKET_ORIGINALS, spec["outputKey"],
                              ExtraArgs={"ContentType": "video/mp4"})
        if cb:
            _callback(cb, {"jobId": job_id, "status": "done", "outputKey": spec["outputKey"]})
    except Exception as e:  # noqa: BLE001
        print(f"reel render failed for {job_id}: {e}")
        if cb:
            _callback(cb, {"jobId": job_id, "status": "error", "error": str(e)[:500]})


@app.post("/reel")
async def reel(request: Request, background_tasks: BackgroundTasks):
    if not _authorized(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        spec = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)
    if not spec.get("jobId") or not spec.get("frames"):
        return JSONResponse({"error": "jobId and frames required"}, status_code=400)
    background_tasks.add_task(_render_job, spec)
    return JSONResponse({"accepted": True, "jobId": spec["jobId"]}, status_code=202)
