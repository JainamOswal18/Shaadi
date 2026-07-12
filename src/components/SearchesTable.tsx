"use client";

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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.selfieUrl}
                    alt={`Selfie from ${s.guestName ?? "a guest"}`}
                    className="size-10 rounded-full border border-border object-cover"
                  />
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
    </div>
  );
}
