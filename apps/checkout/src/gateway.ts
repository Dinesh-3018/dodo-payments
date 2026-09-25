/**
 * The fake payment network. It behaves like the real one where it matters:
 * a charge is sent, then an answer arrives later; the answer can be no; the
 * bank can ask for an extra check; and the connection can drop in between,
 * in which case the answer is unknown until the connection returns. Nothing
 * here guesses. The test cards from the brief drive the outcome.
 */
export type ChargeFailure = "payment_declined" | "payment_failed" | "authentication_failed" | "insufficient_stock";
export type Outcome = { ok: true; paymentId: string } | { ok: false; code: ChargeFailure };

export const CHALLENGE_CARD = "4000000000003220";

interface PendingPayment {
  id: string;
  settleAt: number;
  outcome: Outcome;
}

const pending = new Map<string, PendingPayment>();
const attemptsByCard = new Map<string, number>();

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Send the charge. Call only when online: once this returns, the charge is
 * on its way and the only honest thing left to do is wait for the answer.
 */
export function submitPayment(cardDigits: string, quantity: number, stock: number): { id: string; challenge: boolean } {
  const attempt = (attemptsByCard.get(cardDigits) ?? 0) + 1;
  attemptsByCard.set(cardDigits, attempt);
  const id = "pay_" + Math.random().toString(36).slice(2, 12);

  // The flaky card's first attempt hangs like a real timeout would, long
  // enough that the button changes its copy before giving up.
  const slow = cardDigits === "4000000000000341" && attempt === 1;
  const delay = slow ? 5200 : 1100 + Math.random() * 700;

  let outcome: Outcome;
  if (quantity > stock) outcome = { ok: false, code: "insufficient_stock" };
  else if (cardDigits === "4000000000000002") outcome = { ok: false, code: "payment_declined" };
  else if (slow) outcome = { ok: false, code: "payment_failed" };
  else outcome = { ok: true, paymentId: id };

  pending.set(id, { id, settleAt: performance.now() + delay, outcome });
  return { id, challenge: cardDigits === CHALLENGE_CARD };
}

/** The bank's answer to its own extra check. Abandoning it counts as a decline. */
export function completeChallenge(id: string, approved: boolean) {
  const payment = pending.get(id);
  if (!payment) return;
  if (!approved) payment.outcome = { ok: false, code: "authentication_failed" };
  payment.settleAt = performance.now() + 900;
}

/**
 * Wait for the answer. If the connection drops while waiting, say so and
 * wait for it to come back; the answer exists on the other side regardless.
 */
export async function awaitOutcome(id: string, onWaitingForNetwork: (waiting: boolean) => void): Promise<Outcome> {
  const payment = pending.get(id);
  if (!payment) throw new Error("Unknown payment " + id);
  for (;;) {
    if (isOffline()) {
      onWaitingForNetwork(true);
      await onceOnline();
      onWaitingForNetwork(false);
      continue;
    }
    const remaining = payment.settleAt - performance.now();
    if (remaining <= 0) break;
    await wait(Math.min(remaining, 150));
  }
  pending.delete(id);
  return payment.outcome;
}

function onceOnline(): Promise<void> {
  return new Promise((resolve) => {
    if (!isOffline()) return resolve();
    const done = () => {
      window.removeEventListener("online", done);
      resolve();
    };
    window.addEventListener("online", done);
  });
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
