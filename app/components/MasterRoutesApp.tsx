"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  DayOption,
  MonthOption,
  PersistentRouteClusterDto,
  RouteClusterOption,
  RouteDetailDto,
  RouteNameDto,
  RouteReviewCommentsDto,
  RouteSummaryDto
} from "@/types/routes";
import { Sidebar } from "@/app/components/Sidebar";
import {
  clearArrivalTime,
  getArrivalTimes,
  saveArrivalTime,
  sortStopsByArrivalTime
} from "@/lib/arrival-times";
import { fetchJson } from "@/lib/api";
import { DEFAULT_ROUTE_CLUSTER_LIMIT, DEFAULT_TOP_STOPS } from "@/lib/constants";
import { calculateBounds } from "@/lib/utils";

export type DateRange = { from: string; to: string };


const RouteMap = dynamic(() => import("@/app/components/RouteMap").then((mod) => mod.RouteMap), {
  ssr: false
});

type LoadState = "idle" | "loading" | "ready" | "error";

export function MasterRoutesApp() {
  const [topStops, setTopStops] = useState<number>(DEFAULT_TOP_STOPS);
  const [routeClusterLimit, setRouteClusterLimit] = useState<number>(DEFAULT_ROUTE_CLUSTER_LIMIT);
  const [days, setDays] = useState<DayOption[]>([]);
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [routeClusters, setRouteClusters] = useState<RouteClusterOption[]>([]);
  const [persistentRouteClusterIds, setPersistentRouteClusterIds] = useState<number[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedRouteClusterId, setSelectedRouteClusterId] = useState<number | null>(null);
  const [routeSummaries, setRouteSummaries] = useState<RouteSummaryDto[]>([]);
  const [routeDetail, setRouteDetail] = useState<RouteDetailDto | null>(null);
  const [arrivalTimes, setArrivalTimes] = useState<Record<string, string>>({});
  const [hiddenStopsByRoute, setHiddenStopsByRoute] = useState<Record<string, number[]>>({});
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [recentlyEditedStopId, setRecentlyEditedStopId] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [persistentRouteErrorMessage, setPersistentRouteErrorMessage] = useState<string>("");
  const [isPersistentRoutesUpdating, setIsPersistentRoutesUpdating] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();
  const [routeNamesById, setRouteNamesById] = useState<Map<number, RouteNameDto>>(new Map());
  const [reviewComments, setReviewComments] = useState<RouteReviewCommentsDto | null>(null);

  useEffect(() => {
    if (!selectedDay || selectedRouteClusterId == null) {
      setReviewComments(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const dto = await fetchJson<RouteReviewCommentsDto>(
          `/api/route-comments?day=${encodeURIComponent(selectedDay)}&routeClusterId=${selectedRouteClusterId}`,
          { cache: "no-store" },
          "Unable to load route review comments."
        );
        if (!cancelled) {
          setReviewComments(dto);
        }
      } catch {
        if (!cancelled) {
          setReviewComments(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDay, selectedRouteClusterId]);

  useEffect(() => {
    void initialize();
    void refreshRouteNames();
  }, []);

  async function refreshRouteNames() {
    try {
      const names = await fetchJson<RouteNameDto[]>(
        "/api/route-names",
        { cache: "no-store" },
        "Unable to load route names."
      );
      setRouteNamesById(new Map(names.map((entry) => [entry.routeClusterId, entry])));
    } catch (error) {
      console.error(error);
    }
  }

  async function saveRouteName(routeClusterId: number, name: string, updatedBy: string) {
    const updated = await fetchJson<RouteNameDto>(
      "/api/route-names",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeClusterId, name, updatedBy })
      },
      "Unable to save route name."
    );
    setRouteNamesById((current) => {
      const next = new Map(current);
      next.set(updated.routeClusterId, updated);
      return next;
    });
    return updated;
  }

  async function initialize() {
    try {
      setLoadState("loading");
      setErrorMessage("");

      const [availableDays, availableMonths, persistentRoutes] = await Promise.all([
        fetchJson<DayOption[]>("/api/days", { cache: "no-store" }, "Unable to load available days."),
        fetchJson<MonthOption[]>("/api/months", { cache: "no-store" }, "Unable to load available months."),
        fetchJson<PersistentRouteClusterDto[]>(
          "/api/persistent-route-clusters",
          { cache: "no-store" },
          "Unable to load persistent route clusters."
        )
      ]);
      setDays(availableDays);
      setMonths(availableMonths);
      setPersistentRouteClusterIds(toPersistentRouteClusterIds(persistentRoutes));

      const firstDay = availableDays[0]?.value;
      const initialMonths = availableMonths.map((month) => month.value);

      if (!firstDay || initialMonths.length === 0) {
        setLoadState("ready");
        return;
      }

      setSelectedMonths(initialMonths);
      await loadDay(firstDay, initialMonths, undefined, topStops, routeClusterLimit);
    } catch (error) {
      console.error(error);
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unexpected error");
    }
  }

  function buildMonthsQuery(monthValues: number[]) {
    return monthValues.map((month) => `month=${encodeURIComponent(String(month))}`).join("&");
  }

  function buildFilterQuery(monthValues: number[], range: DateRange | null) {
    if (range) {
      return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    }
    return buildMonthsQuery(monthValues);
  }

  async function loadDay(
    day: string,
    monthValues = selectedMonths,
    preferredRouteClusterId?: number | null,
    nextTopStops = topStops,
    nextRouteClusterLimit = routeClusterLimit,
    nextDateRange: DateRange | null = dateRange
  ) {
    if (!day || (monthValues.length === 0 && !nextDateRange)) {
      setSelectedDay(day);
      setSelectedMonths(monthValues);
      setDateRange(nextDateRange);
      setRouteClusters([]);
      setRouteSummaries([]);
      setRouteDetail(null);
      setArrivalTimes({});
      setSelectedRouteClusterId(null);
      setSelectedStopId(null);
      setRecentlyEditedStopId(null);
      setLoadState("ready");
      return;
    }

    startTransition(() => {
      setLoadState("loading");
      setSelectedDay(day);
      setSelectedMonths(monthValues);
      setDateRange(nextDateRange);
      setSelectedStopId(null);
      setRecentlyEditedStopId(null);
    });

    try {
      const filterQuery = buildFilterQuery(monthValues, nextDateRange);
      const [clusters, summaries] = await Promise.all([
        fetchJson<RouteClusterOption[]>(
          `/api/route-clusters?day=${encodeURIComponent(day)}&routeClusterLimit=${nextRouteClusterLimit}&${filterQuery}`,
          { cache: "no-store" },
          "Unable to load route-cluster data for the selected day."
        ),
        fetchJson<RouteSummaryDto[]>(
          `/api/routes/summary?day=${encodeURIComponent(day)}&topStops=${nextTopStops}&routeClusterLimit=${nextRouteClusterLimit}&${filterQuery}`,
          { cache: "no-store" },
          "Unable to load route-cluster data for the selected day."
        )
      ]);
      const firstClusterId = clusters[0]?.id ?? null;
      const nextSelectedRouteClusterId =
        preferredRouteClusterId != null && clusters.some((cluster) => cluster.id === preferredRouteClusterId)
          ? preferredRouteClusterId
          : firstClusterId;

      setRouteClusters(clusters);
      setRouteSummaries(summaries);
      setSelectedRouteClusterId(nextSelectedRouteClusterId);

      if (nextSelectedRouteClusterId == null) {
        setRouteDetail(null);
        setArrivalTimes({});
        setRecentlyEditedStopId(null);
        setLoadState("ready");
        return;
      }

      await loadRoute(day, monthValues, nextSelectedRouteClusterId, nextTopStops, nextRouteClusterLimit, undefined, nextDateRange);
    } catch (error) {
      console.error(error);
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unexpected error");
    }
  }

  async function loadRoute(
    day: string,
    monthValues: number[],
    routeClusterId: number,
    nextTopStops = topStops,
    nextRouteClusterLimit = routeClusterLimit,
    preferredStopId?: number | null,
    nextDateRange: DateRange | null = dateRange
  ) {
    startTransition(() => {
      setLoadState("loading");
      setSelectedRouteClusterId(routeClusterId);
      setSelectedMonths(monthValues);
      setDateRange(nextDateRange);
      setSelectedStopId(preferredStopId ?? null);
      setRecentlyEditedStopId(null);
    });

    try {
      const filterQuery = buildFilterQuery(monthValues, nextDateRange);
      const detail = await fetchJson<RouteDetailDto>(
        `/api/routes?day=${encodeURIComponent(day)}&routeClusterId=${routeClusterId}&topStops=${nextTopStops}&routeClusterLimit=${nextRouteClusterLimit}&${filterQuery}`,
        { cache: "no-store" },
        "Unable to load the selected route cluster."
      );
      setArrivalTimes(getArrivalTimes(detail.routeClusterId, detail.day));
      setRouteDetail(detail);
      setSelectedStopId(
        preferredStopId != null && detail.stops.some((stop) => stop.stopClusterId === preferredStopId)
          ? preferredStopId
          : null
      );
      setLoadState("ready");
    } catch (error) {
      console.error(error);
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unexpected error");
    }
  }

  async function addPersistentRouteCluster(routeClusterId: number) {
    return updatePersistentRouteClusters(
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeClusterId })
      },
      "Unable to add persistent route cluster."
    );
  }

  async function removePersistentRouteCluster(routeClusterId: number) {
    return updatePersistentRouteClusters(
      {
        method: "DELETE"
      },
      "Unable to remove persistent route cluster.",
      routeClusterId
    );
  }

  async function updatePersistentRouteClusters(
    requestInit: RequestInit,
    fallbackMessage: string,
    routeClusterId?: number
  ) {
    try {
      setIsPersistentRoutesUpdating(true);
      setPersistentRouteErrorMessage("");

      const query = routeClusterId == null ? "" : `?routeClusterId=${encodeURIComponent(String(routeClusterId))}`;
      const persistentRoutes = await fetchJson<PersistentRouteClusterDto[]>(
        `/api/persistent-route-clusters${query}`,
        requestInit,
        fallbackMessage
      );
      setPersistentRouteClusterIds(toPersistentRouteClusterIds(persistentRoutes));

      if (selectedDay) {
        await loadDay(selectedDay, selectedMonths, selectedRouteClusterId, topStops, routeClusterLimit);
      }

      return true;
    } catch (error) {
      console.error(error);
      setPersistentRouteErrorMessage(error instanceof Error ? error.message : fallbackMessage);
      return false;
    } finally {
      setIsPersistentRoutesUpdating(false);
    }
  }

  function toPersistentRouteClusterIds(persistentRoutes: PersistentRouteClusterDto[]) {
    return persistentRoutes.map((route) => route.routeClusterId);
  }

  function updateStopArrivalTime(stopClusterId: number, time: string) {
    if (!routeDetail) {
      return;
    }

    if (time === "") {
      clearArrivalTime(routeDetail.routeClusterId, routeDetail.day, stopClusterId);
    } else {
      saveArrivalTime(routeDetail.routeClusterId, routeDetail.day, stopClusterId, time);
    }

    setArrivalTimes(getArrivalTimes(routeDetail.routeClusterId, routeDetail.day));
    setSelectedStopId(stopClusterId);
    setRecentlyEditedStopId(stopClusterId);
  }

  function toggleStopVisibility(stopClusterId: number) {
    if (!routeDetailWithArrivalTimes) {
      return;
    }

    const routeKey = buildRouteVisibilityKey(routeDetailWithArrivalTimes);
    setHiddenStopsByRoute((current) => {
      const currentHiddenStopIds = current[routeKey] ?? [];
      const nextHiddenStopIds = currentHiddenStopIds.includes(stopClusterId)
        ? currentHiddenStopIds.filter((hiddenStopId) => hiddenStopId !== stopClusterId)
        : [...currentHiddenStopIds, stopClusterId];

      if (nextHiddenStopIds.length === 0) {
        const next = { ...current };
        delete next[routeKey];
        return next;
      }

      return {
        ...current,
        [routeKey]: nextHiddenStopIds
      };
    });
  }

  const routeDetailWithArrivalTimes = useMemo<RouteDetailDto | null>(() => {
    if (!routeDetail) {
      return null;
    }

    const orderedStops = sortStopsByArrivalTime(routeDetail.stops, arrivalTimes).map((stop, index) => ({
      ...stop,
      visitOrder: index + 1
    }));

    return {
      ...routeDetail,
      polyline: orderedStops.map((stop) => [stop.lat, stop.lon] as [number, number]),
      stops: orderedStops
    };
  }, [arrivalTimes, routeDetail]);

  const hiddenStopIds = useMemo(() => {
    if (!routeDetailWithArrivalTimes) {
      return new Set<number>();
    }

    return new Set(hiddenStopsByRoute[buildRouteVisibilityKey(routeDetailWithArrivalTimes)] ?? []);
  }, [hiddenStopsByRoute, routeDetailWithArrivalTimes]);

  const routeDetailForMap = useMemo<RouteDetailDto | null>(() => {
    if (!routeDetailWithArrivalTimes || hiddenStopIds.size === 0) {
      return routeDetailWithArrivalTimes;
    }

    const visibleStops = routeDetailWithArrivalTimes.stops
      .filter((stop) => !hiddenStopIds.has(stop.stopClusterId))
      .map((stop, index) => ({
        ...stop,
        visitOrder: index + 1
      }));
    const visiblePolyline = visibleStops.map((stop) => [stop.lat, stop.lon] as [number, number]);

    return {
      ...routeDetailWithArrivalTimes,
      bounds: visiblePolyline.length > 0 ? calculateBounds(visiblePolyline) : routeDetailWithArrivalTimes.bounds,
      polyline: visiblePolyline,
      stops: visibleStops
    };
  }, [hiddenStopIds, routeDetailWithArrivalTimes]);

  const routeSummariesForMap = useMemo<RouteSummaryDto[]>(() => {
    if (!routeDetailForMap) {
      return routeSummaries;
    }

    return routeSummaries.map((summary) => {
      if (
        summary.routeClusterId !== routeDetailForMap.routeClusterId ||
        summary.day !== routeDetailForMap.day
      ) {
        return summary;
      }

      return {
        ...summary,
        bounds: routeDetailForMap.bounds,
        polyline: routeDetailForMap.polyline,
        stops: routeDetailForMap.stops.map((stop) => ({
          stopClusterId: stop.stopClusterId,
          lat: stop.lat,
          lon: stop.lon
        }))
      };
    });
  }, [routeDetailForMap, routeSummaries]);
  return (
    <>
      <main className="screen-route-app flex h-screen w-screen flex-col overflow-hidden md:flex-row">
        <Sidebar
          topStops={topStops}
          routeClusterLimit={routeClusterLimit}
          days={days}
          months={months}
          selectedMonths={selectedMonths}
          dateRange={dateRange}
          routeClusters={routeClusters}
          routeNamesById={routeNamesById}
          persistentRouteClusterIds={persistentRouteClusterIds}
          selectedDay={selectedDay}
          selectedRouteClusterId={selectedRouteClusterId}
          routeDetail={routeDetailWithArrivalTimes}
          reviewComments={reviewComments}
          arrivalTimes={arrivalTimes}
          selectedStopId={selectedStopId}
          recentlyEditedStopId={recentlyEditedStopId}
          loadState={loadState}
          errorMessage={errorMessage}
          persistentRouteErrorMessage={persistentRouteErrorMessage}
          isPersistentRoutesUpdating={isPersistentRoutesUpdating}
          onSaveRouteName={saveRouteName}
          onDayChange={(day) => void loadDay(day)}
          onMonthsChange={(monthValues) => {
            if (selectedDay) {
              void loadDay(selectedDay, monthValues, undefined, topStops, routeClusterLimit, null);
            }
          }}
          onDateRangeApply={(range) => {
            if (selectedDay) {
              void loadDay(selectedDay, selectedMonths, undefined, topStops, routeClusterLimit, range);
            }
          }}
          onDateRangeClear={() => {
            if (selectedDay) {
              void loadDay(selectedDay, selectedMonths, undefined, topStops, routeClusterLimit, null);
            }
          }}
          onRouteClusterChange={(routeClusterId) =>
            void loadRoute(selectedDay, selectedMonths, routeClusterId, topStops, routeClusterLimit, undefined, dateRange)
          }
          onApplyDisplayLimits={(values) => {
            setTopStops(values.topStops);
            setRouteClusterLimit(values.routeClusterLimit);
            if (selectedDay) {
              void loadDay(
                selectedDay,
                selectedMonths,
                selectedRouteClusterId,
                values.topStops,
                values.routeClusterLimit,
                dateRange
              );
            }
          }}
          onAddPersistentRouteCluster={addPersistentRouteCluster}
          onRemovePersistentRouteCluster={removePersistentRouteCluster}
          onStopSelect={setSelectedStopId}
          onArrivalTimeChange={updateStopArrivalTime}
          hiddenStopIds={hiddenStopIds}
          onStopVisibilityToggle={toggleStopVisibility}
        />
        <section className="relative min-h-[52vh] flex-1 border-t border-line/80 bg-slate-100 md:min-h-0 md:border-l md:border-t-0">
          <RouteMap
            routeSummaries={routeSummariesForMap}
            routeDetail={routeDetailForMap}
            selectedStopId={selectedStopId}
            isLoading={loadState === "loading" || isPending}
            onRouteSelect={(routeClusterId, stopClusterId) =>
              void loadRoute(selectedDay, selectedMonths, routeClusterId, topStops, routeClusterLimit, stopClusterId)
            }
            onStopSelect={setSelectedStopId}
          />
        </section>
      </main>
      <PrintRouteSheet routeDetail={routeDetailForMap} arrivalTimes={arrivalTimes} />
    </>
  );
}

function buildRouteVisibilityKey(routeDetail: Pick<RouteDetailDto, "day" | "routeClusterId">) {
  return `${routeDetail.day}:${routeDetail.routeClusterId}`;
}

function PrintRouteSheet({
  routeDetail,
  arrivalTimes
}: {
  routeDetail: RouteDetailDto | null;
  arrivalTimes: Record<string, string>;
}) {
  const stops = routeDetail?.stops ?? [];
  const routeName = routeDetail ? removeRouteId(routeDetail.routeClusterName) : "";

  return (
    <section className="print-route-sheet" aria-hidden="true">
      {routeDetail ? (
        <>
          <header className="print-route-sheet__header">
            <div>
              <p className="print-route-sheet__eyebrow">Master Route Address List</p>
              <h1>{buildPrintRouteTitle(routeDetail.day, routeName)}</h1>
            </div>
            <dl className="print-route-sheet__summary" aria-label="Route summary">
              <div>
                <dt>Day</dt>
                <dd>{routeDetail.day}</dd>
              </div>
              <div>
                <dt>Route</dt>
                <dd>{routeName}</dd>
              </div>
              <div>
                <dt>Visible Stops</dt>
                <dd>{stops.length}</dd>
              </div>
            </dl>
          </header>

          {stops.length > 0 ? (
            <ol className="print-route-sheet__stops">
              {stops.map((stop) => (
                <li key={stop.stopClusterId} className="print-route-sheet__stop">
                  <span className="print-route-sheet__order">{stop.visitOrder}</span>
                  <div className="print-route-sheet__stop-body">
                    <div className="print-route-sheet__address">{stop.address}</div>
                    <div className="print-route-sheet__arrival-time">
                      Arrival time: {formatPrintArrivalTime(arrivalTimes[String(stop.stopClusterId)])}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="print-route-sheet__empty">No visible addresses are available for this route.</p>
          )}
        </>
      ) : (
        <p className="print-route-sheet__empty">No route is selected.</p>
      )}
    </section>
  );
}

function removeRouteId(routeClusterName: string) {
  return routeClusterName.replace(/\s+ID:\s*\d+\s*$/i, "").trim();
}

function buildPrintRouteTitle(day: string, routeName: string) {
  return `Addresses in order - ${day} / ${routeName}`;
}

function formatPrintArrivalTime(time: string | undefined) {
  if (!time) {
    return "Not set";
  }

  const [hourString, minuteString] = time.split(":");
  const hour = Number(hourString);
  const minute = Number(minuteString);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return time;
  }

  const hour12 = hour % 12 || 12;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
