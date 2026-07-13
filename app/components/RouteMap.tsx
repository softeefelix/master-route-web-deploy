"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Fragment, type ReactNode } from "react";
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
import {
  DEFAULT_MAP_VISUAL_MODE,
  MAP_VISUAL_MODES,
  type MapVisualMode
} from "@/lib/map-style";
import type { RouteDetailDto, RouteSummaryDto } from "@/types/routes";

type RouteMapProps = {
  routeSummaries: RouteSummaryDto[];
  routeDetail: RouteDetailDto | null;
  selectedStopId: number | null;
  isLoading: boolean;
  /** Force B&W / color. Default = B&W capture-friendly. */
  visualMode?: MapVisualMode;
  /** Hide unrelated routes (print/capture). Default true for main UI = false. */
  selectedOnly?: boolean;
  /** Hide mode toggle chip (print layout). */
  hideModeToggle?: boolean;
  onRouteSelect: (routeClusterId: number, stopClusterId?: number | null) => void;
  onStopSelect: (stopClusterId: number) => void;
  onVisualModeChange?: (mode: MapVisualMode) => void;
};

function createGlyphPin(className: string, glyphHtml: string) {
  return L.divIcon({
    className: "route-pin-icon",
    html: `<div class="route-pin ${className}"><div class="route-pin__glyph">${glyphHtml}</div></div>`,
    iconSize: [34, 34],
    iconAnchor: [10, 30],
    popupAnchor: [8, -26]
  });
}

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
  if (label.length >= 3) return 11;
  if (label.length === 2) return 13;
  return 15;
}

export function RouteMap({
  routeSummaries,
  routeDetail,
  selectedStopId,
  isLoading,
  visualMode: visualModeProp,
  selectedOnly = false,
  hideModeToggle = false,
  onRouteSelect,
  onStopSelect,
  onVisualModeChange
}: RouteMapProps) {
  const [internalMode, setInternalMode] = useState<MapVisualMode>(DEFAULT_MAP_VISUAL_MODE);
  const visualMode = visualModeProp ?? internalMode;
  const style = MAP_VISUAL_MODES[visualMode];

  const startIcon = useMemo(() => createGlyphPin("route-pin--start", "&#9654;"), []);
  const endIcon = useMemo(() => createGlyphPin("route-pin--end", "&#9873;"), []);

  // MR46: timed schedule drives numbered pins / polyline; candidates trail as grey.
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

  const scheduledWaypoints = useMemo(
    () => scheduledStops.map((s) => [s.lat, s.lon] as [number, number]),
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
        // straight fallback
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scheduledWaypoints]);

  function setMode(mode: MapVisualMode) {
    if (visualModeProp === undefined) setInternalMode(mode);
    onVisualModeChange?.(mode);
  }

  const summariesToDraw = selectedOnly
    ? routeSummaries.filter(
        (s) =>
          routeDetail != null &&
          s.routeClusterId === routeDetail.routeClusterId &&
          s.day === routeDetail.day
      )
    : routeSummaries;

  const selectedStroke = style.selectedStroke;
  const selectedCase = style.selectedCase;
  const pinDefault = style.pinDefault;
  const pinTop = style.pinTop;

  return (
    <div className={`relative h-full w-full driver-map-contrast driver-map-${visualMode}`}>
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
        <TileLayer
          key={visualMode}
          attribution={style.attribution}
          url={style.tileUrl}
          maxZoom={19}
          maxNativeZoom={19}
        />
        <Pane name="routes" style={{ zIndex: 350 }} />
        <Pane name="stops" style={{ zIndex: 450 }} />
        <FitToRoute routeDetail={routeDetail} selectedStopId={selectedStopId} />

        {summariesToDraw.map((summary) => {
          const isSelectedRoute =
            routeDetail?.routeClusterId === summary.routeClusterId && routeDetail.day === summary.day;

          if (summary.polyline.length === 0) {
            return null;
          }

          const positions =
            isSelectedRoute && roadPolyline && roadPolyline.length >= 2
              ? roadPolyline
              : summary.polyline;

          const unselectedColor = style.unselectedStroke || summary.color;

          return (
            <Fragment key={`${summary.day}-${summary.routeClusterId}`}>
              {/* White/dark casing so the centerline reads after B&W photocopy */}
              {isSelectedRoute ? (
                <Polyline
                  key={`${summary.day}-${summary.routeClusterId}-case`}
                  pathOptions={{
                    color: selectedCase,
                    weight: visualMode === "bw" ? 12 : 10,
                    opacity: 1,
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
                  color: isSelectedRoute ? selectedStroke : unselectedColor,
                  weight: isSelectedRoute ? (visualMode === "bw" ? 7 : 6) : 3.5,
                  opacity: isSelectedRoute ? 1 : visualMode === "bw" ? 0.45 : 0.55,
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
            </Fragment>
          );
        })}

        {!selectedOnly
          ? summariesToDraw.flatMap((summary) =>
              summary.stops.map((stop) => {
                const isSelectedRouteStop =
                  routeDetail?.routeClusterId === summary.routeClusterId &&
                  routeDetail.day === summary.day;
                if (isSelectedRouteStop) {
                  return null;
                }

                return (
                  <CircleMarker
                    key={`summary-${summary.routeClusterId}-${stop.stopClusterId}`}
                    center={[stop.lat, stop.lon]}
                    radius={5}
                    pathOptions={{
                      color: style.unselectedStroke || summary.color,
                      fillColor: style.unselectedStroke || summary.color,
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
            )
          : null}

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
                  color: visualMode === "bw" ? "#000" : "#64748b",
                  fillColor: visualMode === "bw" ? "#fff" : "#94a3b8",
                  fillOpacity: 0.9,
                  opacity: 1,
                  weight: 2,
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
                  ? createNumberedRouteIcon(pinTop, stop.visitOrder, 40)
                  : createNumberedRouteIcon(pinDefault, stop.visitOrder)
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

      {!hideModeToggle ? (
        <div className="absolute right-3 top-3 z-[1000] flex overflow-hidden rounded-full border border-slate-300 bg-white/95 text-xs font-semibold shadow-md">
          {(["bw", "street"] as MapVisualMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              className={`px-3 py-1.5 transition ${
                visualMode === mode ? "bg-ink text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
              title={
                mode === "bw"
                  ? "Best for screenshots & B&W print (default)"
                  : "Full color street basemap"
              }
            >
              {MAP_VISUAL_MODES[mode].label}
            </button>
          ))}
        </div>
      ) : null}

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
