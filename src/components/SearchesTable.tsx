"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import type { SearchLogItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Admin-only "Who searched" feed: selfie thumbnail + guest + time + matches. */
export function SearchesTable({
  searches,
  hasMore,
  loading,
  onLoadMore,
}: {
  searches: SearchLogItem[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  // The selfie currently being viewed full-size (null = dialog closed).
  const [preview, setPreview] = useState<{ url: string; name: string; at: string } | null>(null);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Selfie</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead>When</TableHead>
            <TableHead className="text-right">Matches</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {searches.length === 0 && !loading && (
            <TableRow>
              <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                No searches yet.
              </TableCell>
            </TableRow>
          )}
          {searches.map((s) => (
            <TableRow key={s.id} data-testid="search-row">
              <TableCell>
                {s.selfieUrl ? (
                  // Tap to open the selfie full-size.
                  <button
                    type="button"
                    onClick={() =>
                      setPreview({ url: s.selfieUrl!, name: s.guestName ?? "Guest", at: s.at })
                    }
                    className="rounded-full outline-none ring-offset-2 transition focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
                    aria-label={`View selfie from ${s.guestName ?? "a guest"} full size`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.selfieUrl}
                      alt={`Selfie from ${s.guestName ?? "a guest"}`}
                      className="size-10 cursor-zoom-in rounded-full border border-border object-cover"
                    />
                  </button>
                ) : (
                  <span className="grid size-10 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                    <UserRound className="size-4" />
                  </span>
                )}
              </TableCell>
              <TableCell className="font-medium">{s.guestName ?? "Guest"}</TableCell>
              <TableCell className="tabular text-xs text-muted-foreground">
                {new Date(s.at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </TableCell>
              <TableCell className="tabular text-right text-muted-foreground">
                {s.matchCount}
              </TableCell>
            </TableRow>
          ))}
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                <TableCell colSpan={4}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>

      {hasMore && (
        <div className="flex justify-center border-t border-border px-3 py-3">
          <Button variant="outline" size="touch" disabled={loading} onClick={onLoadMore}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="font-heading text-lg text-maroon">
            {preview?.name}
            {preview && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {new Date(preview.at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </DialogTitle>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={`Selfie from ${preview.name}`}
              className="max-h-[70vh] w-full rounded-xl border border-border object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
