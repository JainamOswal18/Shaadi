# ---- builder: compile the wheels (InsightFace/stringzilla need a C/C++ toolchain) ----
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# Install into an isolated prefix we copy into the slim runtime below.
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- runtime: slim image, no compiler ----
FROM python:3.11-slim

# Shared libs InsightFace/opencv load at runtime; ffmpeg powers the /reel
# slideshow render (Reel maker, plan Task 9).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 libgomp1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

WORKDIR /app
COPY app.py .

ENV INSIGHTFACE_HOME=/root/.insightface
# The model (det + recognition, ~191 MB) is fetched from MODEL_BASE_URL to
# INSIGHTFACE_HOME on the first request (cold start ~60-90s); set MODEL_BASE_URL
# and EMBED_API_KEY at `docker run` time. Warm it immediately after start with a
# single request if you want the first guest hit to be fast.

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
