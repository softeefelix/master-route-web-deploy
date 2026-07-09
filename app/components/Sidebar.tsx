"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import type { DayOption, MonthOption, RouteClusterOption, RouteDetailDto, RouteNameDto, RouteReviewCommentsDto } from "@/types/routes";

type DateRange = { from: string; to: string };

type SidebarProps = {
  topStops: number;
  routeClusterLimit: number;
  days: DayOption[];
  months: MonthOption[];
  selectedMonths: number[];
  dateRange: DateRange | null;
  routeClusters: RouteClusterOption[];
  routeNamesById: Map<number, RouteNameDto>;
  persistentRouteClusterIds: number[];
  selectedDay: string;
  selectedRouteClusterId: number | null;
  routeDetail: RouteDetailDto | null;
  reviewComments: RouteReviewCommentsDto | null;
  arrivalTimes: Record<string, string>;
  selectedStopId: number | null;
  recentlyEditedStopId: number | null;
  loadState: "idle" | "loading" | "ready" | "error";
  errorMessage: string;
  persistentRouteErrorMessage: string;
  isPersistentRoutesUpdating: boolean;
  onSaveRouteName: (routeClusterId: number, name: string, updatedBy: string) => Promise<RouteNameDto>;
  onDayChange: (day: string) => void;
  onMonthsChange: (months: number[]) => void;
  onDateRangeApply: (range: DateRange) => void;
  onDateRangeClear: () => void;
  onRouteClusterChange: (routeClusterId: number) => void;
  onApplyDisplayLimits: (values: { topStops: number; routeClusterLimit: number }) => void;
  onAddPersistentRouteCluster: (routeClusterId: number) => Promise<boolean>;
  onRemovePersistentRouteCluster: (routeClusterId: number) => Promise<boolean>;
  onStopSelect: (stopClusterId: number) => void;
  onArrivalTimeChange: (stopClusterId: number, time: string) => void;
  hiddenStopIds: Set<number>;
  onStopVisibilityToggle: (stopClusterId: number) => void;
};

export function Sidebar({
  topStops,
  routeClusterLimit,
  days,
  months,
  selectedMonths,
  dateRange,
  routeClusters,
  routeNamesById,
  persistentRouteClusterIds,
  selectedDay,
  selectedRouteClusterId,
  routeDetail,
  reviewComments,
  arrivalTimes,
  selectedStopId,
  recentlyEditedStopId,
  loadState,
  errorMessage,
  persistentRouteErrorMessage,
  isPersistentRoutesUpdating,
  onSaveRouteName,
  onDayChange,
  onMonthsChange,
  onDateRangeApply,
  onDateRangeClear,
  onRouteClusterChange,
  onApplyDisplayLimits,
  onAddPersistentRouteCluster,
  onRemovePersistentRouteCluster,
  onStopSelect,
  onArrivalTimeChange,
  hiddenStopIds,
  onStopVisibilityToggle
}: SidebarProps) {
  const [draftTopStops, setDraftTopStops] = useState<string>(String(topStops));
  const [draftRouteClusterLimit, setDraftRouteClusterLimit] = useState<string>(String(routeClusterLimit));
  const [draftPersistentRouteClusterId, setDraftPersistentRouteClusterId] = useState<string>("");
  const [isFiltersOpen, setIsFiltersOpen] = useState<boolean>(false);
  const [draftFromDate, setDraftFromDate] = useState<string>(dateRange?.from ?? "");
  const [draftToDate, setDraftToDate] = useState<string>(dateRange?.to ?? "");
  const stopItemRefs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    setDraftTopStops(String(topStops));
  }, [topStops]);

  useEffect(() => {
    setDraftRouteClusterLimit(String(routeClusterLimit));
  }, [routeClusterLimit]);

  useEffect(() => {
    setDraftFromDate(dateRange?.from ?? "");
    setDraftToDate(dateRange?.to ?? "");
  }, [dateRange]);

  const isDateRangeActive = dateRange != null;
  const canApplyDateRange =
    draftFromDate.length > 0 && draftToDate.length > 0 && draftFromDate <= draftToDate;


  const parsedTopStops = Number(draftTopStops);
  const parsedRouteClusterLimit = Number(draftRouteClusterLimit);
  const parsedPersistentRouteClusterId = Number(draftPersistentRouteClusterId);
  const isTopStopsValid = Number.isInteger(parsedTopStops) && parsedTopStops > 0;
  const isRouteClusterLimitValid = Number.isInteger(parsedRouteClusterLimit) && parsedRouteClusterLimit > 0;
  const isPersistentRouteClusterIdValid =
    Number.isInteger(parsedPersistentRouteClusterId) && parsedPersistentRouteClusterId > 0;
  const isPersistentRouteClusterAlreadyAdded = persistentRouteClusterIds.includes(parsedPersistentRouteClusterId);
  const canApplyDisplayLimits = useMemo(
    () =>
      isTopStopsValid &&
      isRouteClusterLimitValid &&
      (parsedTopStops !== topStops || parsedRouteClusterLimit !== routeClusterLimit),
    [isRouteClusterLimitValid, isTopStopsValid, parsedRouteClusterLimit, parsedTopStops, routeClusterLimit, topStops]
  );
  const canAddPersistentRouteCluster =
    isPersistentRouteClusterIdValid && !isPersistentRouteClusterAlreadyAdded && !isPersistentRoutesUpdating;
  const stopOrderKey = routeDetail?.stops.map((stop) => stop.stopClusterId).join("|") ?? "";
  const visibleStopOrders = useMemo(() => {
    const orders = new Map<number, number>();
    let nextOrder = 1;

    for (const stop of routeDetail?.stops ?? []) {
      if (!hiddenStopIds.has(stop.stopClusterId)) {
        orders.set(stop.stopClusterId, nextOrder);
        nextOrder += 1;
      }
    }

    return orders;
  }, [hiddenStopIds, routeDetail]);

  useEffect(() => {
    if (recentlyEditedStopId == null) {
      return;
    }

    const stopItem = stopItemRefs.current.get(recentlyEditedStopId);
    if (!stopItem) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      stopItem.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [recentlyEditedStopId, stopOrderKey]);

  return (
    <aside className="relative z-10 flex h-[48vh] w-full flex-col border-b border-line bg-white/95 shadow-panel backdrop-blur md:h-screen md:max-w-[430px] md:min-w-[360px] md:border-b-0 md:border-r">
      <div className="sticky top-0 z-20 border-b border-line bg-white/96 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-lg font-semibold tracking-tight text-ink">Master Routes</div>
            <div className="text-sm text-slate-500">
              Click the menu icon to filter/view routes
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-white text-ink transition hover:bg-slate-50"
            onClick={() => setIsFiltersOpen((current) => !current)}
            aria-expanded={isFiltersOpen}
            aria-label={isFiltersOpen ? "Close filters" : "Open filters"}
          >
            <span className="flex flex-col gap-1.5">
              <span className="block h-0.5 w-5 rounded-full bg-current" />
              <span className="block h-0.5 w-5 rounded-full bg-current" />
              <span className="block h-0.5 w-5 rounded-full bg-current" />
            </span>
          </button>
        </div>
        {isFiltersOpen ? (
          <div className="mt-4 rounded-3xl border border-line bg-slate-50/90 p-4">
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
            </div>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                <span>Months</span>
                {isDateRangeActive ? (
                  <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-accent normal-case">
                    Date range active
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {months.map((month) => {
                  const isSelected = selectedMonths.includes(month.value);
                  const shortLabel = month.label.slice(0, 3).toUpperCase();

                  return (
                    <button
                      key={month.value}
                      type="button"
                      disabled={isDateRangeActive}
                      className={[
                        "rounded-full border px-3 py-2 text-xs font-semibold tracking-[0.16em] transition",
                        isDateRangeActive
                          ? "cursor-not-allowed border-line bg-slate-100 text-slate-300"
                          : isSelected
                            ? "border-ink bg-ink text-white shadow-sm"
                            : "border-line bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-100"
                      ].join(" ")}
                      onClick={() => {
                        if (isDateRangeActive) {
                          return;
                        }
                        const nextMonths = isSelected
                          ? selectedMonths.filter((value) => value !== month.value)
                          : [...selectedMonths, month.value].sort((left, right) => left - right);

                        if (nextMonths.length > 0) {
                          onMonthsChange(nextMonths);
                        }
                      }}
                      aria-pressed={isSelected}
                    >
                      {shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                <span>Date range</span>
                {isDateRangeActive ? (
                  <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-slate-600 normal-case">
                    {dateRange?.from} → {dateRange?.to}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  From
                  <input
                    type="date"
                    className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    value={draftFromDate}
                    max={draftToDate || undefined}
                    onChange={(event) => setDraftFromDate(event.target.value)}
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  To
                  <input
                    type="date"
                    className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    value={draftToDate}
                    min={draftFromDate || undefined}
                    onChange={(event) => setDraftToDate(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={!canApplyDateRange}
                  onClick={() => {
                    if (canApplyDateRange) {
                      onDateRangeApply({ from: draftFromDate, to: draftToDate });
                    }
                  }}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  disabled={!isDateRangeActive}
                  onClick={() => {
                    setDraftFromDate("");
                    setDraftToDate("");
                    onDateRangeClear();
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-3 flex gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Route Cluster
                <select
                  className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                  value={selectedRouteClusterId ?? ""}
                  onChange={(event) => onRouteClusterChange(Number(event.target.value))}
                >
                  {routeClusters.map((cluster) => (
                    <option key={cluster.id} value={cluster.id}>
                      {formatRouteClusterOptionLabel(cluster, routeNamesById.get(cluster.id)?.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  # of Route
                  <input
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    min={1}
                    type="text"
                    className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    value={draftRouteClusterLimit}
                    onChange={(event) => setDraftRouteClusterLimit(event.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  # of Stops
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
              </div>
              <button
                type="button"
                className="w-fit rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!canApplyDisplayLimits}
                onClick={() => {
                  if (isTopStopsValid && isRouteClusterLimitValid) {
                    onApplyDisplayLimits({
                      topStops: parsedTopStops,
                      routeClusterLimit: parsedRouteClusterLimit
                    });
                  }
                }}
              >
                Apply Limits
              </button>
            </div>
            <div className="mt-4 border-t border-line/80 pt-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Persistent Routes
              </div>
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Route ID
                  <input
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    min={1}
                    type="text"
                    className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    value={draftPersistentRouteClusterId}
                    onChange={(event) => setDraftPersistentRouteClusterId(event.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <button
                  type="button"
                  className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={!canAddPersistentRouteCluster}
                  onClick={() => {
                    if (canAddPersistentRouteCluster) {
                      void onAddPersistentRouteCluster(parsedPersistentRouteClusterId).then((wasAdded) => {
                        if (wasAdded) {
                          setDraftPersistentRouteClusterId("");
                        }
                      });
                    }
                  }}
                >
                  Add
                </button>
              </div>
              {persistentRouteErrorMessage ? (
                <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {persistentRouteErrorMessage}
                </div>
              ) : null}
              {persistentRouteClusterIds.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {persistentRouteClusterIds.map((routeClusterId) => (
                    <span
                      key={routeClusterId}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      ID: {routeClusterId}
                      <button
                        type="button"
                        className="text-slate-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300"
                        disabled={isPersistentRoutesUpdating}
                        onClick={() => void onRemovePersistentRouteCluster(routeClusterId)}
                        aria-label={`Remove persistent route cluster ${routeClusterId}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-4 rounded-2xl border border-accent/10 bg-canvas px-3 py-2 text-xs text-slate-600">
              Tip: Click one or several month buttons to recompute scores from `sale_stops` using only those months.
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3">
          <h1 className="text-sm font-semibold text-ink">
            {routeDetail?.title ?? "Select a day and route cluster to see stop addresses in order"}
          </h1>
          {routeDetail ? (
            <div className="mt-3 space-y-2">
              <RouteNameEditor
                routeClusterId={routeDetail.routeClusterId}
                currentName={routeNamesById.get(routeDetail.routeClusterId)?.name ?? null}
                onSave={onSaveRouteName}
              />
              <div className="rounded-2xl border border-accent/20 bg-accent/10 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                  Expected Daily Revenue
                </div>
                <div className="mt-1 text-lg font-bold text-ink">
                  {formatCurrency(routeDetail.expectedDailyRevenue)}
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  <span className="font-semibold text-ink">Total past sales:</span> {formatCurrency(routeDetail.totalSalesAmount)}
                </div>
              </div>
              {reviewComments && reviewComments.comments.length > 0 ? (
                <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-3 py-3">
                  <div className="flex items-baseline justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                      Route Review
                    </div>
                    {reviewComments.generatedAt ? (
                      <div className="text-[10px] text-amber-600">
                        {new Date(reviewComments.generatedAt).toLocaleDateString()}
                      </div>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {reviewComments.comments.map((comment, index) => {
                      const isCritical = comment.startsWith("TIMING-CRITICAL");
                      const isAction =
                        comment.startsWith("RESHAPE") || comment.startsWith("MOVE");
                      return (
                        <li
                          key={index}
                          className={`text-xs leading-relaxed ${
                            isCritical
                              ? "font-semibold text-red-700"
                              : isAction
                                ? "font-medium text-amber-800"
                                : "text-slate-700"
                          }`}
                        >
                          {comment}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {selectedDay && selectedRouteClusterId != null ? (
                <a
                  href={`/print/route-sheet?day=${encodeURIComponent(selectedDay)}&routeClusterId=${selectedRouteClusterId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-2xl border border-line bg-white px-3 py-2.5 text-center text-xs font-semibold text-ink transition hover:bg-slate-50"
                >
                  🖨 Print driver route sheet (timed)
                </a>
              ) : null}
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

        <ol className="m-0 space-y-2">
          {routeDetail?.stops.map((stop) => {
            const isStopHidden = hiddenStopIds.has(stop.stopClusterId);
            const isStopSelected = selectedStopId === stop.stopClusterId;
            const visibleStopOrder = visibleStopOrders.get(stop.stopClusterId);

            return (
              <li
                key={stop.stopClusterId}
                ref={(node) => {
                  if (node) {
                    stopItemRefs.current.set(stop.stopClusterId, node);
                  } else {
                    stopItemRefs.current.delete(stop.stopClusterId);
                  }
                }}
                className="flex items-stretch gap-2"
              >
                <span
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    isStopHidden
                      ? "border-slate-200 bg-slate-100 text-slate-400"
                      : "border-accent/30 bg-accent/10 text-accent"
                  ].join(" ")}
                  aria-label={
                    isStopHidden
                      ? `Stop cluster ${stop.stopClusterId} is hidden from the map`
                      : `Visible route stop ${visibleStopOrder}`
                  }
                >
                  {isStopHidden ? "-" : visibleStopOrder}
                </span>
                <div
                  className={[
                    "w-full rounded-2xl border px-3 py-3 text-left transition",
                    isStopHidden
                      ? "border-line bg-slate-100/80 shadow-none"
                      : isStopSelected
                        ? "border-accent bg-accent/5 shadow-sm"
                        : "border-transparent bg-transparent hover:border-line hover:bg-slate-50"
                  ].join(" ")}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onStopSelect(stop.stopClusterId)}
                    >
                      <div
                        className={[
                          "mb-1 text-sm font-medium",
                          isStopHidden ? "text-slate-400" : "text-ink"
                        ].join(" ")}
                      >
                        {stop.address}
                      </div>
                      <div className={isStopHidden ? "text-xs text-slate-400" : "text-xs text-slate-500"}>
                        Past total sales: {formatCurrency(stop.pastSalesPerDaySameDow)}
                      </div>
                    </button>
                    <div className="flex w-36 shrink-0 flex-col gap-2">
                      <label
                        className={[
                          "flex flex-col gap-1 text-[10px] font-semibold",
                          isStopHidden ? "text-slate-400" : "text-slate-500"
                        ].join(" ")}
                      >
                        <span className="tracking-[0.16em]">Arrival Time</span>
                        <input
                          type="time"
                          className={[
                            "w-full rounded-xl border px-3 py-1.5 text-sm font-semibold outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10",
                            isStopHidden
                              ? "border-slate-200 bg-slate-100 text-slate-400"
                              : "border-line bg-white text-ink"
                          ].join(" ")}
                          value={arrivalTimes[String(stop.stopClusterId)] ?? ""}
                          onChange={(event) => onArrivalTimeChange(stop.stopClusterId, event.target.value)}
                          aria-label={`Arrival time for stop cluster ${stop.stopClusterId}`}
                        />
                        {stop.pastArrivalTime ? (
                          <span className="leading-tight">
                            <span className="block">Past Visit Time</span>
                            <span
                              className={
                                isStopHidden ? "block text-xs text-slate-400" : "block text-xs text-slate-600"
                              }
                            >
                              {stop.pastArrivalTime}
                            </span>
                          </span>
                        ) : null}
                      </label>
                      <button
                        type="button"
                        className={[
                          "w-full rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                          isStopHidden
                            ? "border-slate-300 bg-white text-slate-600 hover:border-accent hover:text-accent"
                            : "border-line bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                        ].join(" ")}
                        onClick={() => onStopVisibilityToggle(stop.stopClusterId)}
                        aria-pressed={isStopHidden}
                        aria-label={`${isStopHidden ? "Show" : "Hide"} stop cluster ${stop.stopClusterId} on the map`}
                      >
                        {isStopHidden ? "Show" : "Hide"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

function formatRouteClusterOptionLabel(cluster: RouteClusterOption, routeName: string | undefined) {
  if (!routeName) {
    return cluster.label;
  }

  return `${routeName} (#${cluster.id})`;
}

function RouteNameEditor({
  routeClusterId,
  currentName,
  onSave
}: {
  routeClusterId: number;
  currentName: string | null;
  onSave: (routeClusterId: number, name: string, updatedBy: string) => Promise<RouteNameDto>;
}) {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [draftName, setDraftName] = useState<string>(currentName ?? "");
  const [draftEditor, setDraftEditor] = useState<string>("andrew");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setDraftName(currentName ?? "");
    setIsEditing(false);
    setFeedback(null);
  }, [routeClusterId, currentName]);

  const trimmedDraftName = draftName.trim();
  const trimmedDraftEditor = draftEditor.trim();
  const canSave =
    trimmedDraftName.length > 0 &&
    trimmedDraftName.length <= 64 &&
    !trimmedDraftName.includes(",") &&
    trimmedDraftEditor.length > 0 &&
    trimmedDraftEditor.length <= 32 &&
    !isSaving;

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      await onSave(routeClusterId, trimmedDraftName, trimmedDraftEditor);
      setFeedback({ type: "success", message: "Route name saved." });
      setIsEditing(false);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to save route name."
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-ink">
          {currentName ? `${currentName} (#${routeClusterId})` : `#${routeClusterId}`}
        </span>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-white text-xs text-slate-500 transition hover:border-accent hover:text-accent"
          onClick={() => {
            setDraftName(currentName ?? "");
            setIsEditing(true);
            setFeedback(null);
          }}
          aria-label={`Edit name for route cluster ${routeClusterId}`}
          title="Edit route name"
        >
          ✏️
        </button>
        {feedback ? (
          <span className={feedback.type === "success" ? "text-xs text-emerald-600" : "text-xs text-red-600"}>
            {feedback.message}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-slate-50/90 p-3">
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Route Name
          <input
            type="text"
            maxLength={64}
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="e.g. SanMateo-Ryder"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Editor Name
          <input
            type="text"
            maxLength={32}
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
            value={draftEditor}
            onChange={(event) => setDraftEditor(event.target.value)}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            onClick={() => {
              setIsEditing(false);
              setFeedback(null);
            }}
          >
            Cancel
          </button>
        </div>
        {feedback && feedback.type === "error" ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {feedback.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
