# Local pendrive ingest

Indexes wedding photos from a local pendrive into the Shaadi backend: detects +
embeds faces, generates previews, uploads originals/previews to R2, and inserts
`photos` + `faces` rows in Neon. Idempotent (content-hash) and resumable.

## What it does per photo

1. **Hash + skip** — sha256 of the file bytes; if a `photos.content_hash` row
   already exists, the file is skipped. Safe to re-run / interrupt.
2. **Faces** — reuses the shared `api/embed/face.py` (`get_faces`) — the exact
   same `buffalo_l` InsightFace model the live `/api/embed` function uses. Not
   reimplemented here.
3. **Previews (Pillow)** — mirrors `src/lib/previews.ts`:
   - thumb: longest edge 350, WebP q78
   - medium: longest edge 1280, WebP q80 **and** AVIF (q50)
   - EXIF orientation is applied (`ImageOps.exif_transpose`); `taken_at` is read
     from EXIF `DateTimeOriginal` when present.
   - If the installed Pillow lacks AVIF support, the `.avif` is skipped and a
     notice is logged (WebP is always produced).
4. **Upload** — original → `shaadi-photos/originals/<uuid>.jpg`; previews →
   `shaadi-previews/{thumb,medium}/<uuid>.{webp,avif}` with
   `Cache-Control: public, max-age=31536000, immutable`.
5. **DB** — one `photos` row (`source='ingest'`) + one `faces` row per detected
   face; the 512-d embedding is inserted as a `'[...]'::vector` literal.

## Requirements

Uses the shared repo virtualenv (`.venv`) which already has InsightFace +
Pillow. Install the extra ingest deps into it:

```bash
.venv/bin/pip install -r ingest/requirements.txt
```

Environment (`DATABASE_URL`, `R2_*`) is read from the repo-root `.env`
automatically. The InsightFace model cache location is controlled by
`INSIGHTFACE_HOME` — point it at the already-downloaded model pack so the ~326MB
`buffalo_l` model is not re-fetched:

```
INSIGHTFACE_HOME=<repo>/api/embed/models
```

## Usage

```bash
# Smoke test: first 20 files under 30th/
INSIGHTFACE_HOME=<repo>/api/embed/models \
  .venv/bin/python ingest/main.py --root "/path/to/your/photos/30th" --limit 20

# Full run (all of 1st/, 29th/, 30th/)
INSIGHTFACE_HOME=<repo>/api/embed/models \
  .venv/bin/python ingest/main.py --root "/path/to/your/photos" --workers 4
```

### Flags

| Flag | Meaning |
|------|---------|
| `--root PATH` | Directory to recurse for `*.jpg`/`*.jpeg` (required). Hidden/system files and RAW `.cr3` are skipped. |
| `--limit N` | Process at most the first N candidate files (for smoke tests). |
| `--dry-run` | Detect + count faces only; no previews, uploads, or DB writes. |
| `--workers K` | Thread-pool size for preview/upload I/O (default 4). Face detection is serialized (CPU-bound). |

A final summary prints photos processed / skipped and faces inserted.
