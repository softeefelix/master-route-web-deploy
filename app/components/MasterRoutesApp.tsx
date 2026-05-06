"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";
import type { DayOption, MonthOption, RouteClusterOption, RouteDetailDto, RouteSummaryDto } from "@/types/routes";
import { Sidebar } from "@/app/components/Sidebar";
import { fetchJson } from "@/lib/api";

const RouteMap = dynamic(() => import("@/app/components/RouteMap").then((mod) => mod.RouteMap), {
  ssr: false
});

type LoadState = "idle" | "loading" | "ready" | "error";

export function MasterRoutesApp() {
  const [topStops, setTopStops] = useState<number>(50);
  const [days, setDays] = useState<DayOption[]>([]);
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [routeClusters, setRouteClusters] = useState<RouteClusterOption[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedRouteClusterId, setSelectedRouteClusterId] = useState<number | null>(null);
  const [routeSummaries, setRouteSummaries] = useState<RouteSummaryDto[]>([]);
  const [routeDetail, setRouteDetail] = useState<RouteDetailDto | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    try {
      setLoadState("loading");
      setErrorMessage("");

      const availableDays = await fetchJson<DayOption[]>(
        "/api/days",
        { cache: "no-store" },
        "Unable to load available days."
      );
      const availableMonths = await fetchJson<MonthOption[]>(
        "/api/months",
        { cache: "no-store" },
        "Unable to load available months."
      );
      setDays(availableDays);
      setMonths(availableMonths);

      const firstDay = availableDays[0]?.value;
      const initialMonths = availableMonths.map((month) => month.value);

      if (!firstDay || initialMonths.length === 0) {
        setLoadState("ready");
        return;
      }

      setSelectedMonths(initialMonths);
      await loadDay(firstDay, initialMonths, undefined, topStops);
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
    nextTopStops = topStops
  ) {
    if (!day || monthValues.length === 0) {
      setSelectedDay(day);
      setSelectedMonths(monthValues);
      setRouteClusters([]);
      setRouteSummaries([]);
      setRouteDetail(null);
      setSelectedRouteClusterId(null);
      setSelectedStopId(null);
      setLoadState("ready");
      return;
    }

    startTransition(() => {
      setLoadState("loading");
      setSelectedDay(day);
      setSelectedMonths(monthValues);
      setSelectedStopId(null);
    });

    try {
      const monthsQuery = buildMonthsQuery(monthValues);
      const [clusters, summaries] = await Promise.all([
        fetchJson<RouteClusterOption[]>(
          `/api/route-clusters?day=${encodeURIComponent(day)}&${monthsQuery}`,
          { cache: "no-store" },
          "Unable to load route-cluster data for the selected day."
        ),
        fetchJson<RouteSummaryDto[]>(
          `/api/routes/summary?day=${encodeURIComponent(day)}&topStops=${nextTopStops}&${monthsQuery}`,
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
        setLoadState("ready");
        return;
      }

      await loadRoute(day, monthValues, nextSelectedRouteClusterId, nextTopStops);
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
    preferredStopId?: number | null
  ) {
    startTransition(() => {
      setLoadState("loading");
      setSelectedRouteClusterId(routeClusterId);
      setSelectedMonths(monthValues);
      setSelectedStopId(preferredStopId ?? null);
    });

    try {
      const monthsQuery = buildMonthsQuery(monthValues);
      const detail = await fetchJson<RouteDetailDto>(
        `/api/routes?day=${encodeURIComponent(day)}&routeClusterId=${routeClusterId}&topStops=${nextTopStops}&${monthsQuery}`,
        { cache: "no-store" },
        "Unable to load the selected route cluster."
      );
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

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden md:flex-row">
      <Sidebar
        topStops={topStops}
        days={days}
        months={months}
        selectedMonths={selectedMonths}
        routeClusters={routeClusters}
        selectedDay={selectedDay}
        selectedRouteClusterId={selectedRouteClusterId}
        routeDetail={routeDetail}
        selectedStopId={selectedStopId}
        loadState={loadState}
        errorMessage={errorMessage}
        onDayChange={(day) => void loadDay(day)}
        onMonthsChange={(monthValues) => {
          if (selectedDay) {
            void loadDay(selectedDay, monthValues);
          }
        }}
        onRouteClusterChange={(routeClusterId) => void loadRoute(selectedDay, selectedMonths, routeClusterId)}
        onApplyTopStops={(value) => {
          setTopStops(value);
          if (selectedDay) {
            void loadDay(selectedDay, selectedMonths, selectedRouteClusterId, value);
          }
        }}
        onStopSelect={setSelectedStopId}
      />
      <section className="relative min-h-[52vh] flex-1 border-t border-line/80 bg-slate-100 md:min-h-0 md:border-l md:border-t-0">
        <RouteMap
          routeSummaries={routeSummaries}
          routeDetail={routeDetail}
          selectedStopId={selectedStopId}
          isLoading={loadState === "loading" || isPending}
          onRouteSelect={(routeClusterId, stopClusterId) =>
            void loadRoute(selectedDay, selectedMonths, routeClusterId, topStops, stopClusterId)
          }
          onStopSelect={setSelectedStopId}
        />
      </section>
    </main>
  );
}
