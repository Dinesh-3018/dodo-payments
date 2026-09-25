export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "unknown";

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function detectBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^6(011|5)/.test(digits)) return "discover";
  return "unknown";
}

export function numberLength(brand: CardBrand): number {
  return brand === "amex" ? 15 : 16;
}

export function cvcLength(brand: CardBrand): number {
  return brand === "amex" ? 4 : 3;
}

export function formatCardNumber(digits: string, brand: CardBrand): string {
  const groups = brand === "amex" ? [4, 6, 5] : [4, 4, 4, 4];
  const parts: string[] = [];
  let index = 0;
  for (const size of groups) {
    if (index >= digits.length) break;
    parts.push(digits.slice(index, index + size));
    index += size;
  }
  return parts.join(" ");
}

export function formatExpiry(digits: string): string {
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter your email so we can send the receipt.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Enter a valid email like name@example.com.";
  return null;
}

export function validateNumber(digits: string): string | null {
  if (!digits) return "Enter your card number.";
  const brand = detectBrand(digits);
  if (digits.length < numberLength(brand)) return "Your card number is incomplete.";
  if (!luhn(digits)) return "This card number doesn't look right. Check it and try again.";
  return null;
}

export function validateExpiry(digits: string, now = new Date()): string | null {
  if (digits.length < 4) return "Expiry is incomplete.";
  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2, 4));
  if (month < 1 || month > 12) return "Enter a month from 01 to 12.";
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) return "This card has expired.";
  if (year > currentYear + 20) return "Enter a valid year.";
  return null;
}

export function validateCvc(digits: string, brand: CardBrand): string | null {
  const need = cvcLength(brand);
  if (digits.length < need) return "CVC is incomplete.";
  if (digits.length > need) return `CVC should be ${need} digits.`;
  return null;
}
