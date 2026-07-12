"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Film,
  ListChecks,
  LogOut,
  Power,
  ScrollText,
  SlidersHorizontal,
  Trash2,
  UserSearch,
} from "lucide-react";
import { toast } from "sonner";
import type { AdminSettings } from "@/lib/types";
import { Brand } from "@/components/Brand";
import { AdminTable } from "@/components/AdminTable";
import { SearchesTable } from "@/components/SearchesTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ApiError,
  deleteMedia,
  fetchLogs,
  fetchMedia,
  fetchSearches,
  fetchSettings,
  updateSettings,
  type LogsResponse,
  type MediaItem,
  type SearchLogItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "logs" | "media" | "searches" | "settings";

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("logs");
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [searches, setSearches] = useState<SearchLogItem[]>([]);
  const [searchesHasMore, setSearchesHasMore] = useState(false);
  const [searchesLoading, setSearchesLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const guard = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/admin/login");
        return true;
      }
      return false;
    },
    [router],
  );

  useEffect(() => {
    (async () => {
      try {
        const [s, l, m, sr] = await Promise.all([
          fetchSettings(),
          fetchLogs(1),
          fetchMedia(),
          fetchSearches(),
        ]);
        setSettings(s);
        setLogs(l);
        setMedia(m.media);
        setSearches(sr.searches);
        setSearchesHasMore(sr.hasMore);
        setReady(true);
      } catch (err) {
        if (!guard(err)) toast.error("Couldn't load the console");
      }
    })();
  }, [guard]);

  const loadMoreSearches = useCallback(async () => {
    setSearchesLoading(true);
    try {
      const res = await fetchSearches(20, searches.length);
      setSearches((prev) => [...prev, ...res.searches]);
      setSearchesHasMore(res.hasMore);
    } catch (err) {
      if (!guard(err)) toast.error("Couldn't load more searches");
    } finally {
      setSearchesLoading(false);
    }
  }, [guard, searches.length]);

  const loadLogs = useCallback(
    async (page: number) => {
      setLogsLoading(true);
      try {
        setLogs(await fetchLogs(page));
      } catch (err) {
        if (!guard(err)) toast.error("Couldn't load logs");
      } finally {
        setLogsLoading(false);
      }
    },
    [guard],
  );

  async function saveSetting(patch: Partial<AdminSettings>, label: string) {
    const previous = settings;
    setSettings((s) => (s ? { ...s, ...patch } : s));
    try {
      const updated = await updateSettings(patch);
      setSettings(updated);
      toast.success(label);
    } catch (err) {
      setSettings(previous);
      if (!guard(err)) toast.error("Couldn't save setting");
    }
  }

  async function onDelete(item: MediaItem) {
    setSavingKey(item.id);
    try {
      await deleteMedia(item.id);
      setMedia((prev) => prev.filter((m) => m.id !== item.id));
      toast.success("Removed from gallery");
    } catch (err) {
      if (!guard(err)) toast.error("Couldn't delete");
    } finally {
      setSavingKey(null);
    }
  }

  function logout() {
    document.cookie = "shaadi_admin=; Max-Age=0; Path=/; SameSite=Lax";
    router.replace("/admin/login");
  }

  const tabs: { id: Tab; label: string; icon: typeof ScrollText }[] = [
    { id: "logs", label: "Activity", icon: ScrollText },
    { id: "media", label: "Media", icon: Film },
    { id: "searches", label: "Who searched", icon: UserSearch },
    { id: "settings", label: "Settings", icon: SlidersHorizontal },
  ];

  if (!ready) {
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-6 h-64 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Brand size="sm" />
          <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Host console
          </span>
        </div>
        <Button variant="outline" size="touch" onClick={logout}>
          <LogOut /> Sign out
        </Button>
      </header>

      {settings?.kill_switch && (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          <Power className="size-4" /> Guest photo search is paused for everyone.
        </div>
      )}

      <nav className="mt-6 inline-flex rounded-xl border border-border bg-card p-1" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors",
                active
                  ? "bg-marigold-deep text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {t.label}
            </button>
          );
        })}
      </nav>

      <section className="mt-5">
        {tab === "logs" && logs && (
          <AdminTable
            logs={logs.logs}
            page={logs.page}
            pageSize={logs.pageSize}
            total={logs.total}
            loading={logsLoading}
            onPageChange={loadLogs}
          />
        )}

        {tab === "media" && (
          <div>
            {media.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
                No media in the gallery.
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {media.map((item) => {
                  const guestLabel = item.guest ?? "Wedding team";
                  return (
                  <li
                    key={item.id}
                    data-testid="media-item"
                    className="group relative overflow-hidden rounded-xl border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbUrl}
                      alt={`${item.kind} by ${guestLabel}`}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-maroon/85 to-transparent p-2 pt-6">
                      <span className="truncate text-xs font-medium text-cream">{guestLabel}</span>
                      <Dialog>
                        <DialogTrigger
                          aria-label={`Delete ${item.kind} by ${guestLabel}`}
                          className="grid size-8 shrink-0 place-items-center rounded-lg bg-cream/15 text-cream transition-colors hover:bg-destructive"
                        >
                          <Trash2 className="size-4" />
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete this {item.kind}?</DialogTitle>
                            <DialogDescription>
                              It will be removed from the gallery for everyone. This can&rsquo;t be
                              undone.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose
                              className={cn(
                                "inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium hover:bg-muted",
                              )}
                            >
                              Keep it
                            </DialogClose>
                            <DialogClose
                              onClick={() => onDelete(item)}
                              disabled={savingKey === item.id}
                              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-sm font-medium text-white hover:opacity-90"
                            >
                              <Trash2 className="size-4" /> Delete
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                    {item.kind === "video" && (
                      <span className="absolute left-2 top-2 rounded-md bg-maroon/80 px-1.5 py-0.5 text-[10px] font-medium text-cream">
                        Video
                      </span>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "searches" && (
          <SearchesTable
            searches={searches}
            hasMore={searchesHasMore}
            loading={searchesLoading}
            onLoadMore={loadMoreSearches}
          />
        )}

        {tab === "settings" && settings && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="size-4 text-marigold-deep" /> Match sensitivity
                </CardTitle>
                <CardDescription>
                  How close a face must be to count as a match. Higher is stricter (fewer, surer
                  results).
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-6">
                <div className="flex items-center gap-4">
                  <Slider
                    min={0.1}
                    max={0.9}
                    step={0.01}
                    value={settings.match_threshold}
                    aria-label="Match threshold"
                    onValueChange={(v) =>
                      setSettings((s) => (s ? { ...s, match_threshold: v as number } : s))
                    }
                    onValueCommitted={(v) =>
                      saveSetting({ match_threshold: v as number }, "Match sensitivity saved")
                    }
                  />
                  <span className="tabular w-12 shrink-0 text-right text-sm font-semibold text-maroon">
                    {settings.match_threshold.toFixed(2)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center justify-between gap-4 py-5">
                <div>
                  <p className="font-medium text-foreground">Require guest passcode</p>
                  <p className="text-sm text-muted-foreground">
                    Ask guests for a shared passcode before they can search.
                  </p>
                </div>
                <Switch
                  checked={settings.passcode_enabled}
                  aria-label="Require guest passcode"
                  onCheckedChange={(checked) =>
                    saveSetting(
                      { passcode_enabled: checked },
                      checked ? "Passcode required" : "Passcode turned off",
                    )
                  }
                />
              </CardContent>
            </Card>

            <Card className="border-destructive/30">
              <CardContent className="flex items-center justify-between gap-4 py-5">
                <div>
                  <p className="flex items-center gap-1.5 font-medium text-destructive">
                    <Power className="size-4" /> Pause everything (kill switch)
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Instantly stop all guest searches and downloads.
                  </p>
                </div>
                <Switch
                  checked={settings.kill_switch}
                  aria-label="Kill switch"
                  data-testid="kill-switch"
                  onCheckedChange={(checked) =>
                    saveSetting(
                      { kill_switch: checked },
                      checked ? "Everything paused" : "Guest access resumed",
                    )
                  }
                />
              </CardContent>
            </Card>
          </div>
        )}
      </section>
    </main>
  );
}
