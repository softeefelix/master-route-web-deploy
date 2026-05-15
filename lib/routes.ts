import { Prisma } from "@prisma/client";
import { DEFAULT_ROUTE_CLUSTER_LIMIT } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { buildDayRouteColorMap, buildRouteTitle, calculateBounds, sortDays } from "@/lib/utils";
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
};

type SeasonalStop = {
  stopClusterId: number;
  address: string;
  lat: number;
  lon: number;
  totalSales: number;
  visits: number;
  salesNorm: number;
  visitsNorm: number;
  score: number;
};

type SeasonalRouteCluster = {
  id: number;
  dow: string;
  centroidLat: number;
  centroidLong: number;
  totalSalesAmount: number;
  stops: SeasonalStop[];
};

type OrderedStop = SeasonalStop;

type OrderedRouteResult = {
  routeClusterId: number;
  routeClusterName: string;
  day: string;
  centroid: [number, number];
  color: string;
  orderedStops: OrderedStop[];
};

async function getActivePipelineRunId() {
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
  routeClusterLimit = DEFAULT_ROUTE_CLUSTER_LIMIT
): Promise<RouteClusterOption[]> {
  const clusters = await getSeasonalRouteClustersForDay(day, months, routeClusterLimit);
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
  routeClusterLimit = DEFAULT_ROUTE_CLUSTER_LIMIT
): Promise<RouteSummaryDto[]> {
  const clusters = await getSeasonalRouteClustersForDay(day, months, routeClusterLimit);
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
  routeClusterLimit = DEFAULT_ROUTE_CLUSTER_LIMIT
): Promise<RouteDetailDto | null> {
  const dayClusters = await getSeasonalRouteClustersForDay(day, months, routeClusterLimit);
  const colorMap = buildDayRouteColorMap(dayClusters.map((cluster) => cluster.id));
  const routeNameMap = buildRouteClusterNameMap(dayClusters);
  const cluster = dayClusters.find((item) => item.id === routeClusterId) ?? null;
  const ordered = cluster ? toOrderedRoute(cluster, colorMap, routeNameMap, topStops) : null;

  if (!ordered) {
    return null;
  }

  return toRouteDetail(ordered, colorMap, routeNameMap);
}

async function getSeasonalRouteClustersForDay(
  day: string,
  months: number[],
  routeClusterLimit: number
) {
  const activePipelineRunId = await getActivePipelineRunId();
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
    return [];
  }

  const seasonalStopRows = await getSeasonalStopRows(activePipelineRunId, day, months);
  const seasonalRowsByRoute = new Map<number, SeasonalStopRow[]>();
  for (const row of seasonalStopRows) {
    const bucket = seasonalRowsByRoute.get(row.routeClusterId) ?? [];
    bucket.push(row);
    seasonalRowsByRoute.set(row.routeClusterId, bucket);
  }

  return routeClusters
    .map((routeCluster) => toSeasonalRouteCluster(routeCluster, seasonalRowsByRoute.get(routeCluster.id) ?? []))
    .filter((cluster): cluster is SeasonalRouteCluster => cluster !== null)
    .sort((left, right) => {
      if (right.totalSalesAmount !== left.totalSalesAmount) {
        return right.totalSalesAmount - left.totalSalesAmount;
      }

      return left.id - right.id;
    })
    .slice(0, routeClusterLimit);
}

async function getSeasonalStopRows(activePipelineRunId: bigint, day: string, months: number[]) {
  return prisma.$queryRaw<SeasonalStopRow[]>(Prisma.sql`
    SELECT
      ss.route_cluster_id AS "routeClusterId",
      ss.stop_cluster_id AS "stopClusterId",
      sc.address AS address,
      sc.centroid_lat AS "stopLat",
      sc.centroid_long AS "stopLon",
      COALESCE(SUM(ss.amount), 0)::double precision AS "totalSales",
      COUNT(DISTINCT (ss.created_at::date, ss.truck_number))::int AS visits
    FROM sale_stops ss
    JOIN route_clusters rc
      ON rc.route_cluster_id = ss.route_cluster_id
     AND rc.pipeline_run_id = ss.pipeline_run_id
    JOIN stop_clusters sc
      ON sc.stop_cluster_id = ss.stop_cluster_id
    WHERE ss.pipeline_run_id = ${activePipelineRunId}
      AND rc.dow = ${day}
      AND EXTRACT(MONTH FROM ss.created_at)::int IN (${Prisma.join(months)})
    GROUP BY
      ss.route_cluster_id,
      ss.stop_cluster_id,
      sc.address,
      sc.centroid_lat,
      sc.centroid_long
  `);
}

function toSeasonalRouteCluster(
  routeCluster: RouteClusterRecord,
  stopRows: SeasonalStopRow[]
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
    salesNorm: maxSales > 0 ? row.totalSales / maxSales : 0,
    visitsNorm: maxVisits > 0 ? row.visits / maxVisits : 0,
    score: (maxSales > 0 ? (row.totalSales / maxSales) * 1000 : 0) + (maxVisits > 0 ? row.visits / maxVisits : 0)
  }));

  return {
    id: routeCluster.id,
    dow: routeCluster.dow,
    centroidLat: routeCluster.centroidLat,
    centroidLong: routeCluster.centroidLong,
    totalSalesAmount: stops.reduce((sum, stop) => sum + stop.totalSales, 0),
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
    totalAverageSaleAmount: route.orderedStops.reduce(
      (sum, stop) => sum + (stop.visits > 0 ? stop.totalSales / stop.visits : 0),
      0
    ),
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
    totalAverageSaleAmount: route.orderedStops.reduce(
      (sum, stop) => sum + (stop.visits > 0 ? stop.totalSales / stop.visits : 0),
      0
    ),
    stops: route.orderedStops.map((stop, index) => ({
      stopClusterId: stop.stopClusterId,
      visitOrder: index + 1,
      address: stop.address,
      lat: stop.lat,
      lon: stop.lon,
      stopType: null,
      label: null,
      pastSalesPerDaySameDow: stop.totalSales,
      averageSale: stop.visits > 0 ? stop.totalSales / stop.visits : null,
      otherDowAvgSalesPerDay: stop.visitsNorm,
      predictedSalesPerDay: stop.score,
      salesMatchesWithin50m: stop.visits
    }))
  };
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
        return [item.routeClusterId, `${item.city}${suffix} ${item.routeClusterId}`];
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
