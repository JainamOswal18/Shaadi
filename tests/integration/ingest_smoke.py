#!/usr/bin/env python3
"""Post-ingest smoke assertions for the local pendrive ingest (Task 16).

Run AFTER `ingest/main.py` has indexed a batch. Verifies, against the live
Neon + R2 backend, that:

  * `photos` rows with source='ingest' exist (>= expected count),
  * at least one `faces` row was inserted,
  * a preview URL fetches HTTP 200 from the public R2 base with the immutable
    Cache-Control, and
  * nearest-neighbor retrieval of an indexed face's own embedding returns that
    face's own photo (self-match, distance ~0).

Usage:
    .venv/bin/python tests/integration/ingest_smoke.py [--min-photos 20]

Env (DATABASE_URL, R2_PREVIEWS_PUBLIC_URL) is read from the repo-root .env.
Exits non-zero on any failed assertion.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def http_status(url: str) -> tuple[int, str]:
    """Return (status, cache_control) using curl (avoids local CA-bundle issues)."""
    out = subprocess.run(
        ["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", url],
        capture_output=True,
        text=True,
        timeout=60,
    )
    status = int(out.stdout.strip() or "0")
    head = subprocess.run(["curl", "-sSI", url], capture_output=True, text=True, timeout=60)
    cache = ""
    for line in head.stdout.splitlines():
        if line.lower().startswith("cache-control"):
            cache = line.split(":", 1)[1].strip()
    return status, cache


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-photos", type=int, default=20)
    args = ap.parse_args()

    load_dotenv(_REPO_ROOT / ".env")

    import psycopg

    failures: list[str] = []
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()

    cur.execute("select count(*) from photos where source='ingest'")
    n_photos = cur.fetchone()[0]
    print(f"[check] ingest photos = {n_photos} (>= {args.min_photos})")
    if n_photos < args.min_photos:
        failures.append(f"expected >= {args.min_photos} ingest photos, got {n_photos}")

    cur.execute("select count(*) from faces")
    n_faces = cur.fetchone()[0]
    print(f"[check] faces = {n_faces} (> 0)")
    if n_faces <= 0:
        failures.append("no faces inserted")

    # Preview URL fetch.
    cur.execute("select thumb_key from photos where source='ingest' limit 1")
    row = cur.fetchone()
    if row:
        base = os.environ["R2_PREVIEWS_PUBLIC_URL"]
        url = f"{base}/{row[0]}"
        status, cache = http_status(url)
        print(f"[check] preview HTTP {status} cache='{cache}' {url}")
        if status != 200:
            failures.append(f"preview fetch returned {status}")
        if "immutable" not in cache:
            failures.append(f"preview missing immutable Cache-Control (got '{cache}')")
    else:
        failures.append("no ingest photo to fetch a preview for")

    # Retrieval self-match.
    cur.execute("select photo_id, embedding::text from faces limit 1")
    own_photo, emb = cur.fetchone()
    cur.execute(
        "select photo_id, (embedding <=> %s::vector) as dist "
        "from faces order by embedding <=> %s::vector limit 1",
        (emb, emb),
    )
    top_photo, dist = cur.fetchone()
    print(f"[check] retrieval self-match: top={top_photo} dist={dist:.6f} own={own_photo}")
    if top_photo != own_photo:
        failures.append("nearest-neighbor did not return the face's own photo")

    conn.close()

    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nOK: all ingest smoke assertions passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
