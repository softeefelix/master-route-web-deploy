import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { badRequest, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/route-trace?routeClusterId=N&day=Day&seasonVariant=school|no-school
 *
 * Returns the stored actual GPS trace (breadcrumb path) for a Geotab master,
 * or null when no trace has been captured for that master yet.
 *
 * The trace is the ordered GPS breadcrumb from log_records (+ gap-fill
 * bridges) — the REAL path the truck drove, not OSRM's guess.  When present
 * it becomes the primary route polyline; OSRM /api/drive-path is fallback.
 *
 * Response: { trace: [lat,lon][] | null, stats: {...} | null, source: "trace" | "none" }
 */
export async function GET(request: NextRequest) {
  const rcParam = request.nextUrl.searchParams.get("routeClusterId");
  const dayParam = request.nextUrl.searchParams.get("day");
  const seasonParam = request.nextUrl.searchParams.get("seasonVariant");

  if (!rcParam || !dayParam) {
    return badRequest("routeClusterId and day query parameters are required.");
  }

  const routeClusterId = Number(rcParam);
  if (!Number.isFinite(routeClusterId) || routeClusterId < 1) {
    return badRequest("routeClusterId must be a positive integer.");
  }

  try {
    // Find the live master for this route+day, with trace table join
    const rows = await prisma.$queryRaw<
      Array<{
        trace: Array<[number, number]> | null;
        trace_stats: Record<string, unknown> | null;
        source_truck: number | null;
        source_date: Date | null;
        geotab_route_name: string | null;
      }>
    >(Prisma.sql`
      SELECT
        p.trace,
        p.trace_stats,
        m.source_truck,
        m.source_date,
        m.geotab_route_name
      FROM geotab_route_masters m
      LEFT JOIN geotab_route_master_path p
        ON m.route_cluster_id = p.route_cluster_id
        AND m.dow = p.dow
        AND (m.season_variant = p.season_variant
             OR (m.season_variant = '' AND p.season_variant = ''))
      WHERE m.route_cluster_id = ${routeClusterId}
        AND m.dow = ${dayParam}
        AND m.active = TRUE
        AND m.live = TRUE
      ORDER BY
        CASE WHEN p.trace IS NOT NULL THEN 0 ELSE 1 END,
        m.generated_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) {
      return NextResponse.json({
        trace: null,
        stats: null,
        source: "none",
        note: "no live master for this route+day",
      });
    }

    const row = rows[0];
    const trace = row.trace ?? null;
    const stats = row.trace_stats ?? null;

    // Validate trace shape
    if (trace && (!Array.isArray(trace) || trace.length < 2)) {
      console.warn(
        `Trace for routeClusterId=${routeClusterId} day=${dayParam} has invalid shape (length=${trace?.length}) — treating as missing.`
      );
      return NextResponse.json({
        trace: null,
        stats: null,
        source: "none",
        note: "stored trace invalid (too short)",
      });
    }

    return NextResponse.json({
      trace,
      stats,
      source: trace ? "trace" : "none",
      sourceTruck: row.source_truck,
      sourceDate: row.source_date?.toISOString() ?? null,
      routeName: row.geotab_route_name,
    });
  } catch (error) {
    console.error("route-trace endpoint error:", error);
    return serverError("Unable to load route trace.");
  }
}
