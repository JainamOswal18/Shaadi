"""Real-model test for the shared face logic.

Guarded by ``RUN_EMBED=1`` because it loads the ~326MB buffalo_l model and runs
CPU inference — too heavy for a default unit run. Point it at a real face
photo; it asserts we get a 512-d unit-norm embedding back.

Run:
    RUN_EMBED=1 INSIGHTFACE_HOME=api/embed/models \\
        .venv/bin/python -m pytest api/embed/test_face.py -v
"""

import glob
import math
import os

import pytest

RUN = os.environ.get("RUN_EMBED") == "1"

# Real wedding JPEGs live on a pendrive; read them by absolute path at runtime.
# Never copied into or committed to the repo.
PHOTO_DIR = "/path/to/your/photos/30th/"

# Not every wedding frame contains a detectable face (decor, wide venue shots,
# etc.), so scan a bounded number of photos and use the first one that has a
# face rather than betting on a single filename.
MAX_SCAN = 25


def _candidate_photos() -> list[str]:
    if os.environ.get("EMBED_TEST_PHOTO"):
        return [os.environ["EMBED_TEST_PHOTO"]]
    photos: list[str] = []
    for pattern in ("*.JPG", "*.jpg", "*.jpeg", "*.JPEG"):
        photos.extend(glob.glob(os.path.join(PHOTO_DIR, pattern)))
    return sorted(photos)[:MAX_SCAN]


@pytest.mark.skipif(not RUN, reason="set RUN_EMBED=1 to run the real-model test")
def test_get_faces_returns_unit_norm_512d_embedding():
    photos = _candidate_photos()
    if not photos:
        pytest.skip(f"no real photo available under {PHOTO_DIR}")

    from face import get_faces

    photo = None
    faces: list[dict] = []
    for candidate in photos:
        if not os.path.exists(candidate):
            continue
        with open(candidate, "rb") as fh:
            faces = get_faces(fh.read())
        if faces:
            photo = candidate
            break

    assert photo is not None, (
        f"no detectable face found in first {len(photos)} photo(s) under {PHOTO_DIR}"
    )
    assert len(faces) >= 1

    face = faces[0]
    embedding = face["embedding"]
    assert len(embedding) == 512, f"expected 512-d embedding, got {len(embedding)}"

    norm = math.sqrt(sum(x * x for x in embedding))
    assert abs(norm - 1.0) < 1e-3, f"embedding not unit-norm: |v|={norm}"

    # Structural sanity on the rest of the payload.
    assert len(face["bbox"]) == 4
    assert all(isinstance(x, float) for x in face["bbox"])
    assert isinstance(face["det_score"], float)

    print(
        f"\n[RUN_EMBED] {os.path.basename(photo)}: "
        f"{len(faces)} face(s), dim={len(embedding)}, |v|={norm:.6f}, "
        f"det_score={face['det_score']:.4f}"
    )
