import { z } from "zod";
import { DEFAULT_ROUTE_CLUSTER_LIMIT, DEFAULT_TOP_STOPS } from "@/lib/constants";

export const daySchema = z.string().min(1);
export const routeClusterIdSchema = z.coerce.number().int().nonnegative();
export const persistentRouteClusterIdSchema = z.coerce.number().int().positive();
export const routeClusterLimitSchema = z.coerce.number().int().positive().default(DEFAULT_ROUTE_CLUSTER_LIMIT);
export const topStopsSchema = z.coerce.number().int().positive().default(DEFAULT_TOP_STOPS);
export const monthSchema = z.coerce.number().int().min(1).max(12);
export const monthsSchema = z.array(monthSchema).min(1);
