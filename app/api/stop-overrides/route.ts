import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { daySchema, routeClusterIdSchema } from "@/lib/validators";

export type StopOverrideDto = {
  stopClusterId: number;
  arrivalTime: string | null;
  hidden: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

export type RouteOverridesDto = {
  routeClusterId: number;
  day: string;
  overrides: StopOverrideDto[];
};

const ARRIVAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function emptyDto(routeClusterId: number, day: string): RouteOverridesDto {
  return { routeClusterId, day, overrides: [] };
}

export async function GET(request: NextRequest) {
  const dayParsed = daySchema.safeParse(request.nextUrl.searchParams.get("day"));
  const routeClusterParsed = routeClusterIdSchema.safeParse(
    request.nextUrl.searchParams.get("routeClusterId")
  );
  if (!dayParsed.success || !routeClusterParsed.success) {
    return badRequest("Valid day and routeClusterId query parameters are required.");
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        stop_cluster_id: number;
        arrival_time: string | null;
        hidden: boolean;
        updated_by: string | null;
        updated_at: Date;
      }>
    >(Prisma.sql`
      SELECT stop_cluster_id, arrival_time, hidden, updated_by, updated_at
      FROM route_stop_overrides
      WHERE route_cluster_id = ${routeClusterParsed.data} AND dow = ${dayParsed.data}
    `);

    const dto: RouteOverridesDto = {
      routeClusterId: routeClusterParsed.data,
      day: dayParsed.data,
      overrides: rows.map((row) => ({
        stopClusterId: row.stop_cluster_id,
        arrivalTime: row.arrival_time,
        hidden: row.hidden,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString()
      }))
    };
    return NextResponse.json(dto);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
      return NextResponse.json(emptyDto(routeClusterParsed.data, dayParsed.data));
    }
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable(
        "Data is temporarily unavailable because the database connection failed. Please retry in a moment."
      );
    }
    return serverError("Unable to load stop overrides.");
  }
}

const putSchema = z.object({
  routeClusterId: z.coerce.number().int().nonnegative(),
  day: z.string().min(1),
  stopClusterId: z.coerce.number().int().nonnegative(),
  arrivalTime: z
    .string()
    .regex(ARRIVAL_TIME_PATTERN, "arrivalTime must be HH:MM (24h).")
    .nullable()
    .optional(),
  hidden: z.boolean().optional(),
  updatedBy: z.string().trim().max(64).optional()
});

export async function PUT(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = putSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const { routeClusterId, day, stopClusterId, updatedBy } = parsed.data;
  const arrivalTime = parsed.data.arrivalTime ?? null;
  const hidden = parsed.data.hidden ?? false;

  try {
    if (arrivalTime === null && !hidden) {
      // No override left — remove the row to keep the table clean.
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM route_stop_overrides
        WHERE route_cluster_id = ${routeClusterId} AND dow = ${day} AND stop_cluster_id = ${stopClusterId}
      `);
    } else {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO route_stop_overrides
          (route_cluster_id, dow, stop_cluster_id, arrival_time, hidden, updated_by, updated_at)
        VALUES (${routeClusterId}, ${day}, ${stopClusterId}, ${arrivalTime}, ${hidden}, ${updatedBy ?? null}, now())
        ON CONFLICT (route_cluster_id, dow, stop_cluster_id)
        DO UPDATE SET arrival_time = EXCLUDED.arrival_time,
                      hidden = EXCLUDED.hidden,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = now()
      `);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable(
        "Data is temporarily unavailable because the database connection failed. Please retry in a moment."
      );
    }
    return serverError("Unable to save the stop override.");
  }
}
