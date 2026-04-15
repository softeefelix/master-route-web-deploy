export type DayOption = {
  value: string;
  label: string;
};

export type RouteClusterOption = {
  id: number;
  label: string;
  stopCount: number;
};

export type RouteStopDto = {
  stopClusterId: number;
  visitOrder: number;
  address: string;
  lat: number;
  lon: number;
  stopType: string | null;
  label: string | null;
  pastSalesPerDaySameDow: number | null;
  otherDowAvgSalesPerDay: number | null;
  predictedSalesPerDay: number | null;
  salesMatchesWithin50m: number | null;
};

export type RouteSummaryStopDto = {
  stopClusterId: number;
  lat: number;
  lon: number;
};

export type RouteSummaryDto = {
  routeClusterId: number;
  routeClusterName: string;
  day: string;
  color: string;
  bounds: [[number, number], [number, number]];
  polyline: Array<[number, number]>;
  centroid: [number, number];
  stopCount: number;
  predictedSalesTotal: number;
  totalSalesAmount: number;
  stops: RouteSummaryStopDto[];
};

export type RouteDetailDto = {
  routeClusterId: number;
  routeClusterName: string;
  day: string;
  title: string;
  color: string;
  bounds: [[number, number], [number, number]];
  polyline: Array<[number, number]>;
  stops: RouteStopDto[];
  predictedSalesTotal: number;
  totalSalesAmount: number;
};
