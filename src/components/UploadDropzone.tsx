"use client";

import { useCallback, useRef, useState } from "react";
import {
  CircleCheck,
  CircleAlert,
  CloudUpload,
  Film,
  ImageIcon,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { UploadUrlRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { requestUploadUrls, putToR2, uploadComplete } from "@/lib/api";
import { cn } from "@/lib/utils";

const MAX_PHOTO_BYTES = 25 * 1024 * 1024; // 25 MB
// Kept in sync with the server's VIDEO_MAX_BYTES (src/app/api/upload-url/route.ts)
// so the client rejects oversized videos with the same limit the server enforces,
// instead of accepting a file the server will then silently drop.
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB

type Kind = "photo" | "video";
type Status = "queued" | "uploading" | "done" | "error";
type Item = {
  id: string;
  file: File;
  kind: Kind;
  progress: number;
  status: Status;
  error?: string;
};

function kindOf(file: File): Kind | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function humanSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDropzone({
  remaining,
  onRemainingChange,
  guestName,
}: {
  remaining: { photos: number; videos: number };
  onRemainingChange: (r: { photos: number; videos: number }) => void;
  guestName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  // A real UUID: the backend validates `sessionId` with zod's `.uuid()`, and
  // per-session upload quotas are tracked in Postgres keyed by this id, so it
  // must stay stable for the lifetime of this page (not a placeholder string).
  const [sessionId] = useState(() => crypto.randomUUID());

  const queued = items.filter((i) => i.status === "queued");
  const queuedPhotos = queued.filter((i) => i.kind === "photo").length;
  const queuedVideos = queued.filter((i) => i.kind === "video").length;

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      setItems((prev) => {
        let photoRoom = remaining.photos - prev.filter((i) => i.kind === "photo" && i.status !== "error").length;
        let videoRoom = remaining.videos - prev.filter((i) => i.kind === "video" && i.status !== "error").length;
        const next = [...prev];
        const rejected: string[] = [];
        for (const file of incoming) {
          const kind = kindOf(file);
          if (!kind) {
            rejected.push(`${file.name}: only photos and videos are allowed`);
            continue;
          }
          const limit = kind === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
          if (file.size > limit) {
            rejected.push(`${file.name}: too large (max ${humanSize(limit)})`);
            continue;
          }
          if (kind === "photo" && photoRoom <= 0) {
            rejected.push(`${file.name}: photo limit reached`);
            continue;
          }
          if (kind === "video" && videoRoom <= 0) {
            rejected.push(`${file.name}: video limit reached`);
            continue;
          }
          if (kind === "photo") photoRoom -= 1;
          else videoRoom -= 1;
          next.push({
            id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
            file,
            kind,
            progress: 0,
            status: "queued",
          });
        }
        if (rejected.length) {
          toast.error(`Couldn't add ${rejected.length} file${rejected.length > 1 ? "s" : ""}`, {
            description: rejected.slice(0, 3).join(" · "),
          });
        }
        return next;
      });
    },
    [remaining.photos, remaining.videos],
  );

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  const patch = (id: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function startUpload() {
    const toUpload = items.filter((i) => i.status === "queued");
    const trimmedGuestName = guestName.trim();
    if (!toUpload.length || busy) return;
    setBusy(true);
    try {
      const body: UploadUrlRequest = {
        sessionId,
        guestName: trimmedGuestName,
        files: toUpload.map((i) => ({
          // F-dup: the server treats `name` as an opaque round-trip token (it
          // never uses it to derive the R2 key or anything persisted) — send
          // our own unique item id instead of the raw filename so grants
          // correlate correctly even when two queued files share a filename.
          name: i.id,
          type: i.file.type,
          size: i.file.size,
          kind: i.kind,
        })),
      };
      const { grants, remaining: nextRemaining } = await requestUploadUrls(body);
      const byId = new Map(grants.map((g) => [g.name, g]));

      const uploadedKeys: string[] = [];
      await Promise.all(
        toUpload.map(async (item) => {
          const grant = byId.get(item.id);
          if (!grant) {
            patch(item.id, { status: "error", error: "No upload slot" });
            return;
          }
          patch(item.id, { status: "uploading", progress: 0 });
          try {
            await putToR2(grant.putUrl, item.file, (f) =>
              patch(item.id, { progress: Math.round(f * 100) }),
            );
            patch(item.id, { status: "done", progress: 100 });
            uploadedKeys.push(grant.key);
          } catch {
            patch(item.id, { status: "error", error: "Upload failed" });
          }
        }),
      );

      if (uploadedKeys.length) {
        await uploadComplete(body.sessionId, uploadedKeys, trimmedGuestName);
        onRemainingChange(nextRemaining);
        toast.success(`Uploaded ${uploadedKeys.length} file${uploadedKeys.length > 1 ? "s" : ""}`, {
          description: "Thank you for sharing the memories.",
        });
      }
    } catch {
      toast.error("Upload failed", { description: "Please check your connection and retry." });
    } finally {
      setBusy(false);
    }
  }

  const overQuota =
    queuedPhotos > remaining.photos || queuedVideos > remaining.videos;
  const needsGuestName = guestName.trim().length < 2;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Add photos or videos"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
          dragging
            ? "border-marigold bg-invitation"
            : "border-border bg-card hover:border-marigold/60 hover:bg-invitation",
        )}
      >
        <span className="grid size-14 place-items-center rounded-full bg-secondary text-marigold-deep">
          <CloudUpload className="size-7" />
        </span>
        <div>
          <p className="font-heading text-lg font-semibold text-maroon">Add your photos &amp; videos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap to choose, or drag files here. Up to {remaining.photos} photos and{" "}
            {remaining.videos} videos.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="upload-list">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="upload-item"
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-marigold-deep">
                {item.kind === "photo" ? <ImageIcon className="size-5" /> : <Film className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{item.file.name}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-200",
                        item.status === "error" ? "bg-destructive" : "bg-marigold",
                      )}
                      style={{ width: `${item.status === "done" ? 100 : item.progress}%` }}
                    />
                  </div>
                  <span className="tabular w-14 shrink-0 text-right text-xs text-muted-foreground">
                    {item.status === "done"
                      ? "Done"
                      : item.status === "error"
                        ? "Failed"
                        : item.status === "uploading"
                          ? `${item.progress}%`
                          : humanSize(item.file.size)}
                  </span>
                </div>
              </div>
              <span className="shrink-0">
                {item.status === "done" ? (
                  <CircleCheck className="size-5 text-henna" />
                ) : item.status === "error" ? (
                  <CircleAlert className="size-5 text-destructive" />
                ) : item.status === "uploading" ? (
                  <Loader2 className="size-5 animate-spin text-marigold-deep" />
                ) : (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          size="xl"
          className="sm:flex-none"
          onClick={() => inputRef.current?.click()}
        >
          <Plus /> Add more
        </Button>
        <Button
          type="button"
          variant="marigold"
          size="xl"
          className="sm:ml-auto sm:flex-none"
          data-testid="start-upload"
          disabled={queued.length === 0 || busy || overQuota || needsGuestName}
          onClick={startUpload}
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" /> Uploading&hellip;
            </>
          ) : (
            <>
              <CloudUpload /> Upload {queued.length > 0 ? `${queued.length} file${queued.length > 1 ? "s" : ""}` : ""}
            </>
          )}
        </Button>
        {items.some((i) => i.status === "done") && (
          <Button
            type="button"
            variant="ghost"
            size="xl"
            className="sm:flex-none"
            onClick={() => setItems((prev) => prev.filter((i) => i.status !== "done"))}
          >
            <Trash2 /> Clear finished
          </Button>
        )}
      </div>
    </div>
  );
}
