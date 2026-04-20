import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildDayRouteColorMap, buildRouteTitle, calculateBounds, sortDays } from "@/lib/utils";
import type { DayOption, RouteClusterOption, RouteDetailDto, RouteSummaryDto } from "@/types/routes";

type StopScoreWithRelations = Prisma.StopScoreGetPayload<{
  include: {
    stopCluster: true;
  };
}>;

type RouteClusterWithStops = Prisma.RouteClusterGetPayload<{
  include: {
    stopScores: {
      include: {
        stopCluster: true;
      };
    };
  };
}>;

export async function getDays(): Promise<DayOption[]> {
  const rows = await prisma.routeCluster.findMany({
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

export async function getRouteClusterOptions(day: string): Promise<RouteClusterOption[]> {
  const clusters = await getTopRouteClustersForDay(day);

  const routeNameMap = buildRouteClusterNameMap(clusters);

  return clusters
    .map((cluster) => ({
      id: cluster.id,
      label: routeNameMap.get(cluster.id) ?? `Route Cluster ${cluster.id}`,
      stopCount: cluster._count.stopScores
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

export async function getRouteSummaries(day: string, topStops: number): Promise<RouteSummaryDto[]> {
  const clusters = await getTopRouteClustersForDay(day);

  const colorMap = buildDayRouteColorMap(clusters.map((cluster) => cluster.id));
  const routeNameMap = buildRouteClusterNameMap(clusters);

  return clusters
    .map((cluster) => toOrderedRoute(cluster, colorMap, routeNameMap, topStops))
    .filter((cluster): cluster is OrderedRouteResult => cluster !== null)
    .map((cluster) => toRouteSummary(cluster));
}

export async function getRouteDetail(day: string, routeClusterId: number, topStops: number): Promise<RouteDetailDto | null> {
  const dayClusters = await getTopRouteClustersForDay(day);
  const colorMap = buildDayRouteColorMap(dayClusters.map((cluster) => cluster.id));
  const routeNameMap = buildRouteClusterNameMap(dayClusters);

  const cluster = dayClusters.find((item) => item.id === routeClusterId) ?? null;

  const ordered = cluster ? toOrderedRoute(cluster, colorMap, routeNameMap, topStops) : null;
  if (!ordered) {
    return null;
  }

  return toRouteDetail(ordered, colorMap, routeNameMap);
}

async function getTopRouteClustersForDay(day: string) {
  const clusters = await prisma.routeCluster.findMany({
    where: { dow: day },
    include: {
      stopScores: {
        include: {
          stopCluster: true
        }
      },
      _count: {
        select: {
          stopScores: true
        }
      }
    }
  });

  return clusters
    .map((cluster) => ({
      ...cluster,
      totalSalesAmount: cluster.stopScores.reduce((sum, stop) => sum + stop.totalSales, 0)
    }))
    .sort((left, right) => {
      if (right.totalSalesAmount !== left.totalSalesAmount) {
        return right.totalSalesAmount - left.totalSalesAmount;
      }

      return left.id - right.id;
    })
    .slice(0, 17);
}

type OrderedStop = {
  stopClusterId: number;
  address: string;
  lat: number;
  lon: number;
  totalSales: number;
  visits: number;
  salesNorm: number | null;
  visitsNorm: number | null;
  score: number | null;
};

type OrderedRouteResult = {
  routeClusterId: number;
  routeClusterName: string;
  day: string;
  centroid: [number, number];
  color: string;
  orderedStops: OrderedStop[];
};

function toOrderedRoute(
  cluster: RouteClusterWithStops,
  colorMap: Map<number, string>,
  routeNameMap: Map<number, string>,
  topStops: number
): OrderedRouteResult | null {
  const candidateStops = cluster.stopScores
    .filter((stopScore) => stopScore.stopCluster)
    .sort((left, right) => (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY))
    .slice(0, topStops)
    .map((stopScore) => toOrderedStop(stopScore));

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

function toOrderedStop(stopScore: StopScoreWithRelations): OrderedStop {
  return {
    stopClusterId: stopScore.stopClusterId,
    address: stopScore.stopCluster.address ?? "Unknown address",
    lat: stopScore.stopCluster.centroidLat,
    lon: stopScore.stopCluster.centroidLong,
    totalSales: stopScore.totalSales,
    visits: stopScore.visits,
    salesNorm: stopScore.salesNorm,
    visitsNorm: stopScore.visitsNorm,
    score: stopScore.score
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
    predictedSalesTotal: route.orderedStops.reduce((sum, stop) => sum + (stop.score ?? 0), 0),
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
    predictedSalesTotal: route.orderedStops.reduce((sum, stop) => sum + (stop.score ?? 0), 0),
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

function buildRouteClusterNameMap(clusters: RouteClusterWithStops[]) {
  const baseNames = clusters.map((cluster) => {
    const topScoringStop = [...cluster.stopScores]
      .filter((stopScore) => stopScore.stopCluster)
      .sort((left, right) => (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY))[0];
    const city = extractCityFromAddress(topScoringStop?.stopCluster.address) ?? "Unknown";

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
