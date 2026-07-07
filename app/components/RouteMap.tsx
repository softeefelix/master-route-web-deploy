"use client";

import { useEffect, useRef } from "react";
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

const SELECTED_ROUTE_COLOR = "#00A7E1";
const TOP_STOP_PIN_COLOR = "#F17720";

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
  const topScoringStopIds = new Set(
    (routeDetail?.stops ?? [])
      .filter((_, index, stops) => index !== 0 && index !== stops.length - 1)
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

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={defaultCenter}
        zoom={11}
        scrollWheelZoom
        className="h-full w-full"
        preferCanvas
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <Pane name="routes" style={{ zIndex: 350 }} />
        <Pane name="stops" style={{ zIndex: 450 }} />
        <FitToRoute routeDetail={routeDetail} selectedStopId={selectedStopId} />

        {routeSummaries.map((summary) => {
          const isSelectedRoute =
            routeDetail?.routeClusterId === summary.routeClusterId && routeDetail.day === summary.day;

          if (summary.polyline.length === 0) {
            return null;
          }

          return (
            <Polyline
              key={`${summary.day}-${summary.routeClusterId}`}
              pathOptions={{
                color: isSelectedRoute ? SELECTED_ROUTE_COLOR : summary.color,
                weight: isSelectedRoute ? 5 : 3,
                opacity: isSelectedRoute ? 0.95 : 0.5
              }}
              positions={summary.polyline}
              pane="routes"
              eventHandlers={{
                click: () => onRouteSelect(summary.routeClusterId)
              }}
            >
              <Tooltip sticky className="route-tooltip">
                {summary.day} {"\u2014"} {summary.routeClusterName}
              </Tooltip>
            </Polyline>
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
          const isBoundaryStop = index === 0 || index === routeDetail.stops.length - 1;
          const popupContent = (
            <div className="space-y-1 text-sm text-ink">
              <div className="font-semibold">
                {routeDetail.day} {"\u2014"} {routeDetail.routeClusterName}
              </div>
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
    map.fitBounds(routeDetail.bounds, { padding: [32, 32] });
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
