"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, ImageOff, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { SearchResponse } from "@/lib/types";
import { Brand } from "@/components/Brand";
import { Garland } from "@/components/Garland";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Lightbox } from "@/components/Lightbox";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadZipUrl, saveFromApi, sessionKey } from "@/lib/api";
import { cn } from "@/lib/utils";

type StoredSearch = SearchResponse & { guestName?: string };

function ResultsInner() {
  const params = useSearchParams();
  const sid = params.get("sid");
  const [data, setData] = useState<StoredSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [zipping, setZipping] = useState(false);

  async function downloadAll() {
    if (!sid || zipping) return;
    setZipping(true);
    try {
      await saveFromApi(downloadZipUrl(sid), `shaadi-${sid}.zip`);
      toast.success("Your album is downloading");
    } catch {
      toast.error("Couldn't prepare the download", { description: "Please try again." });
    } finally {
      setZipping(false);
    }
  }

  useEffect(() => {
    if (!sid) {
      setLoading(false);
      return;
    }
    const raw = sessionStorage.getItem(sessionKey(sid));
    if (raw) {
      try {
        setData(JSON.parse(raw) as StoredSearch);
      } catch {
        setData(null);
      }
    }
    // small settle so skeletons don't flash-and-vanish
    const t = setTimeout(() => setLoading(false), 250);
    return () => clearTimeout(t);
  }, [sid]);

  const matches = data?.matches ?? [];
  const hasPhotos = matches.length > 0;

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
          <span className="w-16" aria-hidden />
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

      <section className="mt-7" aria-live="polite" aria-busy={loading}>
        {loading ? (
          <ul className="columns-2 gap-3 sm:columns-3 [&>li]:mb-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="break-inside-avoid">
                <Skeleton style={{ height: 120 + (i % 3) * 60 }} className="w-full" />
              </li>
            ))}
          </ul>
        ) : hasPhotos ? (
          <PhotoGrid photos={matches} onSelect={setOpenIndex} />
        ) : (
          <EmptyState />
        )}
      </section>

      {hasPhotos && sid && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="hidden text-sm text-muted-foreground sm:block">
              Keep them all in one download.
            </p>
            <Button
              type="button"
              variant="marigold"
              size="xl"
              data-testid="download-all"
              onClick={downloadAll}
              disabled={zipping}
              className="flex-1 sm:ml-auto sm:flex-none"
            >
              {zipping ? <Loader2 className="animate-spin" /> : <Download />}
              Download all (ZIP)
            </Button>
          </div>
        </div>
      )}

      {openIndex !== null && hasPhotos && (
        <Lightbox
          photos={matches}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
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
