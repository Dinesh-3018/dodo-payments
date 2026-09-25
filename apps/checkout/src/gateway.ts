/**
 * The fake payment network. It behaves like the real one where it matters:
 * it takes time, it can say no, and it can fail for reasons that are nobody's
 * fault. The test cards from the brief drive the outcome.
 */
export type ChargeFailure = "payment_declined" | "payment_failed" | "offline";
export type ChargeResult = { ok: true; paymentId: string } | { ok: false; code: ChargeFailure };

const attemptsByCard = new Map<string, number>();

export async function charge(cardDigits: string): Promise<ChargeResult> {
  const attempt = (attemptsByCard.get(cardDigits) ?? 0) + 1;
  attemptsByCard.set(cardDigits, attempt);

  if (isOffline()) {
    await wait(400);
    return { ok: false, code: "offline" };
  }
  // The flaky card's first attempt hangs like a real timeout would, long
  // enough that the button changes its copy before giving up.
  const slow = cardDigits === "4000000000000341" && attempt === 1;
  await wait(slow ? 5200 : 1100 + Math.random() * 700);
  if (isOffline()) return { ok: false, code: "offline" };

  if (cardDigits === "4000000000000002") return { ok: false, code: "payment_declined" };
  if (slow) return { ok: false, code: "payment_failed" };
  return { ok: true, paymentId: "pay_" + Math.random().toString(36).slice(2, 12) };
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
