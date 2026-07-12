"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { Garland } from "@/components/Garland";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One-time editorial "cover" shown over the Home search form on a guest's first
 * visit. Three full-screen, swipeable panels styled like a keepsake wedding
 * magazine — a gold hairline frame, a genda-phool garland, and the couple's
 * name set large in the brand's Fraunces display face.
 *
 * Dismissal is remembered in localStorage so returning guests land straight on
 * the search form. Skip is always available; advance via swipe, tap, dot-nav,
 * or the Next / CTA button. Motion is disabled under prefers-reduced-motion.
 */

export const INTRO_SEEN_KEY = "shaadi_intro_seen_v1";

type Panel = {
  eyebrow: string;
  title: React.ReactNode;
  body: React.ReactNode;
  kicker?: string;
};

const PANELS: Panel[] = [
  {
    eyebrow: "The Wedding Issue · 2026",
    title: (
      <>
        Nameeta <span className="italic text-marigold-deep">ki</span> Shaadi
      </>
    ),
    kicker: "Nameeta weds Jeenendra",
    body: "We've kept your moments safe — let me share them with you.",
  },
  {
    eyebrow: "#SaatPhere",
    title: (
      <>
        Seven vows,
        <br />a thousand frames.
      </>
    ),
    body: "Every glance, every laugh, every stolen candid — gathered in one warm album.",
  },
  {
    eyebrow: "Your gallery is ready",
    title: (
      <>
        Find <span className="italic">yourself</span> in the celebration.
      </>
    ),
    body: "One quick selfie is all it takes to unwrap your photos.",
  },
];

export function MagazineIntro({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const last = PANELS.length - 1;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(INTRO_SEEN_KEY, "1");
    } catch {
      // Private-mode / storage-disabled: still dismiss for this session.
    }
    onDone();
  }, [onDone]);

  const go = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next > last) {
        finish();
        return;
      }
      setDir(next > index ? 1 : -1);
      setIndex(next);
    },
    [finish, index, last],
  );

  // Keyboard: arrows advance, Escape skips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, go, index]);

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    const swipe = info.offset.x;
    if (swipe < -60) go(index + 1);
    else if (swipe > 60) go(index - 1);
  };

  const panel = PANELS[index];
  const distance = reduce ? 0 : 48;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome"
      className="fixed inset-0 z-50 overflow-hidden bg-cream bg-invitation"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? undefined : { opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Ambient marigold wash sits under a gold invitation frame */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,color-mix(in_oklch,var(--marigold),transparent_78%),transparent_60%)]" />

      <div
        className="relative mx-auto flex h-[100dvh] w-full max-w-md flex-col px-6"
        style={{
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* Top bar: masthead + Skip */}
        <div className="flex items-center justify-between">
          <span className="font-heading text-lg font-semibold italic text-maroon">
            Shaadi<span className="text-marigold-deep not-italic">.</span>
          </span>
          <button
            type="button"
            onClick={finish}
            data-testid="intro-skip"
            className="inline-flex h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-maroon focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            Skip <X className="size-4" />
          </button>
        </div>

        {/* Gold hairline invitation frame around the editorial content */}
        <div className="relative mt-3 flex flex-1 flex-col rounded-[1.75rem] border border-gold/60 p-1">
          <div className="flex flex-1 flex-col overflow-hidden rounded-[1.5rem] ring-1 ring-inset ring-gold/25">
            <motion.div
              key="stage"
              className="flex flex-1 touch-pan-y flex-col items-center justify-center px-6 text-center"
              drag={reduce ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={onDragEnd}
              onClick={() => go(index + 1)}
            >
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={index}
                  custom={dir}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * distance }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -distance }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="flex w-full flex-col items-center"
                >
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.24em] text-marigold-deep">
                    {panel.eyebrow}
                  </p>

                  <Garland count={9} className="mt-4 max-w-[16rem]" />

                  <h1 className="mt-5 text-balance font-heading text-[2.4rem] font-semibold leading-[1.05] text-maroon sm:text-[2.75rem]">
                    {panel.title}
                  </h1>

                  {panel.kicker && (
                    <p className="mt-3 font-[family-name:var(--font-devanagari)] text-base text-marigold-deep/90">
                      {panel.kicker}
                    </p>
                  )}

                  <p className="mx-auto mt-4 max-w-xs text-pretty text-[15px] leading-relaxed text-muted-foreground">
                    {panel.body}
                  </p>
                </motion.div>
              </AnimatePresence>
            </motion.div>

            {/* A quiet cue so the tap/swipe affordance is discoverable */}
            {index < last && (
              <p className="pb-4 text-center text-xs text-muted-foreground/70">
                Tap or swipe to turn the page
              </p>
            )}
          </div>
        </div>

        {/* Dot-nav + primary action */}
        <div className="mt-5 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2" role="tablist" aria-label="Intro pages">
            {PANELS.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Go to page ${i + 1}`}
                onClick={() => go(i)}
                className={cn(
                  "h-2.5 rounded-full transition-all duration-200",
                  i === index
                    ? "w-6 bg-marigold-deep"
                    : "w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50",
                )}
              />
            ))}
          </div>

          {index === last ? (
            <Button
              type="button"
              variant="marigold"
              size="xl"
              className="w-full"
              data-testid="intro-cta"
              onClick={finish}
            >
              See your photos <ArrowRight />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xl"
              className="w-full"
              data-testid="intro-next"
              onClick={() => go(index + 1)}
            >
              Next <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
