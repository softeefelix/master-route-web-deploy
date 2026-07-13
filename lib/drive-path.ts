/**
 * Road-following path between ordered stops.
 * Chunks coordinates for OSRM / Mapbox limits and stitches the result.
 */

export type LatLon = [number, number]; // [lat, lon]

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
/** OSRM public API is happiest with short legs; 20 keeps URLs/reqs reliable. */
const MAX_WAYPOINTS_PER_REQUEST = 20;

function havM(a: LatLon, b: LatLon): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const p1 = toR(a[0]);
  const p2 = toR(b[0]);
  const dp = toR(b[0] - a[0]);
  const dl = toR(b[1] - a[1]);
  const x =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

/** Drop consecutive duplicates / near-duplicates so the router doesn't stall. */
export function dedupeWaypoints(points: LatLon[], minM = 15): LatLon[] {
  const out: LatLon[] = [];
  for (const p of points) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (out.length === 0 || havM(out[out.length - 1], p) >= minM) {
      out.push(p);
    }
  }
  return out;
}

function chunkOverlapping(points: LatLon[], size: number): LatLon[][] {
  if (points.length <= size) return [points];
  const chunks: LatLon[][] = [];
  let i = 0;
  while (i < points.length - 1) {
    const end = Math.min(i + size, points.length);
    chunks.push(points.slice(i, end));
    if (end >= points.length) break;
    // Overlap last point so legs stitch cleanly.
    i = end - 1;
  }
  return chunks;
}

async function osrmLeg(points: LatLon[]): Promise<LatLon[] | null> {
  if (points.length < 2) return points;
  const coordStr = points.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const url = `${OSRM_BASE}/${coordStr}?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url, {
      // OSRM is public/demo; short timeout so the map falls back fast.
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "mistersoftee-master-route/1.0" }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{ geometry?: { coordinates?: number[][] } }>;
    };
    if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates?.length) {
      return null;
    }
    // GeoJSON is [lon, lat] → Leaflet wants [lat, lon]
    return data.routes[0].geometry.coordinates.map(
      ([lon, lat]) => [lat, lon] as LatLon
    );
  } catch {
    return null;
  }
}

/**
 * Return a street-following polyline. Falls back to the straight path if
 * routing fails entirely so the map never blanks the line.
 */
export async function buildDrivingPolyline(stops: LatLon[]): Promise<{
  polyline: LatLon[];
  source: "osrm" | "straight";
}> {
  const points = dedupeWaypoints(stops);
  if (points.length < 2) {
    return { polyline: points, source: "straight" };
  }

  const chunks = chunkOverlapping(points, MAX_WAYPOINTS_PER_REQUEST);
  const stitched: LatLon[] = [];

  for (let c = 0; c < chunks.length; c += 1) {
    // Soft rate limit against public OSRM.
    if (c > 0) {
      await new Promise((r) => setTimeout(r, 120));
    }
    const leg = await osrmLeg(chunks[c]);
    if (!leg || leg.length === 0) {
      // Fall this chunk back to waypoint-only so a route never blanks.
      const wp = chunks[c];
      if (stitched.length === 0) stitched.push(...wp);
      else stitched.push(...wp.slice(1));
      continue;
    }
    if (stitched.length === 0) {
      stitched.push(...leg);
    } else {
      // Drop first vertex of this leg (shared with previous end).
      stitched.push(...leg.slice(1));
    }
  }

  const usedOsrm = stitched.length > points.length * 1.2;
  return {
    polyline: stitched.length >= 2 ? stitched : points,
    source: usedOsrm ? "osrm" : "straight"
  };
}
