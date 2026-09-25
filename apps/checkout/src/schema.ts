import { z } from "zod";
import { cvcLength, detectBrand, luhn, numberLength, validateExpiry } from "./card";

/**
 * The form, as a schema. Digits-only strings for the card fields (the inputs
 * format them for display); the messages are the ones the buyer reads.
 */
export const checkoutSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1, "Enter your email so we can send the receipt.")
      .pipe(z.email("Enter a valid email like name@example.com.")),
    number: z
      .string()
      .min(1, "Enter your card number.")
      .superRefine((digits, ctx) => {
        if (digits.length < numberLength(detectBrand(digits))) {
          ctx.addIssue({ code: "custom", message: "Your card number is incomplete." });
        } else if (!luhn(digits)) {
          ctx.addIssue({ code: "custom", message: "This card number doesn't look right. Check it and try again." });
        }
      }),
    expiry: z.string().superRefine((digits, ctx) => {
      const problem = validateExpiry(digits);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
    cvc: z.string(),
  })
  .superRefine((values, ctx) => {
    // The CVC's length depends on the card brand, so it is checked with the number in view.
    const need = cvcLength(detectBrand(values.number));
    if (values.cvc.length < need) ctx.addIssue({ code: "custom", path: ["cvc"], message: "CVC is incomplete." });
    else if (values.cvc.length > need) ctx.addIssue({ code: "custom", path: ["cvc"], message: `CVC should be ${need} digits.` });
  });

export type FormValues = z.infer<typeof checkoutSchema>;
export type FieldKey = keyof FormValues;

export const emptyForm: FormValues = { email: "", number: "", expiry: "", cvc: "" };

/** First message per field, so each field shows one problem at a time. */
export function validate(values: FormValues): Partial<Record<FieldKey, string>> {
  const result = checkoutSchema.safeParse(values);
  if (result.success) return {};
  const errors: Partial<Record<FieldKey, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as FieldKey | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
