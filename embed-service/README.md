# `embed-service` — face-embedding compute, deployed on your own EC2

`app.py` is a tiny FastAPI wrapper around InsightFace `buffalo_l`. It exists
because the model's Python dependencies (~550 MB) exceed Vercel Hobby's
500 MB serverless-function limit — so instead of running inside the Next.js
app, it runs here, in a container you deploy yourself, and the Vercel app
calls it over HTTPS via `EMBED_FN_URL`.

This guide takes you from a blank EC2 instance to a working, authenticated
embed service wired up to the live app at
[your-app-name.vercel.app](https://your-app-name.vercel.app).

## 1. Pick an instance size

InsightFace's detector + recognition models need roughly **1.3–2 GB of RAM**
resident once loaded (ONNX Runtime graph + buffers for `det_10g.onnx` and
`w600k_r50.onnx`), on top of the OS, Docker, and Python/uvicorn overhead. To
stay comfortably clear of OOM kills under load:

| Resource | Recommended | Comfortable minimum |
|---|---|---|
| RAM      | **4 GB** | 2 GB |
| vCPU     | 1–2 (CPU-only inference; more helps concurrency, not per-request latency much) | 1 |
| Disk     | ~5 GB (base image + model weights + layers) | 5 GB |

A **`t3.small`** (2 GB RAM) works but leaves little headroom for concurrent
requests; a **`t3.medium`** (4 GB RAM) is the recommended baseline and is
what these instructions assume. Amazon Linux 2023 or Ubuntu 22.04/24.04 both
work fine.

## 2. Install Docker on the instance

SSH into the instance, then (Amazon Linux 2023):

```bash
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# log out and back in for the group change to take effect, or run:
newgrp docker
```

(Ubuntu: use `sudo apt-get install -y docker.io` instead, then the same
`systemctl`/`usermod` steps.)

Verify: `docker run hello-world`.

## 3. Get the code onto the instance and build the image

```bash
git clone <this-repo-url> shaadi
cd shaadi
docker build -t shaadi-embed embed-service/
```

The build downloads the InsightFace model weights from the project's public
R2 bucket at build time and warms the model into the image layer (see the
`RUN python -c "import app; app._get_app()"` step in the `Dockerfile`), so
the *first* request after container start doesn't pay a cold-download +
model-load penalty. Expect the build to take a few minutes.

## 4. Generate a shared secret and run the container

Generate a random key — this is the only thing standing between the public
internet and your EC2 CPU, so don't skip it:

```bash
EMBED_API_KEY=$(openssl rand -hex 32)
echo "$EMBED_API_KEY"   # save this — you'll need it again in step 6
```

Run the container:

```bash
docker run -d --restart=always -p 8000:8000 \
  -e EMBED_API_KEY="$EMBED_API_KEY" \
  --name shaadi-embed \
  shaadi-embed
```

- `--restart=always` brings the service back up automatically after an
  instance reboot or a container crash.
- `-e EMBED_API_KEY=...` turns on shared-secret auth: `POST /api/embed`
  will reject any request that doesn't carry
  `Authorization: Bearer <EMBED_API_KEY>` with a `401`. `GET /healthz` stays
  open (no auth) so uptime checks/load balancers can probe it freely.
  **If you omit `-e EMBED_API_KEY=...`, the service accepts unauthenticated
  requests from anyone who can reach port 8000/443 — fine for a quick local
  test, never for anything reachable from the internet.**

Verify it's up:

```bash
curl localhost:8000/healthz
# -> {"ok":true,"model_ready":false}   (model_ready flips to true after the first successful embed call)
```

## 5. Put it behind HTTPS

Vercel's Node runtime will refuse to `fetch()` a plain-`http://` URL from a
server action/route in some configurations, and even where it doesn't,
sending a guest's selfie bytes over unencrypted HTTP is worth avoiding.
Two options:

**Option A — Caddy (recommended if you have a domain)**

Point a DNS `A` record for a subdomain (e.g. `embed.yourdomain.com`) at the
instance's public IP, then run Caddy in front of the container for
automatic Let's Encrypt TLS:

```bash
sudo dnf install -y caddy    # or: apt-get install -y caddy (Ubuntu, via Caddy's apt repo)
sudo caddy reverse-proxy --from embed.yourdomain.com --to localhost:8000
```

For a persistent setup (survives reboot) run this as a systemd service
instead of the foreground command above — `caddy reverse-proxy` is fine for
getting started, but see [Caddy's systemd
docs](https://caddyserver.com/docs/running) for a `Caddyfile` + service unit
you can enable with `systemctl enable --now caddy`.

Your embed URL is then `https://embed.yourdomain.com/api/embed`.

**Option B — no domain: leave it on plain HTTP**

Server-to-server calls from Vercel to your EC2 instance never touch a
browser, so a guest's traffic is still HTTPS end-to-end (browser → Vercel);
only the Vercel-to-EC2 hop is unencrypted. This is an acceptable tradeoff if
only your Vercel deployment calls this host and you don't have a domain to
point at it yet — but TLS (Option A) is still recommended once you have one,
since plain HTTP also means anyone who can intercept that hop can read the
`Authorization` bearer token in transit.

Your embed URL is then `http://<ec2-public-ip>:8000/api/embed`.

**Either way — lock down the security group.** In the EC2 console, edit the
instance's security group inbound rules to allow only:

- `22` (SSH) — ideally restricted to your own IP, not `0.0.0.0/0`
- `443` (HTTPS) if using Caddy, **or** `8000` if going straight to the
  container over plain HTTP (Option B)
- `80` (HTTP) only if using Caddy for the initial Let's Encrypt challenge —
  Caddy needs it briefly to issue/renew certificates

Do **not** leave `8000` open to `0.0.0.0/0` once Caddy is in front of it —
close it and rely on Caddy's `443`/`80` instead.

## 6. Wire it up to the live Vercel app

From your local machine, in this repo (requires the Vercel CLI, already
linked to the `your-app-name` project):

```bash
vercel env add EMBED_FN_URL production
# paste: https://embed.yourdomain.com/api/embed   (or the http://<ip>:8000/api/embed from Option B)

vercel env add EMBED_API_KEY production
# paste: the same $EMBED_API_KEY value generated in step 4

vercel --prod
```

Redeploying (`vercel --prod`) is required — environment variable changes
don't take effect on an already-running deployment.

## 7. End-to-end test

First, confirm the embed host itself accepts an authenticated request and
rejects an unauthenticated one:

```bash
# Should succeed (200, {"faces": [...]})
curl -s -X POST "https://embed.yourdomain.com/api/embed" \
  -H "Authorization: Bearer $EMBED_API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @/path/to/a/face.jpg

# Should fail (401 {"error":"unauthorized"})
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://embed.yourdomain.com/api/embed" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @/path/to/a/face.jpg
```

Then confirm the live app is actually using it — search should return real
matches instead of the `502 {"error":"embed_unavailable"}` fallback:

```bash
curl -s -X POST "https://your-app-name.vercel.app/api/search" \
  -F "guestName=Test Guest" \
  -F "selfie=@/path/to/a/face.jpg;type=image/jpeg"
```

A `200` with a `matches` array (even an empty one, if the face isn't in the
gallery) means the embed service is live and wired up correctly. If you
still see `502 {"error":"embed_unavailable"}`, double-check `EMBED_FN_URL`/
`EMBED_API_KEY` were set on the `production` environment and that you
redeployed after adding them (step 6).

## 8. `POST /reel` — reel maker render endpoint

The same container also renders the Jeena "Reel maker" slideshow (spec §3.G):
an ffmpeg job that composites a guest's selected photos into an MP4, muxes a
trimmed bundled song, and uploads the result to the private R2 originals
bucket. **`ffmpeg` is now a required runtime dependency** — installed via
`apt-get` in the `Dockerfile` runtime stage — and `boto3` is in
`requirements.txt` to talk to R2.

```
POST /reel
  headers: Authorization: Bearer <EMBED_API_KEY>  (required only if EMBED_API_KEY is set)
  body: ReelDispatchPayload JSON (see src/lib/reel-client.ts), e.g.
    { "jobId": "<uuid>", "aspect": "4:5", "width": 1080, "height": 1350,
      "totalSeconds": 20, "transition": "kenburns",
      "frames": [{ "url": "<preview url>", "seconds": 5 }, ...],
      "audio": { "url": "<mp3 url>"|null, "startSec": 0 },
      "outputKey": "reels/<jobId>.mp4",
      "callbackUrl": "https://<app>/api/reel/callback" }
  202 -> {"accepted": true, "jobId": "<uuid>"}   (render runs in a background task)
  400 -> {"error": "..."}                        on missing jobId/frames or bad JSON
  401 -> {"error": "unauthorized"}                on missing/wrong bearer (only when EMBED_API_KEY is set)
```

The render itself never blocks the request: `/reel` returns `202` immediately
and does the ffmpeg work + R2 upload in a FastAPI `BackgroundTasks` job. When
it finishes (success or failure) it `POST`s the payload's `callbackUrl` with
the same bearer token and `{jobId, status:"done", outputKey}` or
`{jobId, status:"error", error}` — this is what flips the Next.js app's
`reel_jobs` row from `rendering` to `done`/`error`.

**New environment variables** (in addition to the existing `EMBED_API_KEY`,
`MODEL_BASE_URL`, `INSIGHTFACE_HOME`), all required for `/reel` to be able to
upload the rendered MP4:

| Var | Purpose |
|---|---|
| `R2_ENDPOINT` | Cloudflare R2 S3-compatible endpoint URL |
| `R2_ACCESS_KEY_ID` | R2 access key with write access to the originals bucket |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_ORIGINALS` | Private originals bucket name (reels are written under `reels/<jobId>.mp4`); defaults to `shaadi-photos` |

Add them at `docker run` time alongside the existing env, e.g.:

```bash
docker run -d --restart=always -p 8000:8000 \
  -e EMBED_API_KEY="$EMBED_API_KEY" \
  -e R2_ENDPOINT="https://<account>.r2.cloudflarestorage.com" \
  -e R2_ACCESS_KEY_ID="..." \
  -e R2_SECRET_ACCESS_KEY="..." \
  -e R2_BUCKET_ORIGINALS="shaadi-photos" \
  --name shaadi-embed \
  shaadi-embed
```

After rebuilding the image (`docker build -t shaadi-embed embed-service/`),
recreate the container (`docker rm -f shaadi-embed` then re-run) so the new
`ffmpeg` binary and env vars take effect; the persistent InsightFace model
volume/layer is unaffected, so there's no model re-download. No new Caddy
route is needed — `/reel` is served by the same FastAPI app behind the
existing reverse proxy.
