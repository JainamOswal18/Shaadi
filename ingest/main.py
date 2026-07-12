#!/usr/bin/env python3
"""Local pendrive → Shaadi ingest pipeline (Task 16).

Walks a directory of wedding JPGs on a pendrive, and for every photo:

  1. Content-hashes the file (sha256) and skips it if a ``photos`` row with that
     hash already exists (idempotent + resumable).
  2. Detects + embeds faces using the SAME shared InsightFace logic the live
     Vercel function uses (``api/embed/face.py`` → ``get_faces``); no model
     concerns are reimplemented here.
  3. Generates previews with Pillow, mirroring ``src/lib/previews.ts`` sizing:
     a thumb (longest edge 350, WebP q78) and a medium (longest edge 1280,
     WebP q80 + AVIF), honoring EXIF orientation.
  4. Uploads the original to R2 ``shaadi-photos`` and the previews to
     ``shaadi-previews`` (previews get an immutable, 1-year Cache-Control).
  5. Inserts one ``photos`` row (source='ingest') and one ``faces`` row per
     detected face, storing the 512-d embedding as a pgvector literal.

Usage::

    INSIGHTFACE_HOME=/path/to/models \
      python ingest/main.py --root "/path/to/your/photos" [--limit N] \
        [--dry-run] [--workers K]

Environment (DATABASE_URL, R2_*) is read from the repo-root ``.env``.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import psycopg

# --- Paths / imports of the shared face module -----------------------------
# ingest/main.py lives at <repo>/ingest/main.py; <repo>/api/embed holds the
# single source of truth for face detection/embedding (shared with the live
# Vercel function). Add it to sys.path and import get_faces from there.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "api" / "embed"))

from face import _get_app as _get_app_warm  # noqa: E402  warm model without an image
from face import get_faces  # noqa: E402  (import after sys.path tweak)


# --- Preview sizing (mirrors src/lib/previews.ts) --------------------------
THUMB_EDGE = 350
THUMB_QUALITY = 78
MEDIUM_EDGE = 1280
MEDIUM_WEBP_QUALITY = 80
MEDIUM_AVIF_QUALITY = 50  # sharp's default AVIF quality

CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable"

# EXIF tag ids we care about (avoids importing the full ExifTags table).
_EXIF_DATETIME_ORIGINAL = 36867  # DateTimeOriginal
_EXIF_DATETIME = 306  # DateTime (fallback)


def load_dotenv(path: Path) -> None:
    """Populate os.environ from a simple KEY=VALUE .env file.

    Existing environment variables win (so an explicit INSIGHTFACE_HOME or
    DATABASE_URL passed on the command line is never clobbered).
    """
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


# ---------------------------------------------------------------------------
# Image / preview helpers
# ---------------------------------------------------------------------------
def _resize_inside(img, edge: int):
    """Return a copy resized so its longest edge is <= edge (no enlargement)."""
    from PIL import Image

    w, h = img.size
    longest = max(w, h)
    if longest <= edge:
        return img.copy()
    scale = edge / float(longest)
    new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
    return img.resize(new_size, Image.LANCZOS)


@dataclass
class Previews:
    thumb: bytes
    medium_webp: bytes
    medium_avif: bytes | None
    width: int
    height: int
    taken_at: datetime | None


def _parse_exif_datetime(value: str) -> datetime | None:
    # EXIF datetimes are "YYYY:MM:DD HH:MM:SS".
    try:
        return datetime.strptime(value.strip(), "%Y:%m:%d %H:%M:%S")
    except (ValueError, AttributeError):
        return None


def make_previews(image_bytes: bytes, avif_enabled: bool) -> Previews:
    """Build thumb + medium previews from JPEG bytes, honoring EXIF orientation."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as src:
        # Capture EXIF timestamp before exif_transpose strips it.
        taken_at: datetime | None = None
        try:
            exif = src.getexif()
            if exif:
                for tag in (_EXIF_DATETIME_ORIGINAL, _EXIF_DATETIME):
                    v = exif.get(tag)
                    if v:
                        taken_at = _parse_exif_datetime(str(v))
                        if taken_at:
                            break
        except Exception:
            taken_at = None

        img = ImageOps.exif_transpose(src)  # apply orientation -> upright pixels
        img = img.convert("RGB")
        width, height = img.size  # oriented (displayed) dimensions

        thumb_img = _resize_inside(img, THUMB_EDGE)
        thumb_buf = io.BytesIO()
        thumb_img.save(thumb_buf, format="WEBP", quality=THUMB_QUALITY, method=6)

        medium_img = _resize_inside(img, MEDIUM_EDGE)
        mweb_buf = io.BytesIO()
        medium_img.save(mweb_buf, format="WEBP", quality=MEDIUM_WEBP_QUALITY, method=6)

        avif_bytes: bytes | None = None
        if avif_enabled:
            mavif_buf = io.BytesIO()
            medium_img.save(mavif_buf, format="AVIF", quality=MEDIUM_AVIF_QUALITY)
            avif_bytes = mavif_buf.getvalue()

    return Previews(
        thumb=thumb_buf.getvalue(),
        medium_webp=mweb_buf.getvalue(),
        medium_avif=avif_bytes,
        width=width,
        height=height,
        taken_at=taken_at,
    )


def avif_supported() -> bool:
    try:
        from PIL import features

        return bool(features.check("avif"))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# R2 / S3
# ---------------------------------------------------------------------------
def make_s3_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "standard"},
            s3={"addressing_style": "path"},
        ),
    )


# ---------------------------------------------------------------------------
# File enumeration
# ---------------------------------------------------------------------------
def iter_jpgs(root: Path):
    """Yield *.jpg files under root, skipping hidden/system files and RAW."""
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune hidden/system directories in place.
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in sorted(filenames):
            if name.startswith(".") or name.startswith("._"):
                continue  # AppleDouble / hidden
            ext = os.path.splitext(name)[1].lower()
            if ext in (".jpg", ".jpeg"):
                yield Path(dirpath) / name


# ---------------------------------------------------------------------------
# Per-photo processing
# ---------------------------------------------------------------------------
@dataclass
class Summary:
    processed: int = 0
    skipped_existing: int = 0
    faces_inserted: int = 0
    errors: int = 0
    thumb_oversize: int = 0
    error_files: list[str] = field(default_factory=list)


def content_hash_exists(conn, content_hash: str) -> bool:
    """Run the dedupe SELECT on ``conn``. No locking/retry here — callers go
    through ``ConnHolder.run``, which owns the lock and the reconnect/retry
    loop for every DB operation."""
    with conn.cursor() as cur:
        cur.execute("select 1 from photos where content_hash = %s limit 1", (content_hash,))
        return cur.fetchone() is not None


def insert_photo_and_faces(
    conn,
    *,
    content_hash: str,
    original_key: str,
    preview_key: str,
    thumb_key: str,
    width: int,
    height: int,
    nbytes: int,
    taken_at: datetime | None,
    faces: list[dict],
) -> str | None:
    """Insert one photo + its faces in a single transaction. Returns photo id,
    or None if the content_hash already exists (unique-constraint safety net).

    No locking/retry here — see ``content_hash_exists`` docstring above.
    """
    with conn.cursor() as cur:
        try:
            cur.execute(
                """
                insert into photos (
                    source, content_hash, original_key, preview_key, thumb_key,
                    width, height, bytes, taken_at
                ) values (
                    'ingest', %s, %s, %s, %s, %s, %s, %s, %s
                )
                on conflict (content_hash) do nothing
                returning id
                """,
                (
                    content_hash,
                    original_key,
                    preview_key,
                    thumb_key,
                    width,
                    height,
                    nbytes,
                    taken_at,
                ),
            )
            row = cur.fetchone()
            if row is None:
                conn.rollback()
                return None
            photo_id = row[0]
            for f in faces:
                vec = "[" + ",".join(repr(float(x)) for x in f["embedding"]) + "]"
                cur.execute(
                    """
                    insert into faces (photo_id, embedding, bbox, det_score)
                    values (%s, %s::vector, %s::jsonb, %s)
                    """,
                    (
                        photo_id,
                        vec,
                        json.dumps(f["bbox"]),
                        float(f["det_score"]),
                    ),
                )
            conn.commit()
            return str(photo_id)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass  # connection may already be dead; the retry wrapper reconnects
            raise


# ---------------------------------------------------------------------------
# Resilient DB connection: reconnect + retry on dropped/closed connections
# ---------------------------------------------------------------------------
# Neon (serverless Postgres) can close idle connections and drops connections
# under load on the free tier. A run that touches ~3000+ photos over an hour
# WILL see at least one mid-run drop; without reconnect logic every remaining
# photo fails with the same OperationalError. ConnHolder makes every DB call
# go through a single retry/reconnect loop, and proactively recycles the
# connection periodically so it rarely gets the chance to go stale under us.
RETRYABLE_DB_ERRORS = (psycopg.OperationalError, psycopg.InterfaceError)

# Proactive-recycle thresholds (item 3: periodic connection health/keepalive).
# Neither is a hard science for Neon's exact limits; both are cheap safety
# nets that make it *unlikely* we ever hit the reactive retry path in item 1.
# Rely on the REACTIVE reconnect-on-failure path (run()'s retry loop) for real
# Neon drops. Keep only a rare proactive recycle as a long-interval safety net —
# recycling every 4 min was self-inflicting a 30-90s Neon reconnect stall each
# time and dominated ingest wall-clock.
RECONNECT_EVERY_N_OPS = 100000
RECONNECT_MAX_AGE_SECONDS = 1800.0  # 30 minutes


class ConnHolder:
    """Owns the single shared DB connection + its lock.

    All DB access (from any worker thread) must go through ``run()``, which:
      1. serializes access with a lock (one connection, many threads),
      2. proactively reconnects if the connection is old/overused,
      3. on OperationalError/InterfaceError, reconnects and retries the whole
         operation a few times with backoff before giving up.
    """

    def __init__(self, dsn: str):
        self._dsn = dsn
        self._lock = threading.Lock()
        self._conn = None
        self._connected_at = 0.0
        self._ops_since_reconnect = 0
        self._reconnect_count = 0
        self._connect()

    def _connect(self) -> None:
        self._conn = psycopg.connect(self._dsn, autocommit=False)
        self._connected_at = time.time()
        self._ops_since_reconnect = 0

    def _reconnect(self, reason: str) -> None:
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:
            pass  # already dead; nothing to clean up
        self._connect()
        self._reconnect_count += 1
        print(f"[warn] DB reconnected (#{self._reconnect_count}): {reason}", file=sys.stderr)

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except Exception:
                pass

    @property
    def reconnect_count(self) -> int:
        with self._lock:
            return self._reconnect_count

    def run(self, fn, *, max_attempts: int = 5, base_delay: float = 0.5, max_delay: float = 10.0):
        """Run ``fn(conn)`` with the shared connection, holding the lock for
        the duration of the call, reconnecting + retrying on connection
        errors. ``fn`` must be idempotent/retry-safe (it is: the dedupe
        SELECT and the ``on conflict ... do nothing`` insert both are)."""
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            with self._lock:
                # Proactive keepalive/recycle before we even try, so a
                # long-idle or long-lived connection doesn't get the chance
                # to be the one Neon drops mid-operation.
                age = time.time() - self._connected_at
                if self._ops_since_reconnect >= RECONNECT_EVERY_N_OPS or age >= RECONNECT_MAX_AGE_SECONDS:
                    self._reconnect(
                        f"proactive recycle (ops={self._ops_since_reconnect}, age={age:.0f}s)"
                    )
                self._ops_since_reconnect += 1
                try:
                    return fn(self._conn)
                except RETRYABLE_DB_ERRORS as exc:
                    last_exc = exc
                    self._reconnect(f"attempt {attempt}/{max_attempts} after {exc!r}")
                except Exception:
                    raise  # non-connection errors are not retried here
            if attempt < max_attempts:
                delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
                time.sleep(delay)
        assert last_exc is not None
        raise last_exc


def process_one(
    path: Path,
    *,
    args,
    s3,
    holder: "ConnHolder",
    det_lock,
    avif_enabled: bool,
    summary: Summary,
    sum_lock,
    pbar,
) -> None:
    rel = str(path)
    try:
        image_bytes = path.read_bytes()
        nbytes = len(image_bytes)
        content_hash = hashlib.sha256(image_bytes).hexdigest()

        # Dedupe check BEFORE any R2 upload (item 2: never upload for a photo
        # we're not about to try to insert). Retried/reconnected by holder.run
        # so a dropped connection here just costs a short retry, not the photo.
        if holder.run(lambda conn: content_hash_exists(conn, content_hash)):
            with sum_lock:
                summary.skipped_existing += 1
            return

        # Face detection is CPU-bound (onnxruntime). Serialize it so we don't
        # oversubscribe cores; preview encoding + uploads still overlap.
        with det_lock:
            faces = get_faces(image_bytes)

        if args.dry_run:
            with sum_lock:
                summary.processed += 1
                summary.faces_inserted += len(faces)
            return

        prev = make_previews(image_bytes, avif_enabled)
        if len(prev.thumb) > 30_000:
            with sum_lock:
                summary.thumb_oversize += 1

        photo_uuid = str(uuid.uuid4())
        original_key = f"originals/{photo_uuid}.jpg"
        thumb_key = f"thumb/{photo_uuid}.webp"
        medium_webp_key = f"medium/{photo_uuid}.webp"
        medium_avif_key = f"medium/{photo_uuid}.avif"

        originals_bucket = os.environ["R2_BUCKET_ORIGINALS"]
        previews_bucket = os.environ["R2_BUCKET_PREVIEWS"]

        # Uploads (I/O bound — safe to run from worker threads concurrently).
        s3.put_object(
            Bucket=originals_bucket,
            Key=original_key,
            Body=image_bytes,
            ContentType="image/jpeg",
        )
        s3.put_object(
            Bucket=previews_bucket,
            Key=thumb_key,
            Body=prev.thumb,
            ContentType="image/webp",
            CacheControl=CACHE_CONTROL_IMMUTABLE,
        )
        s3.put_object(
            Bucket=previews_bucket,
            Key=medium_webp_key,
            Body=prev.medium_webp,
            ContentType="image/webp",
            CacheControl=CACHE_CONTROL_IMMUTABLE,
        )
        if prev.medium_avif is not None:
            s3.put_object(
                Bucket=previews_bucket,
                Key=medium_avif_key,
                Body=prev.medium_avif,
                ContentType="image/avif",
                CacheControl=CACHE_CONTROL_IMMUTABLE,
            )

        # The insert is the step that, if it never succeeds, would leave the
        # originals/previews we just uploaded as R2 orphans (item 2). Given
        # the reconnect support in ConnHolder.run, the fix is to retry this
        # harder rather than to reorder uploads after a commit we can't get
        # atomicity with anyway — give it more attempts + a longer backoff
        # than the read-only dedupe check above.
        photo_id = holder.run(
            lambda conn: insert_photo_and_faces(
                conn,
                content_hash=content_hash,
                original_key=original_key,
                preview_key=medium_webp_key,
                thumb_key=thumb_key,
                width=prev.width,
                height=prev.height,
                nbytes=nbytes,
                taken_at=prev.taken_at,
                faces=faces,
            ),
            max_attempts=8,
            base_delay=1.0,
            max_delay=20.0,
        )
        if photo_id is None:
            # Lost an idempotency race; the winner already indexed this hash.
            with sum_lock:
                summary.skipped_existing += 1
            return

        with sum_lock:
            summary.processed += 1
            summary.faces_inserted += len(faces)
    except Exception as exc:  # noqa: BLE001 — keep the run resumable
        with sum_lock:
            summary.errors += 1
            summary.error_files.append(f"{rel}: {exc!r}")
        print(f"[error] {rel}: {exc!r}", file=sys.stderr)
    finally:
        if pbar is not None:
            pbar.update(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Local pendrive → Shaadi ingest")
    parser.add_argument("--root", required=True, help="Directory to recurse for *.jpg")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N new photos worth of files")
    parser.add_argument("--dry-run", action="store_true", help="Detect + count faces; no uploads or DB writes")
    parser.add_argument("--workers", type=int, default=4, help="Thread-pool size for I/O (default 4)")
    args = parser.parse_args()

    load_dotenv(_REPO_ROOT / ".env")

    root = Path(args.root)
    if not root.exists():
        print(f"[fatal] root does not exist: {root}", file=sys.stderr)
        return 2

    # Fail fast on required config.
    for key in ("DATABASE_URL", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
                "R2_BUCKET_ORIGINALS", "R2_BUCKET_PREVIEWS"):
        if not os.environ.get(key):
            print(f"[fatal] missing required env: {key}", file=sys.stderr)
            return 2

    avif_enabled = avif_supported()
    print(f"[info] root={root}")
    print(f"[info] AVIF preview support: {'ENABLED' if avif_enabled else 'DISABLED (Pillow lacks AVIF; skipping .avif)'}")
    if os.environ.get("INSIGHTFACE_HOME"):
        print(f"[info] INSIGHTFACE_HOME={os.environ['INSIGHTFACE_HOME']}")
    else:
        print("[warn] INSIGHTFACE_HOME unset — insightface will use ~/.insightface (may re-download the model)")

    files = list(iter_jpgs(root))
    if args.limit is not None:
        files = files[: args.limit]
    print(f"[info] {len(files)} candidate JPG file(s) (limit={args.limit}, workers={args.workers}, dry_run={args.dry_run})")

    if not files:
        print("[info] nothing to do")
        return 0

    # Warm the model once, single-threaded, before the pool starts so the
    # first ~few-second onnxruntime init doesn't happen under the det_lock
    # while other workers block. (det_lock also makes this safe regardless.)
    print("[info] warming face model ...")
    t0 = time.time()
    _get_app_warm()
    print(f"[info] model ready in {time.time() - t0:.1f}s")

    holder = ConnHolder(os.environ["DATABASE_URL"])

    s3 = make_s3_client()
    det_lock = threading.Lock()
    sum_lock = threading.Lock()
    summary = Summary()

    try:
        from tqdm import tqdm

        pbar = tqdm(total=len(files), unit="img", dynamic_ncols=True)
    except Exception:
        pbar = None

    started = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [
            pool.submit(
                process_one,
                f,
                args=args,
                s3=s3,
                holder=holder,
                det_lock=det_lock,
                avif_enabled=avif_enabled,
                summary=summary,
                sum_lock=sum_lock,
                pbar=pbar,
            )
            for f in files
        ]
        for _ in as_completed(futures):
            pass

    if pbar is not None:
        pbar.close()
    print(f"[info] DB reconnects during run: {holder.reconnect_count}")
    holder.close()

    elapsed = time.time() - started
    print("\n==================== INGEST SUMMARY ====================")
    print(f"  candidate files      : {len(files)}")
    print(f"  processed (new)      : {summary.processed}")
    print(f"  skipped (existing)   : {summary.skipped_existing}")
    print(f"  faces inserted       : {summary.faces_inserted}")
    print(f"  errors               : {summary.errors}")
    if summary.thumb_oversize:
        print(f"  thumbs > 30KB (warn) : {summary.thumb_oversize}")
    print(f"  elapsed              : {elapsed:.1f}s")
    if summary.error_files:
        print("  first errors:")
        for line in summary.error_files[:10]:
            print(f"    - {line}")
    print("=======================================================")
    return 0 if summary.errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
