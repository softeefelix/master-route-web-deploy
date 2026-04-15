import { DAY_ORDER, ROUTE_COLORS } from "@/lib/constants";

export function sortDays(days: string[]) {
  return [...days].sort(
    (a, b) => DAY_ORDER.indexOf(a as (typeof DAY_ORDER)[number]) - DAY_ORDER.indexOf(b as (typeof DAY_ORDER)[number])
  );
}

export function getRouteColor(colorIndex: number) {
  if (colorIndex < ROUTE_COLORS.length) {
    return ROUTE_COLORS[colorIndex];
  }

  const hue = (colorIndex * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 68% 46%)`;
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

export function formatScore(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

export function calculateBounds(points: Array<[number, number]>): [[number, number], [number, number]] {
  const lats = points.map(([lat]) => lat);
  const lons = points.map(([, lon]) => lon);

  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)]
  ];
}

export function buildRouteTitle(day: string, routeClusterName: string) {
  return `Addresses in order — ${day} / ${routeClusterName}`;
}

export function buildDayRouteColorMap(routeClusterIds: number[]) {
  const uniqueSortedIds = [...new Set(routeClusterIds)].sort((left, right) => left - right);
  return new Map(uniqueSortedIds.map((routeClusterId, index) => [routeClusterId, getRouteColor(index)]));
}
