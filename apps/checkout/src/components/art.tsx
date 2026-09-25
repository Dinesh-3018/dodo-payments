import type { Art } from "../catalog";

/** Small product illustrations in neutral ink, so the host accent appears only where it should. */
export function ProductArt({ art }: { art: Art }) {
  switch (art) {
    case "ghee":
      return (
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
          <rect x="16" y="14" width="32" height="40" rx="6" fill="#1f1f1f" />
          <rect x="20" y="8" width="24" height="8" rx="3" fill="#0a0a0a" opacity="0.5" />
          <rect x="21" y="26" width="22" height="16" rx="3" fill="#fff" opacity="0.85" />
        </svg>
      );
    case "rice":
      return (
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
          <path d="M18 22h28l4 30H14z" fill="#1f1f1f" />
          <path d="M22 22c0-6 4-10 10-10s10 4 10 10" fill="none" stroke="#0a0a0a" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
          <rect x="24" y="34" width="16" height="10" rx="2" fill="#fff" opacity="0.85" />
        </svg>
      );
    case "pickle":
      return (
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
          <rect x="18" y="18" width="28" height="36" rx="8" fill="#1f1f1f" />
          <rect x="16" y="10" width="32" height="10" rx="4" fill="#0a0a0a" opacity="0.5" />
          <circle cx="27" cy="34" r="3" fill="#fff" opacity="0.8" />
          <circle cx="37" cy="40" r="3" fill="#fff" opacity="0.8" />
          <circle cx="34" cy="28" r="2.2" fill="#fff" opacity="0.6" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
          <path d="M20 14h24v6l-4 4v22a8 8 0 0 1-16 0V24l-4-4z" fill="#1f1f1f" />
          <rect x="22" y="30" width="20" height="10" rx="2" fill="#fff" opacity="0.85" />
          <circle cx="32" cy="12" r="3" fill="#0a0a0a" opacity="0.5" />
        </svg>
      );
  }
}
