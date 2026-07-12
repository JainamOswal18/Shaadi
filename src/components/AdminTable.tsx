"use client";

import { ArrowDownToLine, ChevronLeft, ChevronRight, ImageUp, Search } from "lucide-react";
import type { LogEntry } from "@/lib/api";
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
import { cn } from "@/lib/utils";

const typeMeta = {
  search: { label: "Search", icon: Search, className: "text-marigold-deep bg-marigold/10" },
  upload: { label: "Upload", icon: ImageUp, className: "text-henna bg-henna/10" },
  download: { label: "Download", icon: ArrowDownToLine, className: "text-maroon bg-maroon/10" },
} as const;

export function AdminTable({
  logs,
  page,
  pageSize,
  total,
  loading,
  onPageChange,
}: {
  logs: LogEntry[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Activity</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead>Detail</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: pageSize }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            : logs.map((log) => {
                const meta = typeMeta[log.type];
                const Icon = meta.icon;
                return (
                  <TableRow key={log.id} data-testid="log-row">
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                          meta.className,
                        )}
                      >
                        <Icon className="size-3.5" /> {meta.label}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{log.guest}</TableCell>
                    <TableCell className="text-muted-foreground">{log.detail}</TableCell>
                    <TableCell className="tabular text-right text-xs text-muted-foreground">
                      {new Date(log.at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-3">
        <p className="tabular text-xs text-muted-foreground">
          {from}&ndash;{to} of {total}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-touch"
            aria-label="Previous page"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="tabular text-sm text-foreground">
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="icon-touch"
            aria-label="Next page"
            disabled={page >= pages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
