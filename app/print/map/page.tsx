"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/api";
import type { RouteDetailDto } from "@/types/routes";

const RouteMap = dynamic(
  () => import("@/app/components/RouteMap").then((m) => m.RouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-slate-600">
        Loading map for print…
      </div>
    )
  }
);

/**
 * Full-window B&W map for Andrew to screenshot in chunks for drivers.
 * Opened from sidebar → "Map for drivers".
 */
export default function PrintMapPage() {
  const [day, setDay] = useState("");
  const [routeClusterId, setRouteClusterId] = useState<number | null>(null);
  const [routeDetail, setRouteDetail] = useState<RouteDetailDto | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("day") ?? "";
    const rc = Number(params.get("routeClusterId") ?? "");
    setDay(d);
    setRouteClusterId(Number.isFinite(rc) && rc > 0 ? rc : null);
  }, []);

  useEffect(() => {
    if (!day || routeClusterId == null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    // All months so the seasonal pool matches master view default.
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const qs = new URLSearchParams({
      day,
      routeClusterId: String(routeClusterId),
      topStops: "80",
      routeClusterLimit: "50"
    });
    for (const m of months) qs.append("month", String(m));

    void (async () => {
      try {
        const detail = await fetchJson<RouteDetailDto>(
          `/api/routes?${qs.toString()}`,
          undefined,
          "Unable to load route map."
        );
        if (!cancelled) setRouteDetail(detail);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load route");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [day, routeClusterId]);

  const summary = useMemo(() => {
    if (!routeDetail) return [];
    return [
      {
        routeClusterId: routeDetail.routeClusterId,
        routeClusterName: routeDetail.routeClusterName,
        day: routeDetail.day,
        color: "#000000",
        bounds: routeDetail.bounds,
        polyline: routeDetail.polyline,
        centroid: [
          (routeDetail.bounds[0][0] + routeDetail.bounds[1][0]) / 2,
          (routeDetail.bounds[0][1] + routeDetail.bounds[1][1]) / 2
        ] as [number, number],
        stopCount: routeDetail.stops.length,
        predictedSalesTotal: routeDetail.predictedSalesTotal,
        totalSalesAmount: routeDetail.totalSalesAmount,
        expectedDailyRevenue: routeDetail.expectedDailyRevenue,
        stops: routeDetail.stops.map((s) => ({
          stopClusterId: s.stopClusterId,
          lat: s.lat,
          lon: s.lon
        }))
      }
    ];
  }, [routeDetail]);

  const title = routeDetail
    ? `${routeDetail.routeClusterName.replace(/\s+ID:\s*\d+\s*$/i, "").trim()} — ${routeDetail.day}`
    : "Route map for drivers";

  return (
    <div className="print-map-page flex h-screen w-screen flex-col bg-white text-black">
      <header className="flex items-center justify-between gap-3 border-b border-black px-4 py-2 print:border-black">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700">
            Master Route · driver capture map · B&W
          </div>
          <h1 className="text-lg font-bold leading-tight">{title}</h1>
          <div className="text-xs text-slate-700">
            {routeDetail
              ? `${routeDetail.stops.filter((s) => s.plannedArrive).length || routeDetail.stops.length} stops · black route on street basemap · screenshot chunks for drivers`
              : "Select a route from the main app"}
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-black bg-black px-3 py-2 text-xs font-semibold text-white"
          >
            Print / Save PDF
          </button>
          <a
            href="/"
            className="rounded-lg border border-slate-400 px-3 py-2 text-xs font-semibold text-slate-800"
          >
            Back
          </a>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="p-6 text-sm text-red-700">{error}</div>
        ) : (
          <RouteMap
            routeSummaries={summary}
            routeDetail={routeDetail}
            selectedStopId={null}
            isLoading={loading}
            visualMode="bw"
            selectedOnly
            hideModeToggle
            onRouteSelect={() => undefined}
            onStopSelect={() => undefined}
          />
        )}
      </div>

      <style>{`
        @media print {
          @page {
            margin: 0.25in;
            size: landscape;
          }
          html,
          body {
            height: auto !important;
            background: #fff !important;
            color: #000 !important;
          }
          .print-map-page {
            height: 100vh !important;
          }
          .print-map-page header button,
          .print-map-page header a {
            display: none !important;
          }
          /* Leaflet tiles + vector ink dense for B&W photocopiers */
          .leaflet-container {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
}
