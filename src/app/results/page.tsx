"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, ImageOff, LayoutGrid, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { SearchResponse } from "@/lib/types";
import { Brand } from "@/components/Brand";
import { Garland } from "@/components/Garland";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Lightbox } from "@/components/Lightbox";
import { CollageMaker } from "@/components/CollageMaker";
import { AccountMenu } from "@/components/AccountMenu";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  downloadZipUrl,
  fetchSession,
  saveFromApi,
  sessionKey,
  ZIP_PART_SIZE,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getRecentGuests,
  logout as logoutGuest,
  remember,
  type RememberedGuest,
} from "@/lib/guest-store";
import { cn } from "@/lib/utils";

type StoredSearch = SearchResponse & { guestName?: string };

function ResultsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sid = params.get("sid");
  const [data, setData] = useState<StoredSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [zipping, setZipping] = useState(false);
  // Big albums exceed the single-ZIP cap; this opens the "download in parts" sheet.
  const [partsOpen, setPartsOpen] = useState(false);
  const [recents, setRecents] = useState<RememberedGuest[]>([]);
  // Collage flow: `selecting` turns the grid into a multi-select; `collageOpen`
  // launches the editor over the chosen photos.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collageOpen, setCollageOpen] = useState(false);

  const toggleSelected = (photoId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });

  function startSelecting() {
    setSelected(new Set());
    setSelecting(true);
  }
  function cancelSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function downloadAll() {
    if (!sid || zipping) return;
    setZipping(true);
    try {
      await saveFromApi(downloadZipUrl(sid), `shaadi-${sid}.zip`);
      toast.success("Your album is downloading");
    } catch (err) {
      // The ZIP route returns a JSON control signal (not a file) for oversized
      // selections and rate-limited callers; saveFromApi surfaces those as a
      // typed ApiError with a machine-readable `code` instead of saving JSON.
      if (err instanceof ApiError && err.code === "prepare") {
        // Too large for one ZIP — offer the part-by-part download instead.
        setPartsOpen(true);
      } else if (err instanceof ApiError && err.code === "rate_limited") {
        toast.error("Too many downloads right now", {
          description: "Please wait a minute and try again.",
        });
      } else {
        toast.error("Couldn't prepare the download", { description: "Please try again." });
      }
    } finally {
      setZipping(false);
    }
  }

  useEffect(() => {
    setRecents(getRecentGuests());
  }, [sid]);

  useEffect(() => {
    if (!sid) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    // Fast path: the search we just ran is cached in sessionStorage.
    const raw = sessionStorage.getItem(sessionKey(sid));
    if (raw) {
      try {
        setData(JSON.parse(raw) as StoredSearch);
        // small settle so skeletons don't flash-and-vanish
        const t = setTimeout(() => setLoading(false), 250);
        return () => clearTimeout(t);
      } catch {
        // fall through to server restore
      }
    }

    // Cache miss (hard reload, new tab, or a remembered guest returning):
    // rebuild the album from the DB by session id — no selfie needed.
    fetchSession(sid)
      .then((res) => {
        if (cancelled) return;
        const stored: StoredSearch = {
          sessionId: res.sessionId,
          matches: res.matches,
          guestName: res.guestName ?? undefined,
        };
        setData(stored);
        try {
          sessionStorage.setItem(sessionKey(sid), JSON.stringify(stored));
        } catch {
          // sessionStorage unavailable — non-fatal.
        }
        if (res.guestName) {
          remember({
            name: res.guestName,
            sessionId: res.sessionId,
            matchCount: res.matches.length,
          });
          setRecents(getRecentGuests());
        }
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sid]);

  const guestName = data?.guestName;

  function handleLogout() {
    logoutGuest();
    router.push("/");
  }

  function handleSwitch(sessionId: string) {
    router.push(`/results?sid=${encodeURIComponent(sessionId)}`);
  }

  const others = recents.filter((g) => g.sessionId !== sid);

  const matches = data?.matches ?? [];
  const hasPhotos = matches.length > 0;

  // Albums past the single-ZIP cap download as fixed-size slices. We surface the
  // parts UI proactively when the photo count alone is over the limit (so the
  // first tap isn't a wasted full attempt); a byte-triggered overflow at a lower
  // count is still caught via the `prepare` signal in downloadAll().
  const needsParts = matches.length > ZIP_PART_SIZE;
  const zipParts =
    sid && matches.length > 0
      ? Array.from({ length: Math.ceil(matches.length / ZIP_PART_SIZE) }, (_, i) => {
          const start = i * ZIP_PART_SIZE;
          const end = Math.min(start + ZIP_PART_SIZE, matches.length);
          return {
            index: i,
            start,
            end,
            href: downloadZipUrl(sid, start, ZIP_PART_SIZE),
          };
        })
      : [];
  const selectedPhotos = matches.filter((m) => selected.has(m.photoId));

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-28 pt-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex w-full items-center justify-between">
          <Link
            href="/"
            className="inline-flex h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Home
          </Link>
          <Brand size="sm" />
          {guestName ? (
            <AccountMenu
              activeName={guestName}
              others={others}
              onSwitch={handleSwitch}
              onSomeoneElse={() => router.push("/")}
              onLogout={handleLogout}
            />
          ) : (
            <span className="w-16" aria-hidden />
          )}
        </div>
        <Garland count={9} className="mt-1" />
        <h1 className="mt-1 font-heading text-2xl font-semibold text-maroon sm:text-3xl">
          {data?.guestName ? `${data.guestName}'s photos` : "Your photos"}
        </h1>
        {!loading && (
          <p className="text-sm text-muted-foreground">
            {hasPhotos
              ? `We found ${matches.length} ${matches.length === 1 ? "photo" : "photos"} of you.`
              : "No matches yet."}
          </p>
        )}
      </header>

      {!loading && hasPhotos && !selecting && (
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="flex-1"
            data-testid="make-collage"
            onClick={startSelecting}
          >
            <LayoutGrid /> Make a collage
          </Button>
          <Link
            href="/upload"
            className={cn(buttonVariants({ variant: "secondary", size: "touch" }), "flex-1")}
          >
            <Upload /> Add your photos to the album
          </Link>
        </div>
      )}

      {selecting && (
        <div
          data-testid="collage-select-bar"
          className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-marigold/50 bg-invitation px-4 py-3"
        >
          <p className="text-sm font-medium text-maroon">
            {selected.size === 0
              ? "Tap photos to add them"
              : `${selected.size} selected`}
          </p>
          <button
            type="button"
            onClick={cancelSelecting}
            className="inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-maroon"
          >
            Cancel
          </button>
        </div>
      )}

      <section className="mt-5" aria-live="polite" aria-busy={loading}>
        {loading ? (
          <ul className="columns-2 gap-3 sm:columns-3 [&>li]:mb-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="break-inside-avoid">
                <Skeleton style={{ height: 120 + (i % 3) * 60 }} className="w-full" />
              </li>
            ))}
          </ul>
        ) : hasPhotos ? (
          <PhotoGrid
            photos={matches}
            onSelect={setOpenIndex}
            selectable={selecting}
            selectedIds={selected}
            onToggle={toggleSelected}
          />
        ) : (
          <EmptyState />
        )}
      </section>

      {hasPhotos && sid && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            {selecting ? (
              <Button
                type="button"
                variant="marigold"
                size="xl"
                data-testid="collage-continue"
                onClick={() => setCollageOpen(true)}
                disabled={selected.size < 1}
                className="flex-1"
              >
                <LayoutGrid />
                {selected.size < 1
                  ? "Select photos to continue"
                  : `Make collage (${selected.size})`}
              </Button>
            ) : (
              <>
                <p className="hidden text-sm text-muted-foreground sm:block">
                  Keep them all in one download.
                </p>
                <Button
                  type="button"
                  variant="marigold"
                  size="xl"
                  data-testid="download-all"
                  onClick={needsParts ? () => setPartsOpen(true) : downloadAll}
                  disabled={zipping}
                  className="flex-1 sm:ml-auto sm:flex-none"
                >
                  {zipping ? <Loader2 className="animate-spin" /> : <Download />}
                  {needsParts ? "Download all (in parts)" : "Download all (ZIP)"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {openIndex !== null && hasPhotos && !selecting && (
        <Lightbox
          photos={matches}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}

      <Dialog open={partsOpen} onOpenChange={setPartsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Download in parts</DialogTitle>
            <DialogDescription>
              Your album has {matches.length} photos — too many to zip in one file. Tap
              each part to save it (each is a separate ZIP).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {zipParts.map((part) => (
              <a
                key={part.index}
                href={part.href}
                download
                data-testid={`download-part-${part.index + 1}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "touch" }),
                  "justify-between",
                )}
              >
                <span>
                  Part {part.index + 1} of {zipParts.length}
                </span>
                <span className="text-sm text-muted-foreground">
                  photos {part.start + 1}–{part.end}
                </span>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {collageOpen && (
        <CollageMaker
          photos={selectedPhotos}
          guestName={guestName}
          onClose={() => {
            setCollageOpen(false);
            cancelSelecting();
          }}
        />
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-muted text-marigold-deep">
        <ImageOff className="size-6" />
      </span>
      <h2 className="font-heading text-lg font-semibold text-maroon">
        We couldn&rsquo;t find you yet
      </h2>
      <p className="text-sm text-muted-foreground">
        Photos are still being uploaded. Try again a little later, or start a new search
        with a clearer selfie.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/" className={cn(buttonVariants({ variant: "marigold", size: "touch" }))}>
          Try another selfie
        </Link>
        <Link href="/upload" className={cn(buttonVariants({ variant: "outline", size: "touch" }))}>
          <Upload /> Share photos
        </Link>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={null}>
      <ResultsInner />
    </Suspense>
  );
}
