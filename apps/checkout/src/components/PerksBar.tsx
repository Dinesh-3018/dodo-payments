import { useEffect, useRef } from "react";
import type { Perk, PerkProgress } from "../catalog";
import { formatMoney } from "../money";

interface Props {
  perks: Perk[];
  progress: PerkProgress;
  currency: string;
}

/**
 * The track is drawn from the first badge centre to the last, so a fill of
 * (i + 0.5) / n (the centre of segment i) maps to a point i / (n - 1) along it.
 */
function trackPercent(fill: number, n: number): number {
  if (n <= 1) return fill >= 0.5 ? 100 : 0;
  const segments = fill * n - 0.5; // 0 at the first badge, n - 1 at the last
  return Math.min(100, Math.max(0, (segments / (n - 1)) * 100));
}

export function PerksBar({ perks, progress, currency }: Props) {
  const previous = useRef(progress.unlocked);
  const justUnlocked = progress.unlocked > previous.current ? progress.unlocked - 1 : -1;
  useEffect(() => {
    previous.current = progress.unlocked;
  }, [progress.unlocked]);

  return (
    <div className="perks" aria-label="Order perks">
      <ol className="perks-list">
        <div className="perks-track" aria-hidden="true">
          <div className="perks-fill" style={{ width: `${trackPercent(progress.fill, perks.length)}%` }} />
        </div>
        {perks.map((perk, i) => {
          const unlocked = i < progress.unlocked;
          return (
            <li key={perk.label} className={"perk" + (unlocked ? " is-unlocked" : "") + (i === justUnlocked ? " is-new" : "")}>
              <span className="perk-amount num">{formatMoney(perk.threshold, currency)}</span>
              <span className="perk-badge" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.5l4.5 4.5L19 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="perk-label">
                {perk.label}
                <span className="sr-only">{unlocked ? ", unlocked" : ", locked"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="perks-line" aria-live="polite">
        {progress.next ? (
          <>
            <strong className="num">{formatMoney(progress.remaining, currency)}</strong> away from {progress.next.detail}
          </>
        ) : (
          "Every perk unlocked"
        )}
      </p>
    </div>
  );
}
