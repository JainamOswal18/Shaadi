"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download as DownloadIcon,
  ImagePlus,
  Loader2,
  Music,
  Play,
  Share2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { SearchResponse } from "@/lib/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { createReel, pollReel } from "@/lib/api";
import {
  ASPECTS,
  DEFAULT_SECONDS,
  MAX_PHOTOS,
  MAX_SECONDS,
  MIN_SECONDS,
  SONG_CATALOG,
  TRANSITIONS,
  aspectDimensions,
  songById,
  splitDurations,
  type Aspect,
  type ReelSpec,
  type Transition,
} from "@/lib/reel";
import { cn } from "@/lib/utils";

type Photo = SearchResponse["matches"][number];
type Phase = "editing" | "rendering" | "done" | "error";

// How often to poll /api/reel while a job is rendering.
const POLL_INTERVAL_MS = 2000;

export function ReelMaker({
  photos,
  guestName,
  onClose,
}: {
  photos: Photo[];
  guestName: string;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<Photo[]>(() => photos.slice(0, MAX_PHOTOS));
  const [aspect, setAspect] = useState<Aspect>("4:5");
  const [totalSeconds, setTotalSeconds] = useState<number>(DEFAULT_SECONDS);
  const [transition, setTransition] = useState<Transition>("kenburns");
  const [songId, setSongId] = useState<string>("silent");
  const [songStartSec, setSongStartSec] = useState<number>(0);
  const [phase, setPhase] = useState<Phase>("editing");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Stop polling on unmount so a closed editor never sets state after the
  // fact (or leaks a timer).
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const song = songById(songId);
  const durations = useMemo(
    () => splitDurations(totalSeconds, order.length),
    [totalSeconds, order.length],
  );

  // Clamp the trim-start offset whenever the song or total length changes so
  // the selected clip always fits inside the track's duration.
  useEffect(() => {
    if (!song || song.duration <= 0) {
      setSongStartSec(0);
      return;
    }
    setSongStartSec((s) => Math.min(s, Math.max(0, song.duration - totalSeconds)));
  }, [song, totalSeconds]);

  function removePhoto(photoId: string) {
    setOrder((cur) => cur.filter((p) => p.photoId !== photoId));
  }

  function move(index: number, dir: -1 | 1) {
    setOrder((cur) => {
      const next = cur.slice();
      const j = index + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function startPolling(id: string) {
    pollTimer.current = setInterval(async () => {
      try {
        const res = await pollReel(id);
        if (res.status === "done") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setVideoUrl(res.url ?? null);
          setPhase("done");
        } else if (res.status === "error") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setErrorMsg(res.error ?? "Something went wrong");
          setPhase("error");
        }
      } catch {
        // Transient poll failure — the interval tries again next tick.
      }
    }, POLL_INTERVAL_MS);
  }

  async function onCreate() {
    if (order.length < 1 || phase === "rendering") return;
    setPhase("rendering");
    setErrorMsg(null);
    try {
      const spec: ReelSpec = {
        photoIds: order.map((p) => p.photoId),
        aspect,
        totalSeconds,
        transition,
        song: { id: songId, startSec: Math.round(songStartSec) },
      };
      const { jobId } = await createReel(spec);
      startPolling(jobId);
    } catch {
      setErrorMsg("Couldn't start the render");
      setPhase("error");
      toast.error("Couldn't start the render", { description: "Please try again." });
    }
  }

  function backToEditing() {
    setPhase("editing");
    setErrorMsg(null);
  }

  function onAddToGallery() {
    // The reel already lives in reel_jobs (admin-visible, see the Reels tab) —
    // no separate upload step is needed here.
    toast.success("Saved to the album", {
      description: "Your reel will show up in the gallery.",
    });
  }

  async function onShare() {
    if (!videoUrl) return;
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share) {
        await nav.share({ url: videoUrl, title: "Nameeta ki Shaadi", text: "Our reel" });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = "reel.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function previewSong() {
    const el = audioRef.current;
    if (!el || !song?.src) return;
    el.currentTime = songStartSec;
    el.play().catch(() => undefined);
    window.setTimeout(() => el.pause(), 3000);
  }

  const dimensions = aspectDimensions(aspect);
  const overLimit = photos.length > MAX_PHOTOS;
  const busy = phase === "rendering";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Make a reel"
      data-testid="reel-maker"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-border px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <h2 className="font-heading text-lg font-semibold text-maroon">Make a reel</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reel maker"
          className="grid size-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 pb-40 pt-4 lg:max-w-lg">
          {phase === "done" && videoUrl ? (
            <div className="rounded-2xl border border-border bg-invitation p-3 shadow-[var(--shadow-card)]">
              <video
                data-testid="reel-video"
                src={videoUrl}
                controls
                playsInline
                className="w-full rounded-xl bg-black"
                style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
              />
            </div>
          ) : (
            <>
              {/* Photo strip */}
              <section>
                <p className="mb-2 text-sm font-medium text-foreground">
                  {order.length} photo{order.length === 1 ? "" : "s"}
                  {overLimit ? ` (max ${MAX_PHOTOS})` : ""}
                </p>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  {order.map((p, i) => (
                    <div
                      key={p.photoId}
                      data-testid={`reel-photo-${p.photoId}`}
                      className="relative w-24 shrink-0"
                    >
                      <div className="aspect-square overflow-hidden rounded-xl bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumbUrl} alt="" className="size-full object-cover" />
                      </div>
                      <button
                        type="button"
                        onClick={() => removePhoto(p.photoId)}
                        aria-label="Remove photo"
                        data-testid={`reel-remove-${p.photoId}`}
                        disabled={busy}
                        className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-sm disabled:opacity-40"
                      >
                        <X className="size-3.5" />
                      </button>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className="tabular text-[11px] text-muted-foreground">
                          {(durations[i] ?? 0).toFixed(1)}s
                        </span>
                        <span className="flex gap-0.5">
                          <button
                            type="button"
                            onClick={() => move(i, -1)}
                            aria-label="Move earlier"
                            disabled={i === 0 || busy}
                            className="grid size-5 place-items-center rounded text-muted-foreground disabled:opacity-30"
                          >
                            <ArrowUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(i, 1)}
                            aria-label="Move later"
                            disabled={i === order.length - 1 || busy}
                            className="grid size-5 place-items-center rounded text-muted-foreground disabled:opacity-30"
                          >
                            <ArrowDown className="size-3" />
                          </button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Aspect */}
              <section className="mt-6">
                <p className="mb-2 text-sm font-medium text-foreground">Shape</p>
                <div className="grid grid-cols-2 gap-2">
                  {ASPECTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAspect(a)}
                      aria-pressed={aspect === a}
                      disabled={busy}
                      className={cn(
                        "flex min-h-11 items-center justify-center rounded-xl border px-2 py-2 text-sm font-medium transition-colors",
                        aspect === a
                          ? "border-marigold-deep bg-accent text-maroon"
                          : "border-border bg-card text-muted-foreground hover:border-marigold/60",
                      )}
                    >
                      {a === "4:5" ? "Portrait (4:5)" : "Story (9:16)"}
                    </button>
                  ))}
                </div>
              </section>

              {/* Transition */}
              <section className="mt-6">
                <p className="mb-2 text-sm font-medium text-foreground">Transition</p>
                <div className="grid grid-cols-3 gap-2">
                  {TRANSITIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTransition(t)}
                      aria-pressed={transition === t}
                      disabled={busy}
                      className={cn(
                        "flex min-h-11 items-center justify-center rounded-xl border px-1 py-2 text-center text-xs font-medium capitalize transition-colors",
                        transition === t
                          ? "border-marigold-deep bg-accent text-maroon"
                          : "border-border bg-card text-muted-foreground hover:border-marigold/60",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </section>

              {/* Length */}
              <section className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">Length</p>
                  <span
                    data-testid="reel-length-label"
                    className="tabular text-xs text-muted-foreground"
                  >
                    {totalSeconds}s
                  </span>
                </div>
                <Slider
                  value={[totalSeconds]}
                  min={MIN_SECONDS}
                  max={MAX_SECONDS}
                  step={1}
                  onValueChange={(v) => setTotalSeconds(Array.isArray(v) ? v[0] : v)}
                  aria-label="Reel length"
                  disabled={busy}
                />
              </section>

              {/* Song */}
              <section className="mt-6">
                <p className="mb-2 text-sm font-medium text-foreground">Music</p>
                <div className="flex flex-col gap-2">
                  {SONG_CATALOG.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSongId(s.id)}
                      aria-pressed={songId === s.id}
                      disabled={busy}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors",
                        songId === s.id
                          ? "border-marigold-deep bg-accent text-maroon"
                          : "border-border bg-card text-muted-foreground hover:border-marigold/60",
                      )}
                    >
                      <Music className="size-4 shrink-0" />
                      <span className="flex-1">
                        {s.title}
                        {s.artist !== "—" && (
                          <span className="ml-1 text-xs opacity-70">— {s.artist}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                {song && song.duration > 0 && (
                  <div className="mt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Start point</p>
                      <span className="tabular text-xs text-muted-foreground">
                        {Math.round(songStartSec)}s
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[songStartSec]}
                        min={0}
                        max={Math.max(0, song.duration - totalSeconds)}
                        step={1}
                        onValueChange={(v) => setSongStartSec(Array.isArray(v) ? v[0] : v)}
                        aria-label="Music start point"
                        disabled={busy}
                      />
                      <button
                        type="button"
                        onClick={previewSong}
                        aria-label="Preview music"
                        disabled={busy}
                        className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-maroon disabled:opacity-40"
                      >
                        <Play className="size-4" />
                      </button>
                    </div>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio ref={audioRef} src={song.src} className="hidden" />
                  </div>
                )}
              </section>

              {phase === "error" && (
                <section className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
                  <p data-testid="reel-error" className="text-sm text-destructive">
                    {errorMsg ?? "The render failed."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={backToEditing}
                  >
                    Try again
                  </Button>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sticky actions */}
      <div
        className="border-t border-border bg-background/90 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-md lg:max-w-lg">
          {phase === "done" ? (
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" size="touch" onClick={onShare}>
                <Share2 /> Share
              </Button>
              <Button
                type="button"
                variant="outline"
                size="touch"
                data-testid="reel-add-gallery"
                onClick={onAddToGallery}
              >
                <ImagePlus /> Gallery
              </Button>
              <a
                href={videoUrl ?? "#"}
                download="reel.mp4"
                data-testid="reel-download"
                className={cn(buttonVariants({ variant: "marigold", size: "touch" }))}
              >
                <DownloadIcon /> Save
              </a>
            </div>
          ) : (
            <Button
              type="button"
              variant="marigold"
              size="touch"
              className="w-full"
              data-testid="reel-create"
              onClick={onCreate}
              disabled={order.length < 1 || busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Play />}
              {busy ? "Rendering…" : "Create reel"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
