import type {
  ConfigResponse,
  SearchResponse,
  UploadUrlRequest,
  UploadUrlResponse,
  AdminSettings,
} from "@/lib/types";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // `code` mirrors the API's machine-readable `error` field (e.g.
    // "maintenance", "passcode") so callers can branch without parsing the
    // message string; `message` falls back to statusText when the body has
    // no `error` (e.g. a non-JSON 500 from an upstream proxy).
    const code = (body as { error?: string }).error;
    throw new ApiError(res.status, code ?? res.statusText, code);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * True when `err` is the error `search()` throws for a `502
 * {error:"embed_unavailable"}` response — the face-embedding compute (hosted
 * separately from Vercel, see embed-service/) is unreachable or not deployed
 * yet. Callers should show a calm "check back soon" state, not a generic
 * error, since this is an expected/temporary condition rather than a bug.
 */
export function isEmbedUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 502 && err.code === "embed_unavailable";
}

/** Public client bootstrap: whether a shared guest passcode is required. */
export async function fetchConfig(): Promise<ConfigResponse> {
  return asJson<ConfigResponse>(await fetch("/api/config"));
}

/** Guest face search. `passcode` is only sent when the host requires one. */
export async function search(
  guestName: string,
  selfie: Blob,
  passcode?: string,
): Promise<SearchResponse> {
  const form = new FormData();
  form.append("guestName", guestName);
  form.append("selfie", selfie, "selfie.jpg");
  if (passcode) form.append("passcode", passcode);
  return asJson<SearchResponse>(
    await fetch("/api/search", { method: "POST", body: form }),
  );
}

export const sessionKey = (sid: string) => `shaadi:search:${sid}`;

export function downloadUrl(photoId: string) {
  return `/api/download?photoId=${encodeURIComponent(photoId)}`;
}

export function downloadZipUrl(sessionId: string) {
  return `/api/download-zip?sessionId=${encodeURIComponent(sessionId)}`;
}

/**
 * Fetch a file through the API (so it can be mocked/authorized) and save it.
 * Using fetch instead of a bare <a download> keeps the request on the same
 * network path as the rest of the app.
 */
export async function saveFromApi(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, "Download failed");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function requestUploadUrls(
  body: UploadUrlRequest,
): Promise<UploadUrlResponse> {
  return asJson<UploadUrlResponse>(
    await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** PUT a file to its R2 grant with progress reporting via XHR. */
export function putToR2(
  putUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", putUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new ApiError(xhr.status, `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
    xhr.send(file);
  });
}

export async function uploadComplete(
  sessionId: string,
  keys: string[],
  guestName: string,
): Promise<void> {
  await asJson<{ ok: boolean }>(
    await fetch("/api/upload-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, keys, guestName }),
    }),
  );
}

// ---- Admin ----
export async function adminLogin(password: string): Promise<void> {
  await asJson<{ ok: boolean }>(
    await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
}

export type LogEntry = {
  id: string;
  type: "search" | "upload" | "download";
  guest: string;
  detail: string;
  at: string;
};

export type LogsResponse = {
  logs: LogEntry[];
  page: number;
  pageSize: number;
  total: number;
};

export async function fetchLogs(page: number): Promise<LogsResponse> {
  return asJson<LogsResponse>(await fetch(`/api/admin/logs?page=${page}`));
}

export type MediaItem = {
  id: string;
  kind: "photo" | "video";
  guest: string | null;
  thumbUrl: string;
  uploadedAt: string;
};

export async function fetchMedia(): Promise<{ media: MediaItem[] }> {
  return asJson<{ media: MediaItem[] }>(await fetch("/api/admin/media"));
}

export async function fetchSettings(): Promise<AdminSettings> {
  return asJson<AdminSettings>(await fetch("/api/admin/settings"));
}

export async function updateSettings(
  patch: Partial<AdminSettings>,
): Promise<AdminSettings> {
  return asJson<AdminSettings>(
    await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteMedia(photoId: string): Promise<void> {
  await asJson<{ ok: boolean }>(
    await fetch("/api/admin/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId }),
    }),
  );
}
