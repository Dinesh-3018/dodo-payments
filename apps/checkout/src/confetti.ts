import confetti from "canvas-confetti";

function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function palette(): string[] {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1d4ed8";
  return [accent, "#f5b400", "#ffffff", "#0a0a0a", "#a3a3a3"];
}

let raining = false;

/** Confetti falling from the top edge across the whole panel, for about a second. */
export function rain(durationMs = 1300) {
  if (reducedMotion() || raining) return;
  raining = true;
  const colors = palette();
  const end = performance.now() + durationMs;
  const frame = () => {
    confetti({
      particleCount: 5,
      angle: 270,
      spread: 60,
      startVelocity: 12,
      gravity: 0.8,
      drift: (Math.random() - 0.5) * 0.8,
      ticks: 230,
      scalar: 0.9,
      origin: { x: Math.random(), y: -0.08 },
      colors,
      disableForReducedMotion: true,
    });
    if (performance.now() < end) requestAnimationFrame(frame);
    else raining = false;
  };
  requestAnimationFrame(frame);
}

/** One burst from the middle, for the moment the payment goes through. */
export function burst() {
  if (reducedMotion()) return;
  confetti({
    particleCount: 110,
    spread: 80,
    startVelocity: 36,
    origin: { x: 0.5, y: 0.4 },
    colors: palette(),
    ticks: 210,
    scalar: 0.85,
    gravity: 1.1,
    disableForReducedMotion: true,
  });
}
