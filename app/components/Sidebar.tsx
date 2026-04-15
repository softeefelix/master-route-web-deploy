"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import type { DayOption, RouteClusterOption, RouteDetailDto } from "@/types/routes";

type SidebarProps = {
  topStops: number;
  days: DayOption[];
  routeClusters: RouteClusterOption[];
  selectedDay: string;
  selectedRouteClusterId: number | null;
  routeDetail: RouteDetailDto | null;
  selectedStopId: number | null;
  loadState: "idle" | "loading" | "ready" | "error";
  errorMessage: string;
  onDayChange: (day: string) => void;
  onRouteClusterChange: (routeClusterId: number) => void;
  onApplyTopStops: (topStops: number) => void;
  onStopSelect: (stopClusterId: number) => void;
};

export function Sidebar({
  topStops,
  days,
  routeClusters,
  selectedDay,
  selectedRouteClusterId,
  routeDetail,
  selectedStopId,
  loadState,
  errorMessage,
  onDayChange,
  onRouteClusterChange,
  onApplyTopStops,
  onStopSelect
}: SidebarProps) {
  const [draftTopStops, setDraftTopStops] = useState<string>(String(topStops));

  useEffect(() => {
    setDraftTopStops(String(topStops));
  }, [topStops]);

  const parsedTopStops = Number(draftTopStops);
  const isTopStopsValid = Number.isInteger(parsedTopStops) && parsedTopStops > 0;
  const canApplyTopStops = useMemo(
    () => isTopStopsValid && parsedTopStops !== topStops,
    [isTopStopsValid, parsedTopStops, topStops]
  );

  return (
    <aside className="relative z-10 flex h-[48vh] w-full flex-col border-b border-line bg-white/95 shadow-panel backdrop-blur md:h-screen md:max-w-[430px] md:min-w-[360px] md:border-b-0 md:border-r">
      <div className="sticky top-0 z-20 border-b border-line bg-white/96 px-4 py-4">
        <div className="mb-1 text-lg font-semibold tracking-tight text-ink">Master Routes</div>
        <div className="mb-4 text-sm text-slate-500">
          Select a day and route cluster to sync the ordered stop list with the live map.
        </div>
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Day
            <select
              className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
              value={selectedDay}
              onChange={(event) => onDayChange(event.target.value)}
            >
              {days.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Route Cluster
            <select
              className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
              value={selectedRouteClusterId ?? ""}
              onChange={(event) => onRouteClusterChange(Number(event.target.value))}
            >
              {routeClusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Top Stops Per Route
            <input
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              min={1}
              type="text"
              className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
              value={draftTopStops}
              onChange={(event) => setDraftTopStops(event.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button
            type="button"
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!canApplyTopStops}
            onClick={() => {
              if (isTopStopsValid) {
                onApplyTopStops(parsedTopStops);
              }
            }}
          >
            Apply
          </button>
        </div>
        <div className="mt-4 rounded-2xl border border-accent/10 bg-canvas px-3 py-2 text-xs text-slate-600">
          Tip: Switching the day redraws only that day&apos;s overlays. Use Top Stops to limit each route to its highest-scoring stops.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h1 className="text-sm font-semibold text-ink">
            {routeDetail?.title ?? "Select a day and route cluster to see stop addresses in order"}
          </h1>
          {routeDetail ? (
            <div className="shrink-0 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">
              {formatCurrency(routeDetail.totalSalesAmount)}
            </div>
          ) : null}
        </div>

        {loadState === "error" ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
        ) : null}

        {loadState === "loading" && !routeDetail ? (
          <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-500">
            Loading route data...
          </div>
        ) : null}

        {loadState !== "error" && routeDetail && routeDetail.stops.length === 0 ? (
          <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No stops are available for this route cluster.
          </div>
        ) : null}

        <ol className="m-0 list-decimal space-y-2 pl-5">
          {routeDetail?.stops.map((stop) => (
            <li key={stop.stopClusterId}>
              <button
                type="button"
                className={[
                  "w-full rounded-2xl border px-3 py-3 text-left transition",
                  selectedStopId === stop.stopClusterId
                    ? "border-accent bg-accent/5 shadow-sm"
                    : "border-transparent bg-transparent hover:border-line hover:bg-slate-50"
                ].join(" ")}
                onClick={() => onStopSelect(stop.stopClusterId)}
              >
                <div className="mb-1 text-sm font-medium text-ink">
                  #{stop.visitOrder} {"\u2014"} {stop.address}
                </div>
                <div className="text-xs text-slate-500">
                  Past total sales: {formatCurrency(stop.pastSalesPerDaySameDow)} | Visit #{stop.visitOrder}
                </div>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
