import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Shaadi wordmark. Fraunces italic display with a small Devanagari mark
 * and a marigold accent dot — an invitation-card signature, not a logo box.
 */
export function Brand({
  className,
  size = "md",
  href = "/",
  withDevanagari = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  href?: string | null;
  withDevanagari?: boolean;
}) {
  const sizes = {
    sm: "text-xl",
    md: "text-2xl sm:text-3xl",
    lg: "text-4xl sm:text-5xl",
  } as const;

  const content = (
    <span className="inline-flex items-baseline gap-2">
      <span
        className={cn(
          "font-heading font-semibold tracking-tight text-maroon italic",
          sizes[size],
        )}
      >
        Shaadi
        <span className="text-marigold-deep not-italic">.</span>
      </span>
      {withDevanagari && (
        <span
          className="font-[family-name:var(--font-devanagari)] text-sm text-marigold-deep/90"
          aria-hidden
        >
          शादी
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
      aria-label="Shaadi — home"
      className={cn(
        "inline-flex rounded-lg focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
        className,
      )}
    >
      {content}
    </Link>
  );
}
