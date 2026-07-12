"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { ArrowRight, ImagePlus, Images, Loader2, LogOut, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "@/components/Brand";
import { Garland } from "@/components/Garland";
import { MagazineIntro, INTRO_SEEN_KEY } from "@/components/MagazineIntro";
import { SelfieCapture, type SelfieValue } from "@/components/SelfieCapture";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, fetchConfig, isEmbedUnavailable, search, sessionKey } from "@/lib/api";
import {
  getActiveGuest,
  getRecentGuests,
  logout as logoutGuest,
  remember,
  type RememberedGuest,
} from "@/lib/guest-store";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selfie, setSelfie] = useState<SelfieValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passcodeRequired, setPasscodeRequired] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  // Device memory: who last searched on this browser. When present (and the
  // guest hasn't chosen "find someone else"), we greet them and skip the selfie
  // form so they don't have to "log in" again on every visit.
  const [returning, setReturning] = useState<RememberedGuest | null>(null);
  const [recents, setRecents] = useState<RememberedGuest[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setReturning(getActiveGuest());
    setRecents(getRecentGuests());
  }, []);
  // `null` until we've read localStorage on the client, so we don't flash the
  // intro for returning guests who've already seen it.
  const [showIntro, setShowIntro] = useState<boolean | null>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(INTRO_SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    setShowIntro(!seen);
  }, []);

  // Fetch once on mount: whether the hosts require a shared passcode before
  // search. If /api/config is unreachable, fail open on the UI (no field
  // shown) — /api/search still enforces the passcode server-side either way.
  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((config) => {
        if (!cancelled) setPasscodeRequired(config.passcodeRequired);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit =
    name.trim().length >= 2 &&
    !!selfie &&
    !submitting &&
    (!passcodeRequired || passcode.trim().length > 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selfie) {
      toast.error("Add a selfie first", {
        description: "We match your face to the wedding photos.",
      });
      return;
    }
    setPasscodeError(null);
    setSubmitting(true);
    try {
      const res = await search(
        name.trim(),
        selfie.blob,
        passcodeRequired ? passcode.trim() : undefined,
      );
      sessionStorage.setItem(
        sessionKey(res.sessionId),
        JSON.stringify({ ...res, guestName: name.trim() }),
      );
      // Remember this guest on the device so a reload/return skips the selfie.
      remember({
        name: name.trim(),
        sessionId: res.sessionId,
        matchCount: res.matches.length,
      });
      router.push(`/results?sid=${encodeURIComponent(res.sessionId)}`);
      return; // keep the button in its loading state through the transition
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast("Photo finding is paused", {
          description: "The hosts have turned off search for now. Try again later.",
        });
      } else if (isEmbedUnavailable(err)) {
        // Calm info state, not an error: the face-matching compute (hosted
        // separately, see embed-service/) isn't reachable yet — expected while
        // it's being deployed, not a bug the guest needs to worry about.
        toast("✨ Photo finding is being set up", {
          description: "Please check back soon — we're just getting things ready!",
        });
      } else if (err instanceof ApiError && err.status === 403) {
        setPasscodeError("Incorrect passcode.");
      } else {
        toast.error("Something went wrong", {
          description: "We couldn't search just now. Please try again.",
        });
      }
    }
    setSubmitting(false);
  }

  function handleLogout() {
    logoutGuest();
    setReturning(null);
    setRecents(getRecentGuests());
    setShowForm(true);
  }

  // Show the greeting instead of the form when we remember this guest and they
  // haven't asked to look up someone else.
  const greeting = returning && !showForm ? returning : null;
  const otherGuests = recents.filter((g) => g.sessionId !== returning?.sessionId);

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-12 pt-8 sm:max-w-lg">
      <AnimatePresence>
        {showIntro && <MagazineIntro key="intro" onDone={() => setShowIntro(false)} />}
      </AnimatePresence>

      <header className="flex flex-col items-center gap-4 text-center">
        <Brand size="lg" href={null} />
        <Garland />
      </header>

      <section className="mt-8 text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-marigold-deep">
          <Sparkles className="size-3.5" /> Nameeta weds Jeenendra
        </p>
        <h1 className="mt-4 text-balance font-heading text-[2rem] leading-[1.1] font-semibold text-maroon sm:text-4xl">
          Every photo you&rsquo;re in, gathered in one place.
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-[15px] leading-relaxed text-muted-foreground">
          {greeting
            ? "Welcome back — your photos are right where you left them."
            : "Take a quick selfie and we’ll find your moments from the celebration — ready to relive and keep."}
        </p>
      </section>

      {greeting ? (
        <Card className="mt-7 bg-invitation">
          <CardContent className="flex flex-col gap-4 py-6">
            <div className="flex flex-col gap-1 text-center">
              <p className="text-sm text-muted-foreground">Welcome back,</p>
              <p className="font-heading text-2xl font-semibold text-maroon">
                {greeting.name}
              </p>
              {greeting.matchCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  {greeting.matchCount} {greeting.matchCount === 1 ? "photo" : "photos"} of you
                </p>
              )}
            </div>

            <Button
              type="button"
              variant="marigold"
              size="xl"
              className="w-full"
              data-testid="view-my-photos"
              onClick={() =>
                router.push(`/results?sid=${encodeURIComponent(greeting.sessionId)}`)
              }
            >
              <Images /> View my photos <ArrowRight />
            </Button>

            {otherGuests.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Switch person
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {otherGuests.map((g) => (
                    <button
                      key={g.sessionId}
                      type="button"
                      onClick={() =>
                        router.push(`/results?sid=${encodeURIComponent(g.sessionId)}`)
                      }
                      className="inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="flex-1"
                onClick={() => setShowForm(true)}
              >
                <Search /> Find someone else
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="touch"
                className="flex-1 text-maroon"
                data-testid="home-logout"
                onClick={handleLogout}
              >
                <LogOut /> Log out
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
      <Card className="mt-7 bg-invitation">
        <CardContent className="flex flex-col gap-5 py-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="guest-name">
                Your name
                <span className="text-marigold-deep" aria-hidden>
                  *
                </span>
              </Label>
              <Input
                id="guest-name"
                name="guestName"
                autoComplete="name"
                placeholder="e.g. Priya Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Your selfie <span className="text-marigold-deep">*</span>
              </span>
              <SelfieCapture onChange={setSelfie} />
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                Face the camera, remove sunglasses, and use good light — it helps us
                find more of your photos.
              </p>
            </div>

            {passcodeRequired && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="guest-passcode">
                  Event passcode
                  <span className="text-marigold-deep" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="guest-passcode"
                  name="passcode"
                  type="password"
                  autoComplete="off"
                  placeholder="Ask the hosts for today's passcode"
                  value={passcode}
                  onChange={(e) => {
                    setPasscode(e.target.value);
                    setPasscodeError(null);
                  }}
                  aria-invalid={!!passcodeError}
                  required
                />
                {passcodeError && (
                  <p role="alert" className="text-sm text-destructive">
                    {passcodeError}
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              variant="marigold"
              size="xl"
              className="w-full"
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" /> Finding your photos&hellip;
                </>
              ) : (
                <>
                  <Search /> Find my photos
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      )}

      <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-5 py-4 text-center">
        <p className="text-sm text-muted-foreground">
          Have photos on your phone from the day?
        </p>
        <Link
          href="/upload"
          className="inline-flex min-h-11 items-center gap-1.5 font-medium text-maroon underline-offset-4 hover:underline"
        >
          <ImagePlus className="size-4 text-marigold-deep" /> Add them to the shared album
        </Link>
      </div>

      <footer className="mt-auto pt-10 text-center text-xs text-muted-foreground">
        Made with love for Nameeta &amp; Jeenendra&rsquo;s big day.
      </footer>
    </main>
  );
}
