import { Prisma } from "@prisma/client";
import { DEFAULT_ROUTE_CLUSTER_LIMIT } from "@/lib/constants";
import { getPersistentRouteClusterIds } from "@/lib/persistent-route-clusters";
import { prisma } from "@/lib/prisma";
import { buildDayRouteColorMap, buildRouteTitle, calculateBounds, sortDays } from "@/lib/utils";
import type { DateRange } from "@/lib/validators";
import type { DayOption, MonthOption, RouteClusterOption, RouteDetailDto, RouteSummaryDto } from "@/types/routes";

type RouteClusterRecord = {
  id: number;
  dow: string;
  centroidLat: number;
  centroidLong: number;
};

type SeasonalStopRow = {
  routeClusterId: number;
  stopClusterId: number;
  address: string | null;
  stopLat: number;
  stopLon: number;
  totalSales: number;
  visits: number;
  firstArrivalMinute: number | null;
  lastArrivalMinute: number | null;
};

type SeasonalStop = {
  stopClusterId: number;
  address: string;
  lat: number;
  lon: number;
  totalSales: number;
  visits: number;
  pastArrivalTime: string | null;
  salesNorm: number;
  visitsNorm: number;
  score: number;
  expectedPerVisit: number;
};

type SeasonalRouteCluster = {
  id: number;
  dow: string;
  centroidLat: number;
  centroidLong: number;
  totalSalesAmount: number;
  expectedDailyRevenue: number;
  stops: SeasonalStop[];
};

type OrderedStop = SeasonalStop;

type OrderedRouteResult = {
  routeClusterId: number;
  routeClusterName: string;
  day: string;
  centroid: [number, number];
  color: string;
  expectedDailyRevenue: number;
  orderedStops: OrderedStop[];
};

async function getActivePipelineRunId() {
  // CL For local pipeline testing, do not remove
  const override = process.env.PIPELINE_RUN_ID_OVERRIDE;

  if (override) {
    let parsed: bigint;
    try {
      parsed = BigInt(override);
    } catch {
      throw new Error("PIPELINE_RUN_ID_OVERRIDE must be a positive integer.");
    }

    if (parsed <= 0n) {
      throw new Error("PIPELINE_RUN_ID_OVERRIDE must be a positive integer.");
    }

    return parsed;
  }

  const activeRun = await prisma.pipelineRun.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true },
    orderBy: [{ activatedAt: "desc" }, { id: "desc" }]
  });

  if (!activeRun) {
    throw new Error("No ACTIVE pipeline run found.");
  }

  return activeRun.id;
}

export async function getDays(): Promise<DayOption[]> {
  const activePipelineRunId = await getActivePipelineRunId();
  const rows = await prisma.routeCluster.findMany({
    where: { pipelineRunId: activePipelineRunId },
    distinct: ["dow"],
    select: {
      dow: true
    }
  });

  return sortDays(rows.map((row) => row.dow)).map((day) => ({
    value: day,
    label: day
  }));
}

export async function getMonths(): Promise<MonthOption[]> {
  const activePipelineRunId = await getActivePipelineRunId();
  const rows = await prisma.$queryRaw<Array<{ month: number }>>(Prisma.sql`
    SELECT DISTINCT EXTRACT(MONTH FROM created_at)::int AS month
    FROM sale_stops
    WHERE pipeline_run_id = ${activePipelineRunId}
    ORDER BY month
  `);

  return rows.map((row) => ({
    value: row.month,
    label: new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2000, row.month - 1, 1))
  }));
}

export async function getRouteClusterOptions(
  day: string,
  months: number[],
  routeClusterLimit = DEFAULT_ROUTE_CLUSTER_LIMIT,
  dateRange?: DateRange
): Promise<RouteClusterOption[]> {
  const clusters = await getSeasonalRouteClustersForDay(day, months, routeClusterLimit, dateRange);
  const routeNameMap = buildRouteClusterNameMap(clusters);

  return clusters
    .map((cluster) => ({
      id: cluster.id,
      label: routeNameMap.get(cluster.id) ?? `Route Cluster ${cluster.id}`,
      stopCount: cluster.stops.length
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

export async function getRouteSummaries(
  day: string,
  months: number[],
  topStops: number,
  routeClusterLimit = DEFAULT_ROUTE_CLUSTER_LIMIT,
  dateRange?: DateRange
): Promise<RouteSummaryDto[]> {
  const clusters = await getSeasonalRouteClustersForDay(day, months, routeClusterLimit, dateRange);
  const colorMap = buildDayRouteColorMap(clusters.map((cluster) => cluster.id));
  const routeNameMap = buildRouteClusterNameMap(clusters);

  return clusters
    .map((cluster) => toOrderedRoute(cluster, colorMap, routeNameMap, topStops))
    .filter((cluster): cluster is OrderedRouteResult => cluster !== null)
    .map((cluster) => toRouteSummary(cluster));
}

export async function getRouteDetail(
  day: string,
  months: number[],
  routeClusterId: number,
  topStops: number,
  routeClusterLimit = DEFAULT_ROUTE_CLUSTER_LIMIT,
  dateRange?: DateRange
): Promise<RouteDetailDto | null> {
  const dayClusters = await getSeasonalRouteClustersForDay(day, months, routeClusterLimit, dateRange);
  const colorMap = buildDayRouteColorMap(dayClusters.map((cluster) => cluster.id));
  const routeNameMap = buildRouteClusterNameMap(dayClusters);
  const cluster = dayClusters.find((item) => item.id === routeClusterId) ?? null;
  const ordered = cluster ? toOrderedRoute(cluster, colorMap, routeNameMap, topStops) : null;

  if (!ordered) {
    return null;
  }

  return toRouteDetail(ordered, colorMap, routeNameMap);
}

// --- Module-level memo cache for getSeasonalRouteClustersForDay results ---
// Keyed by (activePipelineRunId, day, sorted months, from, to, routeClusterLimit).
// TTL 120s (data updates ~daily via pipeline, so slight staleness is fine).
// Hand-rolled Map with insertion-order eviction — no external deps.
const SEASONAL_CLUSTERS_CACHE_TTL_MS = 120_000;
const SEASONAL_CLUSTERS_CACHE_MAX_ENTRIES = 50;

type SeasonalClustersCacheEntry = {
  value: SeasonalRouteCluster[];
  expiresAt: number;
};

const seasonalClustersCache = new Map<string, SeasonalClustersCacheEntry>();

function buildSeasonalClustersCacheKey(
  activePipelineRunId: bigint,
  day: string,
  months: number[],
  routeClusterLimit: number,
  dateRange: DateRange | undefined
): string {
  const sortedMonths = [...months].sort((left, right) => left - right);
  return JSON.stringify({
    pipelineRunId: activePipelineRunId.toString(),
    day,
    months: sortedMonths,
    from: dateRange?.from ?? null,
    to: dateRange?.to ?? null,
    routeClusterLimit
  });
}

function getFromSeasonalClustersCache(key: string): SeasonalRouteCluster[] | undefined {
  const entry = seasonalClustersCache.get(key);
  if (!entry) {
    return undefined;
  }

  if (Date.now() >= entry.expiresAt) {
    seasonalClustersCache.delete(key);
    return undefined;
  }

  return entry.value;
}

function setInSeasonalClustersCache(key: string, value: SeasonalRouteCluster[]): void {
  // Evict the oldest entry (Map preserves insertion order) if at capacity.
  if (seasonalClustersCache.size >= SEASONAL_CLUSTERS_CACHE_MAX_ENTRIES && !seasonalClustersCache.has(key)) {
    const oldestKey = seasonalClustersCache.keys().next().value;
    if (oldestKey !== undefined) {
      seasonalClustersCache.delete(oldestKey);
    }
  }

  seasonalClustersCache.set(key, { value, expiresAt: Date.now() + SEASONAL_CLUSTERS_CACHE_TTL_MS });
}

async function getSeasonalRouteClustersForDay(
  day: string,
  months: number[],
  routeClusterLimit: number,
  dateRange?: DateRange
) {
  const activePipelineRunId = await getActivePipelineRunId();
  const cacheKey = buildSeasonalClustersCacheKey(activePipelineRunId, day, months, routeClusterLimit, dateRange);
  const cached = getFromSeasonalClustersCache(cacheKey);
  if (cached) {
    return cached;
  }

  const routeClusters = await prisma.routeCluster.findMany({
    where: {
      pipelineRunId: activePipelineRunId,
      dow: day
    },
    select: {
      id: true,
      dow: true,
      centroidLat: true,
      centroidLong: true
    }
  });

  if (routeClusters.length === 0) {
    setInSeasonalClustersCache(cacheKey, []);
    return [];
  }

  const seasonalStopRows = await getSeasonalStopRows(activePipelineRunId, day, months, dateRange);
  const pooledMeanPerVisit = await getPooledMeanPerVisit(activePipelineRunId, months, dateRange);
  const seasonalRowsByRoute = new Map<number, SeasonalStopRow[]>();
  for (const row of seasonalStopRows) {
    const bucket = seasonalRowsByRoute.get(row.routeClusterId) ?? [];
    bucket.push(row);
    seasonalRowsByRoute.set(row.routeClusterId, bucket);
  }

  const rankedClusters = routeClusters
    .map((routeCluster) =>
      toSeasonalRouteCluster(routeCluster, seasonalRowsByRoute.get(routeCluster.id) ?? [], pooledMeanPerVisit)
    )
    .filter((cluster): cluster is SeasonalRouteCluster => cluster !== null)
    .sort((left, right) => {
      if (right.totalSalesAmount !== left.totalSalesAmount) {
        return right.totalSalesAmount - left.totalSalesAmount;
      }

      return left.id - right.id;
    });

  const persistentRouteClusterIds = new Set(await getPersistentRouteClusterIds());
  const visibleClusters = selectVisibleRouteClusters(rankedClusters, routeClusterLimit, persistentRouteClusterIds);
  setInSeasonalClustersCache(cacheKey, visibleClusters);
  return visibleClusters;
}

function selectVisibleRouteClusters(
  rankedClusters: SeasonalRouteCluster[],
  routeClusterLimit: number,
  persistentRouteClusterIds: Set<number>
) {
  const selectedRouteClusterIds = new Set<number>();

  for (const cluster of rankedClusters) {
    if (persistentRouteClusterIds.has(cluster.id)) {
      selectedRouteClusterIds.add(cluster.id);
    }
  }

  let selectedRegularRouteCount = 0;
  for (const cluster of rankedClusters) {
    if (selectedRegularRouteCount >= routeClusterLimit) {
      break;
    }

    if (!persistentRouteClusterIds.has(cluster.id)) {
      selectedRouteClusterIds.add(cluster.id);
      selectedRegularRouteCount += 1;
    }
  }

  return rankedClusters.filter((cluster) => selectedRouteClusterIds.has(cluster.id));
}

async function getSeasonalStopRows(
  activePipelineRunId: bigint,
  day: string,
  months: number[],
  dateRange?: DateRange
) {
  const dateFilter = dateRange
    ? Prisma.sql`ss.created_at >= ${dateRange.from}::date AND ss.created_at < (${dateRange.to}::date + interval '1 day')`
    : Prisma.sql`EXTRACT(MONTH FROM ss.created_at)::int IN (${Prisma.join(months)})`;

  return prisma.$queryRaw<SeasonalStopRow[]>(Prisma.sql`
    SELECT
      ss.route_cluster_id AS "routeClusterId",
      ss.stop_cluster_id AS "stopClusterId",
      sc.address AS address,
      sc.centroid_lat AS "stopLat",
      sc.centroid_long AS "stopLon",
      COALESCE(SUM(ss.amount), 0)::double precision AS "totalSales",
      COUNT(DISTINCT (ss.created_at::date, ss.truck_number))::int AS visits,
      MIN(
        EXTRACT(HOUR FROM ss.created_at AT TIME ZONE 'America/Los_Angeles')::int * 60 +
        EXTRACT(MINUTE FROM ss.created_at AT TIME ZONE 'America/Los_Angeles')::int
      )::int AS "firstArrivalMinute",
      MAX(
        EXTRACT(HOUR FROM ss.created_at AT TIME ZONE 'America/Los_Angeles')::int * 60 +
        EXTRACT(MINUTE FROM ss.created_at AT TIME ZONE 'America/Los_Angeles')::int
      )::int AS "lastArrivalMinute"
    FROM sale_stops ss
    JOIN route_clusters rc
      ON rc.route_cluster_id = ss.route_cluster_id
     AND rc.pipeline_run_id = ss.pipeline_run_id
    JOIN stop_clusters sc
      ON sc.stop_cluster_id = ss.stop_cluster_id
    WHERE ss.pipeline_run_id = ${activePipelineRunId}
      AND rc.dow = ${day}
      AND ${dateFilter}
    GROUP BY
      ss.route_cluster_id,
      ss.stop_cluster_id,
      sc.address,
      sc.centroid_lat,
      sc.centroid_long
  `);
}

// Pooled mean $/visit across ALL stops (same day/month scope as the stop rows).
// A "visit" = one (stop, date, truck) — a stop-visit usually contains multiple
// line-item sales, so this lands ~$35-45, not the ~$9 raw per-sale average.
// Used as the shrinkage prior for per-stop expected-$-per-visit.
async function getPooledMeanPerVisit(
  activePipelineRunId: bigint,
  months: number[],
  dateRange?: DateRange
): Promise<number> {
  const dateFilter = dateRange
    ? Prisma.sql`ss.created_at >= ${dateRange.from}::date AND ss.created_at < (${dateRange.to}::date + interval '1 day')`
    : Prisma.sql`EXTRACT(MONTH FROM ss.created_at)::int IN (${Prisma.join(months)})`;

  const rows = await prisma.$queryRaw<Array<{ mu: number | null }>>(Prisma.sql`
    WITH visits AS (
      SELECT SUM(ss.amount) AS visit_amount
      FROM sale_stops ss
      WHERE ss.pipeline_run_id = ${activePipelineRunId}
        AND ${dateFilter}
      GROUP BY ss.stop_cluster_id, ss.created_at::date, ss.truck_number
    )
    SELECT (SUM(visit_amount) / NULLIF(COUNT(*), 0))::double precision AS mu
    FROM visits
  `);

  return rows[0]?.mu ?? 0;
}

// Shrinkage prior weight for expected-$-per-visit (Bayesian shrinkage toward the
// pooled mean): expected = (total_sales + K*mu) / (visits + K). Validated against
// the live DB 2026-07-06 (see research/andrew_interview + ROUTE_REVENUE_METRICS.md):
// keeps low-visit stops from dominating on noise.
const SHRINKAGE_PRIOR_VISITS = 3;
// Stops counted toward a route's expected daily revenue. Matches observed
// ~25-33 stops actually run per truck-day. Selected by VISIT FREQUENCY (stops
// historically on the route), NOT by $ metric — selecting by the same metric
// being summed cherry-picks noisy overperformers and inflates totals ~2x.
const EXPECTED_REVENUE_STOP_COUNT = 30;

function toSeasonalRouteCluster(
  routeCluster: RouteClusterRecord,
  stopRows: SeasonalStopRow[],
  pooledMeanPerVisit: number
): SeasonalRouteCluster | null {
  if (stopRows.length === 0) {
    return null;
  }

  const maxSales = Math.max(...stopRows.map((row) => row.totalSales), 0);
  const maxVisits = Math.max(...stopRows.map((row) => row.visits), 0);
  const stops = stopRows.map((row) => ({
    stopClusterId: row.stopClusterId,
    address: row.address ?? "Unknown address",
    lat: row.stopLat,
    lon: row.stopLon,
    totalSales: row.totalSales,
    visits: row.visits,
    pastArrivalTime: buildPastArrivalTime(row),
    salesNorm: maxSales > 0 ? row.totalSales / maxSales : 0,
    visitsNorm: maxVisits > 0 ? row.visits / maxVisits : 0,
    score: (maxSales > 0 ? (row.totalSales / maxSales) * 1000 : 0) + (maxVisits > 0 ? row.visits / maxVisits : 0),
    expectedPerVisit:
      (row.totalSales + SHRINKAGE_PRIOR_VISITS * pooledMeanPerVisit) /
      (row.visits + SHRINKAGE_PRIOR_VISITS)
  }));

  const expectedDailyRevenue = stops
    .slice()
    .sort((left, right) => right.visits - left.visits)
    .slice(0, EXPECTED_REVENUE_STOP_COUNT)
    .reduce((sum, stop) => sum + stop.expectedPerVisit, 0);

  return {
    id: routeCluster.id,
    dow: routeCluster.dow,
    centroidLat: routeCluster.centroidLat,
    centroidLong: routeCluster.centroidLong,
    totalSalesAmount: stops.reduce((sum, stop) => sum + stop.totalSales, 0),
    expectedDailyRevenue,
    stops
  };
}

function toOrderedRoute(
  cluster: SeasonalRouteCluster,
  colorMap: Map<number, string>,
  routeNameMap: Map<number, string>,
  topStops: number
): OrderedRouteResult | null {
  const candidateStops = cluster.stops
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, topStops);

  if (candidateStops.length === 0) {
    return null;
  }

  return {
    routeClusterId: cluster.id,
    routeClusterName: routeNameMap.get(cluster.id) ?? `Route Cluster ${cluster.id}`,
    day: cluster.dow,
    centroid: [cluster.centroidLat, cluster.centroidLong],
    color: colorMap.get(cluster.id) ?? "#1f77b4",
    expectedDailyRevenue: cluster.expectedDailyRevenue,
    orderedStops: orderStopsByDistance(candidateStops, [cluster.centroidLat, cluster.centroidLong])
  };
}

function orderStopsByDistance(stops: OrderedStop[], centroid: [number, number]) {
  const remaining = [...stops];
  const farthestIndex = remaining.reduce((bestIndex, stop, index, source) => {
    const bestDistance = pointDistanceMeters(
      centroid[0],
      centroid[1],
      source[bestIndex].lat,
      source[bestIndex].lon
    );
    const currentDistance = pointDistanceMeters(centroid[0], centroid[1], stop.lat, stop.lon);
    return currentDistance > bestDistance ? index : bestIndex;
  }, 0);

  const ordered: OrderedStop[] = [remaining.splice(farthestIndex, 1)[0]];

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    const nextIndex = remaining.reduce((bestIndex, stop, index, source) => {
      const bestDistance = pointDistanceMeters(
        current.lat,
        current.lon,
        source[bestIndex].lat,
        source[bestIndex].lon
      );
      const currentDistance = pointDistanceMeters(current.lat, current.lon, stop.lat, stop.lon);
      return currentDistance < bestDistance ? index : bestIndex;
    }, 0);

    ordered.push(remaining.splice(nextIndex, 1)[0]);
  }

  return ordered;
}

function toRouteSummary(route: OrderedRouteResult): RouteSummaryDto {
  const polyline = route.orderedStops.map((stop) => [stop.lat, stop.lon] as [number, number]);

  return {
    routeClusterId: route.routeClusterId,
    routeClusterName: route.routeClusterName,
    day: route.day,
    color: route.color,
    bounds: calculateBounds(polyline),
    polyline,
    centroid: route.centroid,
    stopCount: route.orderedStops.length,
    predictedSalesTotal: route.orderedStops.reduce((sum, stop) => sum + stop.score, 0),
    totalSalesAmount: route.orderedStops.reduce((sum, stop) => sum + stop.totalSales, 0),
    expectedDailyRevenue: route.expectedDailyRevenue,
    stops: route.orderedStops.map((stop) => ({
      stopClusterId: stop.stopClusterId,
      lat: stop.lat,
      lon: stop.lon
    }))
  };
}

function toRouteDetail(
  route: OrderedRouteResult,
  colorMap: Map<number, string>,
  routeNameMap: Map<number, string>
): RouteDetailDto {
  const polyline = route.orderedStops.map((stop) => [stop.lat, stop.lon] as [number, number]);

  return {
    routeClusterId: route.routeClusterId,
    routeClusterName: routeNameMap.get(route.routeClusterId) ?? route.routeClusterName,
    day: route.day,
    title: buildRouteTitle(route.day, route.routeClusterName),
    color: colorMap.get(route.routeClusterId) ?? route.color,
    bounds: calculateBounds(polyline),
    polyline,
    predictedSalesTotal: route.orderedStops.reduce((sum, stop) => sum + stop.score, 0),
    totalSalesAmount: route.orderedStops.reduce((sum, stop) => sum + stop.totalSales, 0),
    expectedDailyRevenue: route.expectedDailyRevenue,
    stops: route.orderedStops.map((stop, index) => ({
      stopClusterId: stop.stopClusterId,
      visitOrder: index + 1,
      address: stop.address,
      lat: stop.lat,
      lon: stop.lon,
      stopType: null,
      label: null,
      pastSalesPerDaySameDow: stop.totalSales,
      pastArrivalTime: stop.pastArrivalTime,
      averageSale: stop.visits > 0 ? stop.totalSales / stop.visits : null,
      expectedPerVisit: stop.expectedPerVisit,
      otherDowAvgSalesPerDay: stop.visitsNorm,
      predictedSalesPerDay: stop.score,
      salesMatchesWithin50m: stop.visits
    }))
  };
}

function buildPastArrivalTime({
  visits,
  firstArrivalMinute,
  lastArrivalMinute
}: Pick<SeasonalStopRow, "visits" | "firstArrivalMinute" | "lastArrivalMinute">) {
  if (firstArrivalMinute == null) {
    return null;
  }

  const firstArrivalTime = formatClockMinute(firstArrivalMinute);

  if (visits <= 1 || lastArrivalMinute == null || firstArrivalMinute === lastArrivalMinute) {
    return firstArrivalTime;
  }

  return `${firstArrivalTime} - ${formatClockMinute(lastArrivalMinute)}`;
}

function formatClockMinute(totalMinutes: number) {
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const hour12 = hours % 12 || 12;
  const suffix = hours >= 12 ? "PM" : "AM";

  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function buildRouteClusterNameMap(clusters: SeasonalRouteCluster[]) {
  const baseNames = clusters.map((cluster) => {
    const topScoringStop = [...cluster.stops].sort((left, right) => right.score - left.score)[0];
    const city = extractCityFromAddress(topScoringStop?.address) ?? "Unknown";

    return {
      routeClusterId: cluster.id,
      city
    };
  });

  const cityCounts = new Map<string, number>();
  for (const item of baseNames) {
    cityCounts.set(item.city, (cityCounts.get(item.city) ?? 0) + 1);
  }

  const cityIndexes = new Map<string, number>();
  return new Map(
    baseNames
      .sort((left, right) => left.routeClusterId - right.routeClusterId)
      .map((item) => {
        const totalForCity = cityCounts.get(item.city) ?? 0;
        const nextIndex = (cityIndexes.get(item.city) ?? 0) + 1;
        cityIndexes.set(item.city, nextIndex);

        const suffix = totalForCity > 1 ? ` - ${nextIndex}` : "";
        return [item.routeClusterId, `${item.city}${suffix} ID: ${item.routeClusterId}`];
      })
  );
}

function extractCityFromAddress(address: string | null | undefined) {
  if (!address) {
    return null;
  }

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const countyIndex = parts.findIndex((part) => /\bcounty\b/i.test(part));
  if (countyIndex > 0) {
    return parts[countyIndex - 1];
  }

  const stateIndex = parts.findIndex((part) => US_STATE_NAMES.has(part.toLowerCase()));
  if (stateIndex > 0) {
    return parts[stateIndex - 1];
  }

  const countryIndex = parts.findIndex((part) => /united states/i.test(part));
  if (countryIndex > 1) {
    return parts[countryIndex - 2];
  }

  return parts.at(-3) ?? parts.at(-2) ?? parts.at(-1) ?? null;
}

const US_STATE_NAMES = new Set([
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming"
]);

function pointDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}
