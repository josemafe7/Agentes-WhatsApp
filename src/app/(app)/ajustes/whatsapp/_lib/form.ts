// The «Tarifa» form of Ajustes › WhatsApp ([AJU-09], [AJU-15]): the price is typed as text, with a comma or a point, and
// becomes a number here; the market and the category are checked by src/data with Meta's list.
import { z } from "zod";

/** «0,0509», «0.0509» or «1»: digits with at most one decimal separator. */
const PRICE_PATTERN = /^\d{1,6}(?:[.,]\d{1,8})?$/;

export const pricingRateFormSchema = z
  .object({
    country: z.string().max(10),
    category: z.string().max(60),
    price: z
      .string()
      .trim()
      // An empty price only gets this message, not the format one too.
      .min(1, { error: "Escribe el precio.", abort: true })
      .regex(PRICE_PATTERN, "Escribe el precio con números, como 0,0509.")
      .transform((value) => Number(value.replace(",", "."))),
  })
  .strict();

export type PricingRateFormValues = z.input<typeof pricingRateFormSchema>;
