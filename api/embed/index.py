"""Vercel Python Serverless Function: POST /api/embed.

Accepts an image and returns every detected face's 512-d normalized embedding.

Request body (either form):
  * ``Content-Type: application/json`` with ``{"imageBase64": "<base64>"}``
  * any other content type: the raw request body IS the image bytes.

Response: ``200 {"faces": [{embedding, bbox, det_score}, ...]}`` (``faces`` may be
empty). Malformed/empty input yields ``400 {"error": "..."}``.

Uses Vercel's native ``BaseHTTPRequestHandler`` contract (the Python runtime
imports a module-level ``handler`` subclass and dispatches per request).
"""

import base64
import binascii
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# The deployed Python runtime loads this module via importlib's
# spec_from_file_location/exec_module (see the traceback in vc_init.py /
# resolver.py), which — unlike running `python index.py` directly — does NOT
# implicitly add this file's own directory to sys.path. Without this, the
# sibling import below raises `ModuleNotFoundError: No module named 'face'` in
# production even though the same directory layout works locally. Explicitly
# add our own directory so the same-directory import resolves regardless of
# how the runtime loaded us.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Same-directory import: the shared logic lives alongside this file as
# ``face.py`` (see sys.path fix-up above).
from face import get_faces  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send_json(400, {"error": "empty request body"})
            return

        raw = self.rfile.read(length)
        content_type = (self.headers.get("Content-Type") or "").lower()

        try:
            if content_type.startswith("application/json"):
                parsed = json.loads(raw.decode("utf-8"))
                b64 = parsed.get("imageBase64")
                if not isinstance(b64, str) or not b64:
                    self._send_json(400, {"error": "missing imageBase64"})
                    return
                image_bytes = base64.b64decode(b64, validate=True)
            else:
                image_bytes = raw
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "invalid JSON body"})
            return
        except (binascii.Error, ValueError):
            self._send_json(400, {"error": "invalid base64 image"})
            return

        if not image_bytes:
            self._send_json(400, {"error": "empty image"})
            return

        try:
            faces = get_faces(image_bytes)
        except Exception as exc:  # noqa: BLE001 - surface decode/model errors as 400
            self._send_json(400, {"error": f"could not process image: {exc}"})
            return

        self._send_json(200, {"faces": faces})
