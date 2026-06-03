"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  DayOption,
  MonthOption,
  PersistentRouteClusterDto,
  RouteClusterOption,
  RouteDetailDto,
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
  const [routeClusters, setRouteClusters] = useState<RouteClusterOption[]>([]);
  const [persistentRouteClusterIds, setPersistentRouteClusterIds] = useState<number[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedRouteClusterId, setSelectedRouteClusterId] = useState<number | null>(null);
  const [routeSummaries, setRouteSummaries] = useState<RouteSummaryDto[]>([]);
  const [routeDetail, setRouteDetail] = useState<RouteDetailDto | null>(null);
  const [arrivalTimes, setArrivalTimes] = useState<Record<string, string>>({});
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [recentlyEditedStopId, setRecentlyEditedStopId] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [persistentRouteErrorMessage, setPersistentRouteErrorMessage] = useState<string>("");
  const [isPersistentRoutesUpdating, setIsPersistentRoutesUpdating] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void initialize();
  }, []);

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

  async function loadDay(
    day: string,
    monthValues = selectedMonths,
    preferredRouteClusterId?: number | null,
    nextTopStops = topStops,
    nextRouteClusterLimit = routeClusterLimit
  ) {
    if (!day || monthValues.length === 0) {
      setSelectedDay(day);
      setSelectedMonths(monthValues);
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
      setSelectedStopId(null);
      setRecentlyEditedStopId(null);
    });

    try {
      const monthsQuery = buildMonthsQuery(monthValues);
      const [clusters, summaries] = await Promise.all([
        fetchJson<RouteClusterOption[]>(
          `/api/route-clusters?day=${encodeURIComponent(day)}&routeClusterLimit=${nextRouteClusterLimit}&${monthsQuery}`,
          { cache: "no-store" },
          "Unable to load route-cluster data for the selected day."
        ),
        fetchJson<RouteSummaryDto[]>(
          `/api/routes/summary?day=${encodeURIComponent(day)}&topStops=${nextTopStops}&routeClusterLimit=${nextRouteClusterLimit}&${monthsQuery}`,
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

      await loadRoute(day, monthValues, nextSelectedRouteClusterId, nextTopStops, nextRouteClusterLimit);
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
    preferredStopId?: number | null
  ) {
    startTransition(() => {
      setLoadState("loading");
      setSelectedRouteClusterId(routeClusterId);
      setSelectedMonths(monthValues);
      setSelectedStopId(preferredStopId ?? null);
      setRecentlyEditedStopId(null);
    });

    try {
      const monthsQuery = buildMonthsQuery(monthValues);
      const detail = await fetchJson<RouteDetailDto>(
        `/api/routes?day=${encodeURIComponent(day)}&routeClusterId=${routeClusterId}&topStops=${nextTopStops}&routeClusterLimit=${nextRouteClusterLimit}&${monthsQuery}`,
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

  const routeSummariesWithArrivalTimes = useMemo<RouteSummaryDto[]>(() => {
    if (!routeDetailWithArrivalTimes) {
      return routeSummaries;
    }

    return routeSummaries.map((summary) => {
      if (
        summary.routeClusterId !== routeDetailWithArrivalTimes.routeClusterId ||
        summary.day !== routeDetailWithArrivalTimes.day
      ) {
        return summary;
      }

      return {
        ...summary,
        bounds: routeDetailWithArrivalTimes.bounds,
        polyline: routeDetailWithArrivalTimes.polyline,
        stops: routeDetailWithArrivalTimes.stops.map((stop) => ({
          stopClusterId: stop.stopClusterId,
          lat: stop.lat,
          lon: stop.lon
        }))
      };
    });
  }, [routeDetailWithArrivalTimes, routeSummaries]);

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden md:flex-row">
      <Sidebar
        topStops={topStops}
        routeClusterLimit={routeClusterLimit}
        days={days}
        months={months}
        selectedMonths={selectedMonths}
        routeClusters={routeClusters}
        persistentRouteClusterIds={persistentRouteClusterIds}
        selectedDay={selectedDay}
        selectedRouteClusterId={selectedRouteClusterId}
        routeDetail={routeDetailWithArrivalTimes}
        arrivalTimes={arrivalTimes}
        selectedStopId={selectedStopId}
        recentlyEditedStopId={recentlyEditedStopId}
        loadState={loadState}
        errorMessage={errorMessage}
        persistentRouteErrorMessage={persistentRouteErrorMessage}
        isPersistentRoutesUpdating={isPersistentRoutesUpdating}
        onDayChange={(day) => void loadDay(day)}
        onMonthsChange={(monthValues) => {
          if (selectedDay) {
            void loadDay(selectedDay, monthValues);
          }
        }}
        onRouteClusterChange={(routeClusterId) =>
          void loadRoute(selectedDay, selectedMonths, routeClusterId, topStops, routeClusterLimit)
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
              values.routeClusterLimit
            );
          }
        }}
        onAddPersistentRouteCluster={addPersistentRouteCluster}
        onRemovePersistentRouteCluster={removePersistentRouteCluster}
        onStopSelect={setSelectedStopId}
        onArrivalTimeChange={updateStopArrivalTime}
      />
      <section className="relative min-h-[52vh] flex-1 border-t border-line/80 bg-slate-100 md:min-h-0 md:border-l md:border-t-0">
        <RouteMap
          routeSummaries={routeSummariesWithArrivalTimes}
          routeDetail={routeDetailWithArrivalTimes}
          selectedStopId={selectedStopId}
          isLoading={loadState === "loading" || isPending}
          onRouteSelect={(routeClusterId, stopClusterId) =>
            void loadRoute(selectedDay, selectedMonths, routeClusterId, topStops, routeClusterLimit, stopClusterId)
          }
          onStopSelect={setSelectedStopId}
        />
      </section>
    </main>
  );
}
