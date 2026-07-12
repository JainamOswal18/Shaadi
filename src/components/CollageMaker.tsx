"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { Check, Download, ImagePlus, Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import type { SearchResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { requestUploadUrls, putToR2, uploadComplete } from "@/lib/api";
import {
  CANVAS_SIZE,
  DEFAULT_STYLE,
  LAYOUTS,
  MOTIFS,
  PRESETS,
  THEMES,
  layoutById,
  themeById,
  type CollageStyle,
} from "@/lib/collage";
import { cn } from "@/lib/utils";

type Photo = SearchResponse["matches"][number];

type ResolvedTheme = { bg: string; frame: string; ink: string; accent: string };

/** Resolve `var(--x)` theme tokens to concrete colours so the exported PNG
 * doesn't depend on :root custom properties surviving html-to-image's clone. */
function resolveVar(ref: string): string {
  const m = ref.match(/^var\((--[\w-]+)\)$/);
  if (!m || typeof window === "undefined") return ref;
  const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return v || ref;
}

/** A crisp little genda-phool garland drawn with concrete colours. */
function CanvasGarland({ thread, petal, core }: { thread: string; petal: string; core: string }) {
  const count = 11;
  const width = 1000;
  const gap = width / (count - 1);
  return (
    <svg viewBox={`0 0 ${width} 40`} width="100%" height="40" aria-hidden>
      <path d={`M0 10 Q ${width / 2} 30 ${width} 10`} fill="none" stroke={thread} strokeWidth="3" />
      {Array.from({ length: count }, (_, i) => {
        const x = i * gap;
        const y = i % 2 === 0 ? 24 : 20;
        const r = i % 2 === 0 ? 12 : 10;
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <circle r={r} fill={petal} />
            <circle r={r * 0.4} fill={core} />
          </g>
        );
      })}
    </svg>
  );
}

/** The 1080×1080 export node. Rendered at full size; the editor scales a
 * wrapper down for on-screen preview while html-to-image captures this node. */
function CollageCanvas({
  nodeRef,
  photos,
  style,
}: {
  nodeRef: React.Ref<HTMLDivElement>;
  photos: Photo[];
  style: CollageStyle;
}) {
  const layout = layoutById(style.layoutId);
  const t = themeById(style.themeId);
  const theme: ResolvedTheme = {
    bg: resolveVar(t.bg),
    frame: resolveVar(t.frame),
    ink: resolveVar(t.ink),
    accent: resolveVar(t.accent),
  };
  const cap = layout.capacity;
  const slots: Photo[] = photos.length
    ? Array.from({ length: cap }, (_, i) => photos[i % photos.length])
    : [];

  const img = (p: Photo, key: number) => (
    <div
      key={key}
      style={{ overflow: "hidden", borderRadius: style.radius, background: theme.frame }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={p.previewUrl}
        alt=""
        crossOrigin="anonymous"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );

  let photoArea: React.ReactNode;
  if (layout.kind === "grid") {
    photoArea = (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
          gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
          gap: style.border,
          width: "100%",
          height: "100%",
        }}
      >
        {layout.cells!.map((c, i) => (
          <div
            key={i}
            style={{
              gridColumn: `${c.col} / span ${c.colSpan}`,
              gridRow: `${c.row} / span ${c.rowSpan}`,
              overflow: "hidden",
              borderRadius: style.radius,
              background: theme.frame,
            }}
          >
            {slots[i] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slots[i].previewUrl}
                alt=""
                crossOrigin="anonymous"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            )}
          </div>
        ))}
      </div>
    );
  } else if (layout.kind === "polaroid") {
    const rot = [-6, 3, -2];
    photoArea = (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {slots.map((p, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${8 + i * 20}%`,
              top: `${10 + i * 12}%`,
              width: "46%",
              transform: `rotate(${rot[i % rot.length]}deg)`,
              background: "#fffdf8",
              padding: 18,
              paddingBottom: 46,
              borderRadius: 6,
              boxShadow: "0 18px 40px -12px rgba(60,20,20,0.45)",
            }}
          >
            <div style={{ overflow: "hidden", borderRadius: 2, aspectRatio: "1 / 1", background: theme.frame }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt=""
                crossOrigin="anonymous"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    // filmstrip
    photoArea = (
      <div
        style={{
          display: "flex",
          gap: style.border,
          padding: "22px 14px",
          background: "#1a0f10",
          borderRadius: style.radius,
          width: "100%",
          height: "100%",
          alignItems: "stretch",
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 34px, rgba(0,0,0,0) 34px 40px)",
        }}
      >
        {slots.map((p, i) => img(p, i))}
      </div>
    );
  }

  const showGarland = style.motif === "garland";

  return (
    <div
      ref={nodeRef}
      style={{
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        background: theme.bg,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        padding: 44,
        boxSizing: "border-box",
        overflow: "hidden",
        fontFamily: "var(--font-hanken), system-ui, sans-serif",
      }}
    >
      {style.motif === "wash" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(120% 85% at 50% -8%, ${theme.accent}, transparent 60%)`,
            opacity: 0.22,
          }}
        />
      )}

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", gap: 22, minHeight: 0 }}>
        {showGarland && (
          <CanvasGarland thread={theme.frame} petal={theme.accent} core={theme.ink} />
        )}
        <div style={{ flex: 1, minHeight: 0 }}>{photoArea}</div>

        <div style={{ textAlign: "center", color: theme.ink }}>
          {style.caption.trim() && (
            <div
              style={{
                fontFamily: "var(--font-fraunces), Georgia, serif",
                fontWeight: 600,
                fontSize: 52,
                lineHeight: 1.05,
                letterSpacing: "-0.01em",
              }}
            >
              {style.caption}
            </div>
          )}
          {style.hashtag.trim() && (
            <div style={{ marginTop: 10, fontSize: 34, fontWeight: 600, color: theme.accent }}>
              {style.hashtag}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CollageMaker({
  photos,
  guestName,
  onClose,
}: {
  photos: Photo[];
  guestName?: string;
  onClose: () => void;
}) {
  const [style, setStyle] = useState<CollageStyle>(DEFAULT_STYLE);
  const [previewW, setPreviewW] = useState(320);
  const [busy, setBusy] = useState<null | "download" | "share" | "gallery">(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof CollageStyle>(key: K, value: CollageStyle[K]) =>
    setStyle((s) => ({ ...s, [key]: value }));

  // Measure the preview column so the 1080px canvas scales to fit any width.
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const measure = () => setPreviewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const scale = previewW / CANVAS_SIZE;

  const render = useCallback(async (): Promise<Blob> => {
    const node = nodeRef.current;
    if (!node) throw new Error("Collage not ready");
    const blob = await toBlob(node, {
      pixelRatio: 2,
      cacheBust: true,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
    });
    if (!blob) throw new Error("Export failed");
    return blob;
  }, []);

  const filename = useMemo(
    () => `shaadi-collage-${style.hashtag.replace(/[^a-z0-9]/gi, "") || "memory"}.png`,
    [style.hashtag],
  );

  async function onDownload() {
    if (busy) return;
    setBusy("download");
    try {
      const blob = await render();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.setAttribute("data-testid", "collage-download-anchor");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Collage saved to your device");
    } catch {
      toast.error("Couldn't create the collage", { description: "Please try again." });
    } finally {
      setBusy(null);
    }
  }

  async function onShare() {
    if (busy) return;
    setBusy("share");
    try {
      const blob = await render();
      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "Nameeta ki Shaadi", text: style.hashtag });
      } else {
        // No native share (most desktops): fall back to a download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("Sharing isn't supported here — saved instead");
      }
    } catch (err) {
      // A user cancelling the share sheet throws AbortError — stay silent.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast.error("Couldn't share the collage");
      }
    } finally {
      setBusy(null);
    }
  }

  async function onAddToGallery() {
    if (busy) return;
    setBusy("gallery");
    try {
      const blob = await render();
      const file = new File([blob], filename, { type: "image/png" });
      const sessionId = crypto.randomUUID();
      const name = guestName?.trim() || "A guest";
      const { grants } = await requestUploadUrls({
        sessionId,
        guestName: name,
        files: [{ name: file.name, type: file.type, size: file.size, kind: "photo" }],
      });
      const grant = grants[0];
      if (!grant) throw new Error("No upload slot");
      await putToR2(grant.putUrl, file, () => undefined);
      await uploadComplete(sessionId, [grant.key], name);
      toast.success("Added to the shared album", {
        description: "Everyone can find your collage in the gallery now.",
      });
    } catch {
      toast.error("Couldn't add to the album", { description: "Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Make a collage"
      data-testid="collage-maker"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-border px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <h2 className="font-heading text-lg font-semibold text-maroon">Make a collage</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close collage maker"
          className="grid size-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 pb-40 pt-4 lg:max-w-lg">
          {/* Preview */}
          <div className="rounded-2xl border border-border bg-invitation p-3 shadow-[var(--shadow-card)]">
            <div ref={previewWrapRef} className="mx-auto w-full" style={{ maxWidth: 420 }}>
              <div
                className="relative overflow-hidden rounded-xl"
                style={{ width: previewW, height: previewW }}
              >
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    width: CANVAS_SIZE,
                    height: CANVAS_SIZE,
                  }}
                >
                  <CollageCanvas nodeRef={nodeRef} photos={photos} style={style} />
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {photos.length} photo{photos.length === 1 ? "" : "s"} selected · exports at 1080×1080
            </p>
          </div>

          {/* Presets */}
          <section className="mt-6">
            <p className="mb-2 text-sm font-medium text-foreground">Quick themes</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {PRESETS.map((p) => {
                const active = style.hashtag === p.hashtag && style.layoutId === p.layoutId;
                return (
                  <button
                    key={p.hashtag}
                    type="button"
                    onClick={() =>
                      setStyle((s) => ({
                        ...s,
                        hashtag: p.hashtag,
                        caption: p.caption,
                        layoutId: p.layoutId,
                        themeId: p.themeId,
                        motif: p.motif,
                      }))
                    }
                    className={cn(
                      "shrink-0 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-marigold-deep bg-marigold-deep text-white"
                        : "border-border bg-card text-maroon hover:border-marigold/60",
                    )}
                  >
                    {p.hashtag}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Layout */}
          <section className="mt-6">
            <p className="mb-2 text-sm font-medium text-foreground">Layout</p>
            <div className="grid grid-cols-4 gap-2">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => set("layoutId", l.id)}
                  aria-pressed={style.layoutId === l.id}
                  className={cn(
                    "flex min-h-11 items-center justify-center rounded-xl border px-1 py-2 text-center text-xs font-medium transition-colors",
                    style.layoutId === l.id
                      ? "border-marigold-deep bg-accent text-maroon"
                      : "border-border bg-card text-muted-foreground hover:border-marigold/60",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          {/* Theme colour */}
          <section className="mt-6">
            <p className="mb-2 text-sm font-medium text-foreground">Colour</p>
            <div className="flex flex-wrap gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set("themeId", t.id)}
                  aria-label={t.label}
                  aria-pressed={style.themeId === t.id}
                  className={cn(
                    "grid size-11 place-items-center rounded-full border-2 transition-transform",
                    style.themeId === t.id
                      ? "border-maroon scale-105"
                      : "border-border hover:scale-105",
                  )}
                  style={{ background: t.bg }}
                >
                  {style.themeId === t.id && <Check className="size-4" style={{ color: t.ink }} />}
                </button>
              ))}
            </div>
          </section>

          {/* Motif */}
          <section className="mt-6">
            <p className="mb-2 text-sm font-medium text-foreground">Background</p>
            <div className="flex gap-2">
              {MOTIFS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => set("motif", m.id)}
                  aria-pressed={style.motif === m.id}
                  className={cn(
                    "min-h-11 flex-1 rounded-xl border px-2 py-2 text-sm font-medium transition-colors",
                    style.motif === m.id
                      ? "border-marigold-deep bg-accent text-maroon"
                      : "border-border bg-card text-muted-foreground hover:border-marigold/60",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </section>

          {/* Sliders */}
          <section className="mt-6 grid gap-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Border</Label>
                <span className="tabular text-xs text-muted-foreground">{style.border}px</span>
              </div>
              <Slider
                value={[style.border]}
                min={0}
                max={28}
                step={2}
                onValueChange={(v) => set("border", Array.isArray(v) ? v[0] : v)}
                aria-label="Border width"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Corner radius</Label>
                <span className="tabular text-xs text-muted-foreground">{style.radius}px</span>
              </div>
              <Slider
                value={[style.radius]}
                min={0}
                max={40}
                step={2}
                onValueChange={(v) => set("radius", Array.isArray(v) ? v[0] : v)}
                aria-label="Corner radius"
              />
            </div>
          </section>

          {/* Text */}
          <section className="mt-6 grid gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="collage-caption">Caption</Label>
              <Input
                id="collage-caption"
                value={style.caption}
                maxLength={40}
                onChange={(e) => set("caption", e.target.value)}
                placeholder="Add a caption"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="collage-hashtag">Hashtag</Label>
              <Input
                id="collage-hashtag"
                value={style.hashtag}
                maxLength={30}
                onChange={(e) => set("hashtag", e.target.value)}
                placeholder="#SaatPhere"
              />
            </div>
          </section>
        </div>
      </div>

      {/* Sticky actions */}
      <div
        className="border-t border-border bg-background/90 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-2 lg:max-w-lg">
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={onShare}
            disabled={!!busy}
          >
            {busy === "share" ? <Loader2 className="animate-spin" /> : <Share2 />}
            Share
          </Button>
          <Button
            type="button"
            variant="outline"
            size="touch"
            data-testid="collage-add-gallery"
            onClick={onAddToGallery}
            disabled={!!busy}
          >
            {busy === "gallery" ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            Gallery
          </Button>
          <Button
            type="button"
            variant="marigold"
            size="touch"
            data-testid="collage-download"
            onClick={onDownload}
            disabled={!!busy}
          >
            {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
