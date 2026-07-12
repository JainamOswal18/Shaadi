import { ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";

function Meter({
  label,
  used,
  max,
  icon,
}: {
  label: string;
  used: number;
  max: number;
  icon: React.ReactNode;
}) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  const full = used >= max;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          {icon} {label}
        </span>
        <span className={cn("tabular text-xs", full ? "text-destructive" : "text-muted-foreground")}>
          {used} / {max}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
        aria-label={`${label}: ${used} of ${max} used`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            full ? "bg-destructive" : "bg-marigold",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function QuotaBar({
  photos,
  videos,
}: {
  photos: { used: number; max: number };
  videos: { used: number; max: number };
}) {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:grid-cols-2">
      <Meter
        label="Photos"
        used={photos.used}
        max={photos.max}
        icon={<ImageIcon className="size-4 text-marigold-deep" />}
      />
      <Meter
        label="Videos"
        used={videos.used}
        max={videos.max}
        icon={<Video className="size-4 text-marigold-deep" />}
      />
    </div>
  );
}
