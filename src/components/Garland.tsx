import { cn } from "@/lib/utils";

/**
 * Signature element: a marigold garland (genda-phool toran) strung on a gold
 * thread. Pure SVG so it stays crisp and theme-aware. Decorative only.
 */
export function Garland({
  className,
  count = 11,
}: {
  className?: string;
  count?: number;
}) {
  const width = 320;
  const gap = width / (count - 1);
  const flowers = Array.from({ length: count }, (_, i) => {
    const x = i * gap;
    const drop = i % 2 === 0 ? 15 : 12;
    const r = i % 2 === 0 ? 6.5 : 5.5;
    return { x, y: drop, r };
  });

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${width} 26`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("h-6 w-full max-w-[22rem]", className)}
    >
      {/* gold thread */}
      <path
        d={`M0 6 Q ${width / 2} 16 ${width} 6`}
        fill="none"
        stroke="var(--gold)"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.9"
      />
      {flowers.map((f, i) => (
        <g key={i} transform={`translate(${f.x} ${f.y})`}>
          <line x1="0" y1={-f.y + 8} x2="0" y2="-1" stroke="var(--gold)" strokeWidth="0.75" opacity="0.7" />
          {/* layered petals */}
          <circle cx="0" cy="0" r={f.r} fill="var(--marigold)" />
          <circle cx="0" cy="0" r={f.r * 0.66} fill="var(--marigold-deep)" opacity="0.55" />
          <circle cx="0" cy="0" r={f.r * 0.3} fill="var(--gold)" />
        </g>
      ))}
    </svg>
  );
}
