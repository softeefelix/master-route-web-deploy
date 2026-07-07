import { z } from "zod";
import { DEFAULT_ROUTE_CLUSTER_LIMIT, DEFAULT_TOP_STOPS } from "@/lib/constants";

export const daySchema = z.string().min(1);
export const routeClusterIdSchema = z.coerce.number().int().nonnegative();
export const persistentRouteClusterIdSchema = z.coerce.number().int().positive();
export const routeClusterLimitSchema = z.coerce.number().int().positive().default(DEFAULT_ROUTE_CLUSTER_LIMIT);
export const topStopsSchema = z.coerce.number().int().positive().default(DEFAULT_TOP_STOPS);
export const monthSchema = z.coerce.number().int().min(1).max(12);
export const monthsSchema = z.array(monthSchema).min(1);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date must be a valid calendar date.");

export const dateRangeSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema
  })
  .refine((range) => range.from <= range.to, {
    message: "'from' date must be on or before 'to' date."
  });

export type DateRange = z.infer<typeof dateRangeSchema>;

/**
 * Parses optional from/to query params into a validated DateRange, or undefined
 * when neither is present (falls back to month filtering). Returns an error
 * string when partially specified or invalid.
 */
export function parseOptionalDateRange(
  fromRaw: string | null,
  toRaw: string | null
): { success: true; data: DateRange | undefined } | { success: false; error: string } {
  if (fromRaw == null && toRaw == null) {
    return { success: true, data: undefined };
  }

  if (fromRaw == null || toRaw == null) {
    return { success: false, error: "Both 'from' and 'to' query parameters are required together." };
  }

  const parsed = dateRangeSchema.safeParse({ from: fromRaw, to: toRaw });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid date range." };
  }

  return { success: true, data: parsed.data };
}
