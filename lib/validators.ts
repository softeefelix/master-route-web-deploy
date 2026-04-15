import { z } from "zod";

export const daySchema = z.string().min(1);
export const routeClusterIdSchema = z.coerce.number().int().nonnegative();
export const topStopsSchema = z.coerce.number().int().positive().default(50);
