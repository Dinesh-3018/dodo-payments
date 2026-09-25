import type { Art } from "../catalog";

/** Small product illustrations. Tinted with the accent so the summary feels owned. */
export function ProductArt({ art }: { art: Art }) {
  if (art === "mat") {
    return (
      <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
        <rect x="6" y="18" width="52" height="30" rx="4" fill="#475569" />
        <rect x="10" y="22" width="44" height="22" rx="2" fill="#64748b" />
        <rect x="16" y="28" width="20" height="10" rx="2" fill="#cbd5e1" />
        <rect x="40" y="30" width="8" height="6" rx="1.5" fill="#e2e8f0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
      <rect x="14" y="10" width="30" height="42" rx="3" fill="var(--accent)" opacity="0.18" />
      <rect x="18" y="8" width="30" height="42" rx="3" fill="var(--accent)" opacity="0.5" />
      <rect x="22" y="6" width="30" height="42" rx="3" fill="var(--accent)" />
      <rect x="22" y="6" width="5" height="42" rx="1" fill="#000" opacity="0.18" />
      <circle cx="40" cy="20" r="1.4" fill="#fff" opacity="0.8" />
      <circle cx="45" cy="20" r="1.4" fill="#fff" opacity="0.8" />
      <circle cx="40" cy="25" r="1.4" fill="#fff" opacity="0.8" />
      <circle cx="45" cy="25" r="1.4" fill="#fff" opacity="0.8" />
    </svg>
  );
}
