"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/Brand";
import { Garland } from "@/components/Garland";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuotaBar } from "@/components/QuotaBar";
import { UploadDropzone } from "@/components/UploadDropzone";

const MAX = { photos: 20, videos: 5 };

export default function UploadPage() {
  const [remaining, setRemaining] = useState({ photos: MAX.photos, videos: MAX.videos });
  const [guestName, setGuestName] = useState("");

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-16 pt-6">
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
          Add your photos to the story
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Share the shots you caught from the day — every photo helps another guest find
          themselves in the celebration.
        </p>
      </header>

      <section className="mt-7 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="upload-guest-name">
            Your name
            <span className="text-marigold-deep" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="upload-guest-name"
            name="guestName"
            autoComplete="name"
            placeholder="e.g. Priya Sharma"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            required
            minLength={2}
          />
        </div>

        <QuotaBar
          photos={{ used: MAX.photos - remaining.photos, max: MAX.photos }}
          videos={{ used: MAX.videos - remaining.videos, max: MAX.videos }}
        />
        <UploadDropzone
          remaining={remaining}
          onRemainingChange={setRemaining}
          guestName={guestName}
        />
      </section>
    </main>
  );
}
