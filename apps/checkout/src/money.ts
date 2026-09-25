/** Whole amounts drop the decimals (₹349, not ₹349.00), the way Indian stores print them. */
export function formatMoney(amount: number, currency: string): string {
  const whole = amount % 100 === 0;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
