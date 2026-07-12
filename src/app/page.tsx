"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Heart, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "@/components/Brand";
import { Garland } from "@/components/Garland";
import { SelfieCapture, type SelfieValue } from "@/components/SelfieCapture";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, fetchConfig, isEmbedUnavailable, search, sessionKey } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selfie, setSelfie] = useState<SelfieValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passcodeRequired, setPasscodeRequired] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

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

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-12 pt-8 sm:max-w-lg">
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
          Take a quick selfie and we&rsquo;ll find your moments from the celebration &mdash;
          ready to relive and keep.
        </p>
      </section>

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
            <p className="text-center text-xs text-muted-foreground">
              Your selfie is used only to match faces, then discarded.
            </p>
          </form>
        </CardContent>
      </Card>

      <footer className="mt-auto flex flex-col items-center gap-3 pt-10 text-center text-sm text-muted-foreground">
        <Link
          href="/upload"
          className="inline-flex items-center gap-1.5 font-medium text-maroon underline-offset-4 hover:underline"
        >
          <Heart className="size-4 text-marigold-deep" /> Share your photos with the couple
        </Link>
        <p className="text-xs">Made with love for Nameeta &amp; Jeenendra&rsquo;s big day.</p>
      </footer>
    </main>
  );
}
