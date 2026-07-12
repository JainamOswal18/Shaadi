import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Jeena wordmark — "JEENA" set in Fraunces caps, letterspaced, with an
 * optional "Est. 2026 · Forever" subline for large placements.
 */
export function Brand({
  className,
  size = "md",
  href = "/",
  withEst = false,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  href?: string | null;
  withEst?: boolean;
}) {
  const sizes = {
    sm: "text-lg",
    md: "text-xl sm:text-2xl",
    lg: "text-3xl sm:text-4xl",
  } as const;

  const content = (
    <span className="inline-flex flex-col items-center">
      <span
        className={cn(
          "font-heading font-semibold uppercase text-maroon",
          "tracking-[0.18em]",
          sizes[size],
        )}
      >
        Jeena
      </span>
      {withEst && size === "lg" && (
        <span className="mt-1 text-[0.6rem] font-medium uppercase tracking-[0.3em] text-marigold-deep">
          Est. 2026 · Forever
        </span>
      )}
    </span>
  );

  if (href === null) {
    return <span className={cn("inline-flex", className)}>{content}</span>;
  }

  return (
    <Link
      href={href}
      aria-label="Jeena — home"
      className={cn(
        "inline-flex rounded-lg focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
        className,
      )}
    >
      {content}
    </Link>
  );
}
