import type { CardBrand } from "../card";

export function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function WifiOffIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="19" r="1.3" fill="currentColor" />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function CardBrandIcon({ brand }: { brand: CardBrand }) {
  if (brand === "unknown") {
    return (
      <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">
        <rect x="0.5" y="0.5" width="27" height="19" rx="3" fill="#fff" stroke="#cbd5e1" />
        <rect x="3" y="5" width="22" height="3" rx="1" fill="#cbd5e1" />
        <rect x="3" y="12" width="9" height="2.5" rx="1" fill="#e2e8f0" />
      </svg>
    );
  }
  if (brand === "visa") {
    return (
      <svg width="28" height="20" viewBox="0 0 28 20" aria-label="Visa" role="img">
        <rect width="28" height="20" rx="3" fill="#1a1f71" />
        <text x="14" y="14" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="9" fontWeight="700" fontStyle="italic" fill="#fff">VISA</text>
      </svg>
    );
  }
  if (brand === "mastercard") {
    return (
      <svg width="28" height="20" viewBox="0 0 28 20" aria-label="Mastercard" role="img">
        <rect width="28" height="20" rx="3" fill="#0f172a" />
        <circle cx="11" cy="10" r="5.5" fill="#eb001b" />
        <circle cx="17" cy="10" r="5.5" fill="#f79e1b" fillOpacity="0.92" />
      </svg>
    );
  }
  if (brand === "amex") {
    return (
      <svg width="28" height="20" viewBox="0 0 28 20" aria-label="American Express" role="img">
        <rect width="28" height="20" rx="3" fill="#2e77bc" />
        <text x="14" y="13.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="7" fontWeight="700" fill="#fff">AMEX</text>
      </svg>
    );
  }
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" aria-label="Discover" role="img">
      <rect width="28" height="20" rx="3" fill="#f4f4f4" stroke="#d4d4d4" />
      <circle cx="19" cy="10" r="4" fill="#f58220" />
    </svg>
  );
}
