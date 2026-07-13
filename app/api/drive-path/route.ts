import { NextRequest, NextResponse } from "next/server";
import { buildDrivingPolyline, type LatLon } from "@/lib/drive-path";
import { badRequest, serverError } from "@/lib/http";

/**
 * POST { coordinates: [[lat, lon], ...] } → { polyline, source }
 * Used by the map to snake stop-to-stop on real roads.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { coordinates?: unknown };
    const raw = body?.coordinates;
    if (!Array.isArray(raw) || raw.length < 2) {
      return badRequest("coordinates must be an array of at least 2 [lat, lon] pairs.");
    }
    if (raw.length > 200) {
      return badRequest("Too many coordinates (max 200).");
    }
    const coordinates: LatLon[] = [];
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 2) {
        return badRequest("Each coordinate must be [lat, lon].");
      }
      const lat = Number(item[0]);
      const lon = Number(item[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return badRequest("Invalid lat/lon.");
      }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return badRequest("lat/lon out of range.");
      }
      coordinates.push([lat, lon]);
    }

    const result = await buildDrivingPolyline(coordinates);
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return serverError("Unable to build driving path.");
  }
}
