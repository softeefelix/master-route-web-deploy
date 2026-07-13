"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Popup,
  Polyline,
  TileLayer,
  Tooltip,
  useMap
} from "react-leaflet";
import L from "leaflet";
import type { LeafletEventHandlerFnMap } from "leaflet";
import { formatCurrency, formatScore } from "@/lib/utils";
import type { RouteDetailDto, RouteSummaryDto } from "@/types/routes";

type RouteMapProps = {
  routeSummaries: RouteSummaryDto[];
  routeDetail: RouteDetailDto | null;
  selectedStopId: number | null;
  isLoading: boolean;
  onRouteSelect: (routeClusterId: number, stopClusterId?: number | null) => void;
  onStopSelect: (stopClusterId: number) => void;
};

const startIcon = L.divIcon({
  className: "route-pin-icon",
  html: '<div class="route-pin route-pin--start"><div class="route-pin__glyph">&#9654;</div></div>',
  iconSize: [34, 34],
  iconAnchor: [10, 30],
  popupAnchor: [8, -26]
});

const endIcon = L.divIcon({
  className: "route-pin-icon",
  html: '<div class="route-pin route-pin--end"><div class="route-pin__glyph">&#9873;</div></div>',
  iconSize: [34, 34],
  iconAnchor: [10, 30],
  popupAnchor: [8, -26]
});

// High-contrast ops colors (Andrew screen-scrapes maps for drivers — pale
// cyan on a light basemap washed out and hid street names).
const SELECTED_ROUTE_COLOR = "#0B5CAB";
const SELECTED_ROUTE_CASE = "#0A1628";
const TOP_STOP_PIN_COLOR = "#D35400";
/** Default basemap: Esri World Street — streets + labels stay readable at route zoom. */
const STREET_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const STREET_TILE_ATTR =
  "Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), OpenStreetMap contributors, and the GIS User Community";

function createNumberedRouteIcon(color: string, visitOrder: number, size = 34) {
  const label = String(visitOrder);
  const iconAnchorX = Math.round(size * 0.29);
  const iconAnchorY = Math.round(size * 0.88);
  const popupAnchorY = -Math.round(size * 0.76);
  return L.divIcon({
    className: "route-pin-icon",
    html: `<div class="route-pin route-pin--mid" style="--pin-color:${color}; --pin-glyph-size:${getVisitOrderFontSize(label)}px; width:${size}px; height:${size}px;"><div class="route-pin__glyph">${label}</div></div>`,
    iconSize: [size, size],
    iconAnchor: [iconAnchorX, iconAnchorY],
    popupAnchor: [8, popupAnchorY]
  });
}

function getVisitOrderFontSize(label: string) {
  if (label.length >= 3) {
    return 11;
  }

  if (label.length === 2) {
    return 13;
  }

  return 15;
}

export function RouteMap({
  routeSummaries,
  routeDetail,
  selectedStopId,
  isLoading,
  onRouteSelect,
  onStopSelect
}: RouteMapProps) {
  // MR46: when a timed master schedule exists, the map mirrors the print
  // sheet — scheduled stops get numbered pins in schedule order; unscheduled
  // candidate stops render as small grey markers (review material, not the
  // route). Legacy routes (no schedule) keep the old numbered rendering.
  const hasTimedSchedule = (routeDetail?.stops ?? []).some((stop) => stop.plannedArrive);
  const scheduledStops = hasTimedSchedule
    ? (routeDetail?.stops ?? []).filter((stop) => stop.plannedArrive)
    : (routeDetail?.stops ?? []);
  const lastScheduledStopId = scheduledStops.at(-1)?.stopClusterId ?? null;
  const firstScheduledStopId = scheduledStops[0]?.stopClusterId ?? null;

  const topScoringStopIds = new Set(
    scheduledStops
      .filter(
        (stop) =>
          stop.stopClusterId !== firstScheduledStopId && stop.stopClusterId !== lastScheduledStopId
      )
      .slice()
      .sort(
        (left, right) =>
          (right.predictedSalesPerDay ?? Number.NEGATIVE_INFINITY) -
          (left.predictedSalesPerDay ?? Number.NEGATIVE_INFINITY)
      )
      .slice(0, 5)
      .map((stop) => stop.stopClusterId)
  );

  const defaultCenter: L.LatLngExpression = routeDetail?.bounds
    ? [
        (routeDetail.bounds[0][0] + routeDetail.bounds[1][0]) / 2,
        (routeDetail.bounds[0][1] + routeDetail.bounds[1][1]) / 2
      ]
    : [37.58138, -122.14066];

  // Street-following path for the selected route (OSRM via /api/drive-path).
  // Popup/unselected routes still use straight polylines for perf.
  const scheduledWaypoints = useMemo(
    () => scheduledStops.map((s) => [s.lat, s.lon] as [number, number]),
    // Identity key: route + length + first/last so we don't re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      routeDetail?.routeClusterId,
      routeDetail?.day,
      scheduledStops.length,
      scheduledStops[0]?.stopClusterId,
      scheduledStops.at(-1)?.stopClusterId
    ]
  );
  const [roadPolyline, setRoadPolyline] = useState<[number, number][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoadPolyline(null);
    if (scheduledWaypoints.length < 2) return;

    void (async () => {
      try {
        const res = await fetch("/api/drive-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: scheduledWaypoints })
        });
        if (!res.ok) return;
        const data = (await res.json()) as { polyline?: [number, number][] };
        if (!cancelled && data.polyline && data.polyline.length >= 2) {
          setRoadPolyline(data.polyline);
        }
      } catch {
        // keep straight fallback
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scheduledWaypoints]);

  return (
    <div className="relative h-full w-full driver-map-contrast">
      <MapContainer
        center={defaultCenter}
        zoom={12}
        minZoom={10}
        maxZoom={19}
        scrollWheelZoom
        className="h-full w-full"
        preferCanvas
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
      >
        <TileLayer attribution={STREET_TILE_ATTR} url={STREET_TILE_URL} maxZoom={19} maxNativeZoom={19} />
        <Pane name="routes" style={{ zIndex: 350 }} />
        <Pane name="stops" style={{ zIndex: 450 }} />
        <FitToRoute routeDetail={routeDetail} selectedStopId={selectedStopId} />

        {routeSummaries.map((summary) => {
          const isSelectedRoute =
            routeDetail?.routeClusterId === summary.routeClusterId && routeDetail.day === summary.day;

          if (summary.polyline.length === 0) {
            return null;
          }

          const positions =
            isSelectedRoute && roadPolyline && roadPolyline.length >= 2
              ? roadPolyline
              : summary.polyline;

          return (
            <>
              {/* Dark casing under selected path so the line survives muted screenshots */}
              {isSelectedRoute ? (
                <Polyline
                  key={`${summary.day}-${summary.routeClusterId}-case`}
                  pathOptions={{
                    color: SELECTED_ROUTE_CASE,
                    weight: 10,
                    opacity: 0.9,
                    lineJoin: "round",
                    lineCap: "round"
                  }}
                  positions={positions}
                  pane="routes"
                  interactive={false}
                />
              ) : null}
              <Polyline
                key={`${summary.day}-${summary.routeClusterId}-line`}
                pathOptions={{
                  color: isSelectedRoute ? SELECTED_ROUTE_COLOR : summary.color,
                  weight: isSelectedRoute ? 6 : 3.5,
                  opacity: isSelectedRoute ? 1 : 0.55,
                  lineJoin: "round",
                  lineCap: "round"
                }}
                positions={positions}
                pane="routes"
                eventHandlers={{
                  click: () => onRouteSelect(summary.routeClusterId)
                }}
              >
                <Tooltip sticky className="route-tooltip">
                  {summary.day} {"\u2014"} {summary.routeClusterName}
                </Tooltip>
              </Polyline>
            </>
          );
        })}

        {routeSummaries.flatMap((summary) =>
          summary.stops.map((stop) => {
            const isSelectedRouteStop =
              routeDetail?.routeClusterId === summary.routeClusterId && routeDetail.day === summary.day;
            if (isSelectedRouteStop) {
              return null;
            }

            return (
              <CircleMarker
                key={`summary-${summary.routeClusterId}-${stop.stopClusterId}`}
                center={[stop.lat, stop.lon]}
                radius={5}
                pathOptions={{
                  color: summary.color,
                  fillColor: summary.color,
                  fillOpacity: 0.7,
                  opacity: 0.9,
                  weight: 1
                }}
                eventHandlers={{
                  click: () => onRouteSelect(summary.routeClusterId, stop.stopClusterId)
                }}
                pane="stops"
              />
            );
          })
        )}

        {routeDetail?.stops.map((stop, index) => {
          const isSelected = selectedStopId === stop.stopClusterId;
          const isCandidateStop = hasTimedSchedule && !stop.plannedArrive;
          const isBoundaryStop = hasTimedSchedule
            ? stop.stopClusterId === firstScheduledStopId || stop.stopClusterId === lastScheduledStopId
            : index === 0 || index === routeDetail.stops.length - 1;
          const popupContent = (
            <div className="space-y-1 text-sm text-ink">
              <div className="font-semibold">
                {routeDetail.day} {"\u2014"} {routeDetail.routeClusterName}
              </div>
              {isCandidateStop ? (
                <div className="font-semibold text-slate-500">
                  Candidate stop — scored top-{routeDetail.stops.length} but not in the timed schedule
                </div>
              ) : null}
              {stop.plannedArrive ? <div>Planned arrive: {stop.plannedArrive}</div> : null}
              <div>Stop cluster ID: {stop.stopClusterId}</div>
              <div>Past visits: {stop.salesMatchesWithin50m ?? "N/A"}</div>
              <div>Past total sales: {formatCurrency(stop.pastSalesPerDaySameDow)}</div>
              {stop.pastArrivalTime ? <div>Past arrival time: {stop.pastArrivalTime}</div> : null}
              <div>Expected $ per visit: {formatCurrency(stop.expectedPerVisit)}</div>
              <div>Average sale per visit: {formatCurrency(stop.averageSale)}</div>
              <div>Stop score: {formatScore(stop.predictedSalesPerDay)}</div>
              <div>Address: {stop.address}</div>
            </div>
          );

          if (isCandidateStop) {
            return (
              <CircleMarker
                key={stop.stopClusterId}
                center={[stop.lat, stop.lon]}
                radius={6}
                pathOptions={{
                  color: "#64748b",
                  fillColor: "#94a3b8",
                  fillOpacity: 0.75,
                  opacity: 0.9,
                  weight: 1.5,
                  dashArray: "2 2"
                }}
                eventHandlers={{
                  click: () => onStopSelect(stop.stopClusterId)
                }}
                pane="stops"
              >
                <Popup maxWidth={350}>{popupContent}</Popup>
              </CircleMarker>
            );
          }

          if (isBoundaryStop) {
            return (
              <SelectedStopMarker
                key={stop.stopClusterId}
                center={[stop.lat, stop.lon]}
                icon={index === 0 ? startIcon : endIcon}
                isOpen={isSelected}
                onClick={() => onStopSelect(stop.stopClusterId)}
                pane="stops"
              >
                {popupContent}
              </SelectedStopMarker>
            );
          }

          return (
            <SelectedStopMarker
              key={stop.stopClusterId}
              center={[stop.lat, stop.lon]}
              icon={
                topScoringStopIds.has(stop.stopClusterId)
                  ? createNumberedRouteIcon(TOP_STOP_PIN_COLOR, stop.visitOrder, 40)
                  : createNumberedRouteIcon(SELECTED_ROUTE_COLOR, stop.visitOrder)
              }
              isOpen={isSelected}
              onClick={() => onStopSelect(stop.stopClusterId)}
              pane="stops"
            >
              {popupContent}
            </SelectedStopMarker>
          );
        })}
      </MapContainer>

      {isLoading ? (
        <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-white/92 px-4 py-2 text-sm font-medium text-ink shadow-panel">
          Refreshing map...
        </div>
      ) : null}
    </div>
  );
}

function SelectedStopMarker({
  center,
  icon,
  isOpen,
  onClick,
  pane,
  children
}: {
  center: [number, number];
  icon: L.DivIcon;
  isOpen: boolean;
  onClick: () => void;
  pane: string;
  children: ReactNode;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) {
      return;
    }

    if (isOpen) {
      marker.openPopup();
    } else {
      marker.closePopup();
    }
  }, [isOpen]);

  const eventHandlers: LeafletEventHandlerFnMap = {
    click: () => {
      markerRef.current?.openPopup();
      onClick();
    }
  };

  return (
    <Marker ref={markerRef} position={center} icon={icon} eventHandlers={eventHandlers} pane={pane}>
      <Popup maxWidth={350}>{children}</Popup>
    </Marker>
  );
}


function FitToRoute({
  routeDetail,
  selectedStopId
}: {
  routeDetail: RouteDetailDto | null;
  selectedStopId: number | null;
}) {
  const map = useMap();
  const lastRouteKey = useRef<string>("");
  const selectedStop = routeDetail?.stops.find((stop) => stop.stopClusterId === selectedStopId);

  useEffect(() => {
    if (!routeDetail) {
      return;
    }

    const routeKey = `${routeDetail.day}-${routeDetail.routeClusterId}-${routeDetail.stops
      .map((stop) => stop.stopClusterId)
      .join("|")}`;
    if (routeKey === lastRouteKey.current) {
      return;
    }

    lastRouteKey.current = routeKey;
    // Prefer street-label zoom when a single route is selected (Andrew captures
    // chunks for drivers — names must still read when zoomed out slightly).
    map.fitBounds(routeDetail.bounds, {
      padding: [40, 40],
      maxZoom: 16
    });
  }, [map, routeDetail]);

  useEffect(() => {
    if (!selectedStop) {
      return;
    }

    map.panTo([selectedStop.lat, selectedStop.lon], {
      animate: false
    });
  }, [map, selectedStop]);

  return null;
}
