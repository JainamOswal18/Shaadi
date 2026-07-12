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
import { StickerMotif } from "@/components/collage/StickerMotif";
import {
  RATIOS,
  DEFAULT_STYLE,
  DEFAULT_SLOT_TRANSFORM,
  FONT_STYLES,
  HEART_CLIP_PATH,
  MOTIFS,
  PRESETS,
  THEMES,
  canvasSizeFor,
  clampSlotTransform,
  layoutsForRatio,
  layoutById,
  pinchScale,
  pointerDistance,
  slotTransformToCss,
  themeById,
  type CollageStyle,
  type SlotTransform,
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

/** The 1080×1080 export node. Rendered at full size; the editor scales a
 * wrapper down for on-screen preview while html-to-image captures this node. */
function CollageCanvas({
  nodeRef,
  photos,
  style,
  transforms,
  onSlotWheel,
  onSlotPointerDown,
  onSlotPointerMove,
  onSlotPointerUp,
}: {
  nodeRef: React.Ref<HTMLDivElement>;
  photos: Photo[];
  style: CollageStyle;
  transforms: Record<number, SlotTransform>;
  onSlotWheel: (i: number, e: React.WheelEvent) => void;
  onSlotPointerDown: (i: number, e: React.PointerEvent) => void;
  onSlotPointerMove: (e: React.PointerEvent) => void;
  onSlotPointerUp: (e: React.PointerEvent) => void;
}) {
  const size = canvasSizeFor(style.ratioId);
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

  const slotProps = (i: number) => ({
    "data-testid": `collage-slot-${i}`,
    onWheel: (e: React.WheelEvent) => onSlotWheel(i, e),
    onPointerDown: (e: React.PointerEvent) => onSlotPointerDown(i, e),
    onPointerMove: onSlotPointerMove,
    onPointerUp: onSlotPointerUp,
    onPointerCancel: onSlotPointerUp,
  });

  const slotTransform = (i: number) => transforms[i] ?? DEFAULT_SLOT_TRANSFORM;

  const img = (p: Photo, i: number) => (
    <div
      key={i}
      {...slotProps(i)}
      style={{
        overflow: "hidden",
        borderRadius: style.radius,
        background: theme.frame,
        touchAction: "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={p.previewUrl}
        alt=""
        role="img"
        crossOrigin="anonymous"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          transform: slotTransformToCss(slotTransform(i)),
          transformOrigin: "center",
        }}
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
            {...slotProps(i)}
            style={{
              gridColumn: `${c.col} / span ${c.colSpan}`,
              gridRow: `${c.row} / span ${c.rowSpan}`,
              overflow: "hidden",
              borderRadius: style.radius,
              background: theme.frame,
              touchAction: "none",
            }}
          >
            {slots[i] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slots[i].previewUrl}
                alt=""
                role="img"
                crossOrigin="anonymous"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  transform: slotTransformToCss(slotTransform(i)),
                  transformOrigin: "center",
                }}
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
            <div
              {...slotProps(i)}
              style={{
                overflow: "hidden",
                borderRadius: 2,
                aspectRatio: "1 / 1",
                background: theme.frame,
                touchAction: "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt=""
                role="img"
                crossOrigin="anonymous"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  transform: slotTransformToCss(slotTransform(i)),
                  transformOrigin: "center",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (layout.kind === "heart") {
    // Heart-mosaic: a fixed 2-col/3-row grid of 5 photos, clipped to a heart
    // outline so the *collage* reads as heart-shaped (not a per-photo mask).
    const heartCells = [0, 1, 2, 3, 4];
    photoArea = (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          clipPath: HEART_CLIP_PATH,
          WebkitClipPath: HEART_CLIP_PATH,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gridTemplateRows: "repeat(3, 1fr)",
            gap: style.border,
            width: "100%",
            height: "100%",
            background: theme.frame,
          }}
        >
          {heartCells.map((i) => (
            <div
              key={i}
              {...slotProps(i)}
              style={{
                gridColumn: i === 4 ? "1 / span 2" : undefined,
                overflow: "hidden",
                background: theme.frame,
                touchAction: "none",
              }}
            >
              {slots[i] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slots[i].previewUrl}
                  alt=""
                  role="img"
                  crossOrigin="anonymous"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    transform: slotTransformToCss(slotTransform(i)),
                    transformOrigin: "center",
                  }}
                />
              )}
            </div>
          ))}
        </div>
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

  const stickerId =
    style.motif === "garland" || style.motif === "phera" || style.motif === "doli"
      ? style.motif
      : null;
  const font = FONT_STYLES.find((f) => f.id === style.fontStyle) ?? FONT_STYLES[0];

  return (
    <div
      ref={nodeRef}
      style={{
        width: size.width,
        height: size.height,
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
        {stickerId && (
          <div style={{ position: "absolute", top: 16, right: 16 }}>
            <StickerMotif id={stickerId} color={theme.accent} />
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>{photoArea}</div>

        <div style={{ textAlign: "center", color: theme.ink }}>
          {style.caption.trim() && (
            <div
              style={{
                fontFamily: font.family,
                fontWeight: font.weight,
                fontStyle: font.italic ? "italic" : "normal",
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
  const [transforms, setTransforms] = useState<Record<number, SlotTransform>>({});
  const [activeSlot, setActiveSlot] = useState(0);
  const nodeRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    slot: number;
    startX: number;
    startY: number;
    base: SlotTransform;
  } | null>(null);
  // Every pointer currently down on any slot, keyed by pointerId — lets us
  // detect a same-slot 2-finger pinch without a separate touch-events path.
  const pointersRef = useRef<Map<number, { slot: number; x: number; y: number }>>(new Map());
  const pinchState = useRef<{ slot: number; startDist: number; baseScale: number } | null>(null);

  const set = <K extends keyof CollageStyle>(key: K, value: CollageStyle[K]) =>
    setStyle((s) => ({ ...s, [key]: value }));

  const setSlotTransform = (slot: number, next: SlotTransform) =>
    setTransforms((prev) => ({ ...prev, [slot]: clampSlotTransform(next) }));

  function onSlotWheel(slot: number, e: React.WheelEvent) {
    e.preventDefault();
    const cur = transforms[slot] ?? DEFAULT_SLOT_TRANSFORM;
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setSlotTransform(slot, { ...cur, scale: cur.scale + delta });
  }

  /** Accessible fallback for zoom (touch and keyboard both reach this): a
   * range input / stepper pair bound to whichever slot was last touched.
   * Clamped to the current layout's capacity in case the layout shrank. */
  function activeSlotIndex() {
    const capacity = layoutById(style.layoutId).capacity;
    return Math.min(activeSlot, capacity - 1);
  }
  function setActiveSlotScale(scale: number) {
    const slot = activeSlotIndex();
    const cur = transforms[slot] ?? DEFAULT_SLOT_TRANSFORM;
    setSlotTransform(slot, { ...cur, scale });
  }
  function stepActiveSlotZoom(delta: number) {
    const cur = transforms[activeSlotIndex()] ?? DEFAULT_SLOT_TRANSFORM;
    setActiveSlotScale(cur.scale + delta);
  }

  /** All pointers currently down on a given slot, as [pointerId, point] pairs. */
  function pointersForSlot(slot: number) {
    return [...pointersRef.current.entries()].filter(([, p]) => p.slot === slot);
  }

  function onSlotPointerDown(slot: number, e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { slot, x: e.clientX, y: e.clientY });
    setActiveSlot(slot);

    const onSlot = pointersForSlot(slot);
    if (onSlot.length >= 2) {
      // A second finger landed on this slot: suspend single-pointer pan and
      // start a pinch from the two most recent points.
      dragState.current = null;
      const [[, p1], [, p2]] = onSlot.slice(-2);
      pinchState.current = {
        slot,
        startDist: pointerDistance(p1, p2),
        baseScale: (transforms[slot] ?? DEFAULT_SLOT_TRANSFORM).scale,
      };
    } else {
      pinchState.current = null;
      dragState.current = {
        slot,
        startX: e.clientX,
        startY: e.clientY,
        base: transforms[slot] ?? DEFAULT_SLOT_TRANSFORM,
      };
    }
  }

  function onSlotPointerMove(e: React.PointerEvent) {
    const p = pointersRef.current.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }

    const pinch = pinchState.current;
    if (pinch && p && p.slot === pinch.slot) {
      const [[, p1], [, p2]] = pointersForSlot(pinch.slot).slice(-2);
      const dist = pointerDistance(p1, p2);
      const cur = transforms[pinch.slot] ?? DEFAULT_SLOT_TRANSFORM;
      setSlotTransform(pinch.slot, {
        ...cur,
        scale: pinchScale(pinch.startDist, dist, pinch.baseScale),
      });
      return;
    }

    const d = dragState.current;
    if (!d || (p && p.slot !== d.slot)) return;
    const dx = (e.clientX - d.startX) / previewW;
    const dy = (e.clientY - d.startY) / previewW;
    setSlotTransform(d.slot, {
      ...d.base,
      offsetX: d.base.offsetX + dx,
      offsetY: d.base.offsetY + dy,
    });
  }

  function onSlotPointerUp(e: React.PointerEvent) {
    const p = pointersRef.current.get(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    dragState.current = null;
    if (p && pinchState.current?.slot === p.slot && pointersForSlot(p.slot).length < 2) {
      pinchState.current = null;
    }
  }

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

  const size = canvasSizeFor(style.ratioId);
  const scale = previewW / size.width;
  const zoomSlot = activeSlotIndex();
  const zoomTransform = transforms[zoomSlot] ?? DEFAULT_SLOT_TRANSFORM;

  const render = useCallback(async (): Promise<Blob> => {
    const node = nodeRef.current;
    if (!node) throw new Error("Collage not ready");
    const dims = canvasSizeFor(style.ratioId);
    const blob = await toBlob(node, {
      pixelRatio: 2,
      cacheBust: true,
      width: dims.width,
      height: dims.height,
    });
    if (!blob) throw new Error("Export failed");
    return blob;
  }, [style.ratioId]);

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
                style={{ width: previewW, height: previewW * (size.height / size.width) }}
              >
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    width: size.width,
                    height: size.height,
                  }}
                >
                  <CollageCanvas
                    nodeRef={nodeRef}
                    photos={photos}
                    style={style}
                    transforms={transforms}
                    onSlotWheel={onSlotWheel}
                    onSlotPointerDown={onSlotPointerDown}
                    onSlotPointerMove={onSlotPointerMove}
                    onSlotPointerUp={onSlotPointerUp}
                  />
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {photos.length} photo{photos.length === 1 ? "" : "s"} selected · exports at{" "}
              {size.width}×{size.height}
            </p>

            {/* Per-slot zoom: pinch works on touch, but this range/stepper
                pair is the guaranteed-reachable control on every device
                (touch and keyboard), bound to whichever slot was last
                touched (defaults to the first slot). */}
            <div
              className="mt-3 flex items-center gap-2 border-t border-border pt-3"
              data-testid="collage-zoom-control"
            >
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                Zoom photo {zoomSlot + 1}
              </span>
              <button
                type="button"
                aria-label="Zoom out"
                data-testid="collage-zoom-out"
                onClick={() => stepActiveSlotZoom(-0.1)}
                disabled={zoomTransform.scale <= 1}
                className="grid size-11 shrink-0 place-items-center rounded-full border border-border text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                −
              </button>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoomTransform.scale}
                onChange={(e) => setActiveSlotScale(Number(e.target.value))}
                aria-label={`Zoom for photo ${zoomSlot + 1}`}
                data-testid="collage-zoom-range"
                className="h-11 flex-1"
              />
              <button
                type="button"
                aria-label="Zoom in"
                data-testid="collage-zoom-in"
                onClick={() => stepActiveSlotZoom(0.1)}
                disabled={zoomTransform.scale >= 3}
                className="grid size-11 shrink-0 place-items-center rounded-full border border-border text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                +
              </button>
            </div>
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

          {/* Aspect ratio */}
          <section className="mt-6">
            <p className="mb-2 text-sm font-medium text-foreground">Aspect ratio</p>
            <div className="flex gap-2">
              {RATIOS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={style.ratioId === r.id}
                  onClick={() => {
                    const available = layoutsForRatio(r.id);
                    setStyle((s) => ({
                      ...s,
                      ratioId: r.id,
                      layoutId: available.some((l) => l.id === s.layoutId)
                        ? s.layoutId
                        : available[0].id,
                    }));
                  }}
                  className={cn(
                    "min-h-11 flex-1 rounded-xl border px-2 py-2 text-sm font-medium transition-colors",
                    style.ratioId === r.id
                      ? "border-marigold-deep bg-accent text-maroon"
                      : "border-border bg-card text-muted-foreground hover:border-marigold/60",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>

          {/* Layout */}
          <section className="mt-6">
            <p className="mb-2 text-sm font-medium text-foreground">Layout</p>
            <div className="grid grid-cols-4 gap-2">
              {layoutsForRatio(style.ratioId).map((l) => (
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

          {/* Font */}
          <section className="mt-6">
            <p className="mb-2 text-sm font-medium text-foreground">Caption style</p>
            <div className="flex gap-2">
              {FONT_STYLES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={style.fontStyle === f.id}
                  onClick={() => set("fontStyle", f.id)}
                  style={{
                    fontFamily: f.family,
                    fontWeight: f.weight,
                    fontStyle: f.italic ? "italic" : "normal",
                  }}
                  className={cn(
                    "min-h-11 flex-1 rounded-xl border px-2 py-2 text-sm transition-colors",
                    style.fontStyle === f.id
                      ? "border-marigold-deep bg-accent text-maroon"
                      : "border-border bg-card text-muted-foreground hover:border-marigold/60",
                  )}
                >
                  {f.label}
                </button>
              ))}
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
