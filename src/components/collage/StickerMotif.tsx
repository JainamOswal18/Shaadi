export function StickerMotif({
  id,
  color,
}: {
  id: "garland" | "phera" | "doli";
  color: string;
}) {
  if (id === "garland") {
    return (
      <svg viewBox="0 0 64 64" width={40} height={40} aria-hidden>
        <path d="M4 8 Q32 40 60 8" stroke={color} strokeWidth="2" fill="none" />
        {[8, 20, 32, 44, 56].map((x, i) => (
          <circle key={i} cx={x} cy={12 + Math.sin(i) * 6} r="5" fill={color} />
        ))}
      </svg>
    );
  }
  if (id === "phera") {
    return (
      <svg viewBox="0 0 64 64" width={40} height={40} aria-hidden>
        <circle cx="32" cy="40" r="14" fill="none" stroke={color} strokeWidth="2" />
        <path
          d="M32 26 L32 10 M24 16 L32 10 L40 16"
          stroke={color}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // doli — a simple palanquin silhouette
  return (
    <svg viewBox="0 0 64 64" width={40} height={40} aria-hidden>
      <path d="M14 20 Q32 8 50 20" stroke={color} strokeWidth="2.5" fill="none" />
      <rect x="18" y="20" width="28" height="20" rx="4" fill="none" stroke={color} strokeWidth="2.5" />
      <line x1="4" y1="18" x2="4" y2="46" stroke={color} strokeWidth="2.5" />
      <line x1="60" y1="18" x2="60" y2="46" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}
