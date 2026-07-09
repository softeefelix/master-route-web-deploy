import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { daySchema, routeClusterIdSchema } from "@/lib/validators";

export type TimedStopDto = {
  order: number;
  stopClusterId: number;
  arrive: string;
  leaveBy: string;
  windowStart: string;
  windowEnd: string;
  expPerVisit: number;
  visits: number;
  address: string;
};

export type TimedRouteDto = {
  routeClusterId: number;
  day: string;
  stops: TimedStopDto[];
  generatedAt: string | null;
};

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
        stop_order: number;
        stop_cluster_id: number;
        arrive: string;
        leave_by: string;
        window_start: string;
        window_end: string;
        exp_per_visit: Prisma.Decimal;
        visits: number;
        address: string | null;
        generated_at: Date;
      }>
    >(Prisma.sql`
      SELECT stop_order, stop_cluster_id, arrive, leave_by, window_start, window_end,
             exp_per_visit, visits, address, generated_at
      FROM route_timed_stops
      WHERE route_cluster_id = ${routeClusterParsed.data} AND dow = ${dayParsed.data}
      ORDER BY stop_order
    `);

    const dto: TimedRouteDto = {
      routeClusterId: routeClusterParsed.data,
      day: dayParsed.data,
      stops: rows.map((row) => ({
        order: row.stop_order,
        stopClusterId: row.stop_cluster_id,
        arrive: row.arrive,
        leaveBy: row.leave_by,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        expPerVisit: Number(row.exp_per_visit),
        visits: row.visits,
        address: row.address ?? ""
      })),
      generatedAt: rows.length > 0 ? rows[0].generated_at.toISOString() : null
    };
    return NextResponse.json(dto);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
      return NextResponse.json({
        routeClusterId: routeClusterParsed.data,
        day: dayParsed.data,
        stops: [],
        generatedAt: null
      });
    }
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable(
        "Data is temporarily unavailable because the database connection failed. Please retry in a moment."
      );
    }
    return serverError("Unable to load the timed route schedule.");
  }
}
