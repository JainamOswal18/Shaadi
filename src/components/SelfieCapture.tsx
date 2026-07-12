"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Upload, CircleAlert, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SelfieValue = { blob: Blob; url: string };

type Mode = "idle" | "requesting" | "live" | "captured" | "denied" | "error";

/**
 * Front-camera selfie capture with a graceful file-upload fallback.
 * Emits the chosen image as a Blob (+ object URL) to the parent.
 */
export function SelfieCapture({
  onChange,
}: {
  onChange: (value: SelfieValue | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const startCamera = useCallback(async () => {
    setMessage(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMode("error");
      setMessage("Camera isn't available on this device. Upload a photo instead.");
      return;
    }
    setMode("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setMode("live");
      // attach after render
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
    } catch (err) {
      stopStream();
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setMode(denied ? "denied" : "error");
      setMessage(
        denied
          ? "Camera access was blocked. Allow it in your browser, or upload a photo."
          : "Couldn't start the camera. Upload a photo instead.",
      );
    }
  }, [stopStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const size = Math.min(video.videoWidth, video.videoHeight) || 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // center-crop square, mirror to match the live preview
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setPreview(url);
        setMode("captured");
        stopStream();
        onChange({ blob, url });
      },
      "image/jpeg",
      0.9,
    );
  }, [onChange, stopStream]);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setMode("error");
        setMessage("That file isn't an image. Choose a photo of your face.");
        return;
      }
      const url = URL.createObjectURL(file);
      setPreview(url);
      setMode("captured");
      setMessage(null);
      stopStream();
      onChange({ blob: file, url });
    },
    [onChange, stopStream],
  );

  const retake = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setMode("idle");
    setMessage(null);
    onChange(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [onChange, preview]);

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-invitation",
          "grid place-items-center text-center",
        )}
        data-selfie-state={mode}
      >
        {mode === "live" && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full scale-x-[-1] object-cover"
          />
        )}

        {mode === "captured" && preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Your selfie preview" className="h-full w-full object-cover" />
        )}

        {(mode === "idle" || mode === "requesting" || mode === "denied" || mode === "error") && (
          <div className="flex flex-col items-center gap-3 px-6">
            <span className="grid size-16 place-items-center rounded-full bg-card/70 text-marigold-deep shadow-sm ring-1 ring-border">
              {mode === "denied" || mode === "error" ? (
                <CircleAlert className="size-7" />
              ) : (
                <Camera className="size-7" />
              )}
            </span>
            <p className="max-w-[15rem] text-sm text-muted-foreground">
              {mode === "requesting"
                ? "Waiting for camera…"
                : message ?? "Take a quick selfie so we can find your photos."}
            </p>
          </div>
        )}

        {mode === "captured" && (
          <span className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-henna text-white shadow-sm">
            <Check className="size-4" />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {mode === "live" ? (
          <Button type="button" variant="marigold" size="xl" className="flex-1" onClick={capture}>
            <Camera /> Capture
          </Button>
        ) : mode === "captured" ? (
          <Button type="button" variant="outline" size="xl" className="flex-1" onClick={retake}>
            <RotateCcw /> Retake
          </Button>
        ) : (
          <Button
            type="button"
            variant="marigold"
            size="xl"
            className="flex-1"
            onClick={startCamera}
            disabled={mode === "requesting"}
          >
            <Camera /> {mode === "requesting" ? "Opening camera…" : "Use camera"}
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="xl"
          className="flex-1"
          onClick={() => fileRef.current?.click()}
        >
          <Upload /> Upload photo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="user"
          className="sr-only"
          aria-label="Upload a selfie photo"
          onChange={onFile}
        />
      </div>
    </div>
  );
}
