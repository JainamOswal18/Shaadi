import { loadEnv } from "./env";
import type { Aspect, Transition } from "./reel";

/**
 * Default target for local development: the reel-render endpoint served by
 * the embed-service FastAPI app (see embed-service/app.py) at `POST /reel`.
 * In deployed environments this is overridden by `REEL_FN_URL` (the same EC2
 * box, over the deployed Caddy HTTPS route).
 */
const DEFAULT_REEL_FN_URL = "http://127.0.0.1:8000/reel";

// Dispatch only returns 202 immediately — the render itself runs async on the
// box and reports back via `callbackUrl` — so this timeout only bounds how
// long we wait for that acknowledgement, not the render.
const REEL_DISPATCH_TIMEOUT_MS = 15_000;

export interface ReelFrame {
  url: string;
  seconds: number;
}

export interface ReelDispatchPayload {
  jobId: string;
  aspect: Aspect;
  width: number;
  height: number;
  totalSeconds: number;
  transition: Transition;
  frames: ReelFrame[];
  audio: { url: string | null; startSec: number };
  outputKey: string; // reels/<jobId>.mp4
  callbackUrl: string; // https://<app>/api/reel/callback
}

function reelFnUrl(): string {
  return loadEnv().REEL_FN_URL ?? DEFAULT_REEL_FN_URL;
}

/**
 * Dispatch a render to the EC2 service. Mirrors embed-client.ts: bearer auth
 * only when EMBED_API_KEY is set, AbortController timeout, clean throw on
 * unreachable. The service returns 202 immediately and renders in the
 * background, calling back /api/reel/callback on completion.
 */
export async function dispatchReel(payload: ReelDispatchPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REEL_DISPATCH_TIMEOUT_MS);
  const apiKey = loadEnv().EMBED_API_KEY;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  let res: Response;
  try {
    res = await fetch(reelFnUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`reel dispatch timed out after ${REEL_DISPATCH_TIMEOUT_MS}ms`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
  if (res.status !== 202 && !res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = `: ${body.error}`;
    } catch {
      // non-JSON error body — surface the status alone.
    }
    throw new Error(`reel service returned ${res.status}${detail}`);
  }
}
