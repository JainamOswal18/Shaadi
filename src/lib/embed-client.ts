import { loadEnv } from "./env";
import type { EmbedFace, EmbedResponse } from "./types";

/**
 * Default target for local development: the face-embedding function served by
 * `vercel dev` (or a standalone runner) at `POST /api/embed`. In deployed
 * environments this is overridden by `EMBED_FN_URL` (the deployed function URL).
 */
const DEFAULT_EMBED_FN_URL = "http://127.0.0.1:8000/api/embed";

function embedFnUrl(): string {
  return loadEnv().EMBED_FN_URL ?? DEFAULT_EMBED_FN_URL;
}

// Hard ceiling on a single embed call. Cold starts on the face-embedding
// function can take a while, but a call that hasn't returned in a minute is
// treated as unreachable so callers fail fast (a clean 5xx) instead of hanging
// the request / holding a serverless invocation open.
const EMBED_TIMEOUT_MS = 60_000;

/**
 * Send raw image bytes to the face-embedding function and return every detected
 * face with its 512-d normalized embedding, bounding box, and detection score.
 *
 * The body is the raw image (no multipart wrapping); the Python function reads
 * `Content-Length` bytes and treats a non-JSON body as the image itself.
 */
export async function embedImage(bytes: Buffer | Uint8Array): Promise<EmbedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  const apiKey = loadEnv().EMBED_API_KEY;
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  // Only sent when EMBED_API_KEY is configured — matches embed-service/app.py,
  // which allows unauthenticated requests when it has no key of its own set.
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  let res: Response;
  try {
    res = await fetch(embedFnUrl(), {
      method: "POST",
      headers,
      // BodyInit accepts Uint8Array/Buffer directly in Node's fetch.
      body: bytes as unknown as BodyInit,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`embed function timed out after ${EMBED_TIMEOUT_MS}ms`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = `: ${body.error}`;
    } catch {
      // Non-JSON error body — surface the status alone.
    }
    throw new Error(`embed function returned ${res.status}${detail}`);
  }

  return (await res.json()) as EmbedResponse;
}

function bboxArea(face: EmbedFace): number {
  const [x1, y1, x2, y2] = face.bbox;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/**
 * Return the embedding of the largest detected face (by bounding-box area), or
 * `null` when no faces were detected. Used to pick the subject of a portrait /
 * selfie when a single canonical embedding is needed.
 */
export function largestFace(r: EmbedResponse): number[] | null {
  let best: EmbedFace | null = null;
  let bestArea = -Infinity;
  for (const face of r.faces) {
    const area = bboxArea(face);
    if (area > bestArea) {
      bestArea = area;
      best = face;
    }
  }
  return best ? best.embedding : null;
}
