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
  lat?: number;
  lon?: number;
  daypart?: string | null;
};

export type TimedRouteDto = {
  routeClusterId: number;
  day: string;
  stops: TimedStopDto[];
  generatedAt: string | null;
  source: "geotab" | "timed" | "none";
  seasonVariant?: string | null;
  geotabRouteName?: string | null;
};

function preferredSeasonVariant(today = new Date()): "school" | "no-school" {
  const month = today.getMonth() + 1;
  const dayNum = today.getDate();
  const md = month * 100 + dayNum;
  if (md >= 608 && md <= 814) return "no-school";
  return "school";
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
    // 1) LIVE Geotab master preferred
    try {
      const masters = await prisma.$queryRaw<
        Array<{
          season_variant: string;
          geotab_route_name: string;
          generated_at: Date;
        }>
      >(Prisma.sql`
        SELECT season_variant, geotab_route_name, generated_at
        FROM geotab_route_masters
        WHERE route_cluster_id = ${routeClusterParsed.data}
          AND dow = ${dayParsed.data}
          AND active = TRUE
          AND live = TRUE
      `);
      if (masters.length > 0) {
        const want = preferredSeasonVariant();
        const pick =
          masters.find((m) => (m.season_variant || "") === want) ??
          masters.find((m) => !m.season_variant) ??
          masters[0];
        const season = pick.season_variant || "";
        const gRows = await prisma.$queryRaw<
          Array<{
            stop_order: number;
            stop_cluster_id: number | null;
            arrive: string | null;
            address: string | null;
            lat: number;
            lon: number;
            daypart: string | null;
          }>
        >(Prisma.sql`
          SELECT stop_order, stop_cluster_id, arrive, address, lat, lon, daypart
          FROM geotab_route_master_stops
          WHERE route_cluster_id = ${routeClusterParsed.data}
            AND dow = ${dayParsed.data}
            AND season_variant = ${season}
          ORDER BY stop_order
        `);
        if (gRows.length > 0) {
          const dto: TimedRouteDto = {
            routeClusterId: routeClusterParsed.data,
            day: dayParsed.data,
            stops: gRows.map((row, i) => ({
              order: row.stop_order,
              stopClusterId: row.stop_cluster_id ?? -(i + 1),
              arrive: row.arrive ?? "",
              leaveBy: "",
              windowStart: "",
              windowEnd: "",
              expPerVisit: 0,
              visits: 0,
              address: row.address ?? "",
              lat: row.lat,
              lon: row.lon,
              daypart: row.daypart
            })),
            generatedAt: pick.generated_at.toISOString(),
            source: "geotab",
            seasonVariant: season || null,
            geotabRouteName: pick.geotab_route_name
          };
          return NextResponse.json(dto);
        }
      }
    } catch {
      // table missing — fall through
    }

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
      generatedAt: rows.length > 0 ? rows[0].generated_at.toISOString() : null,
      source: rows.length > 0 ? "timed" : "none"
    };
    return NextResponse.json(dto);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
      return NextResponse.json({
        routeClusterId: routeClusterParsed.data,
        day: dayParsed.data,
        stops: [],
        generatedAt: null,
        source: "none"
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
