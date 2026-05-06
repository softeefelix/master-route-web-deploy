"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";
import type { DayOption, RouteClusterOption, RouteDetailDto, RouteSummaryDto } from "@/types/routes";
import { Sidebar } from "@/app/components/Sidebar";
import { fetchJson } from "@/lib/api";

const RouteMap = dynamic(() => import("@/app/components/RouteMap").then((mod) => mod.RouteMap), {
  ssr: false
});

type LoadState = "idle" | "loading" | "ready" | "error";

export function MasterRoutesApp() {
  const [topStops, setTopStops] = useState<number>(50);
  const [days, setDays] = useState<DayOption[]>([]);
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
      setDays(availableDays);

      const firstDay = availableDays[0]?.value;
      if (!firstDay) {
        setLoadState("ready");
        return;
      }

      await loadDay(firstDay, undefined, topStops);
    } catch (error) {
      console.error(error);
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unexpected error");
    }
  }

  async function loadDay(day: string, preferredRouteClusterId?: number | null, nextTopStops = topStops) {
    startTransition(() => {
      setLoadState("loading");
      setSelectedDay(day);
      setSelectedStopId(null);
    });

    try {
      const [clusters, summaries] = await Promise.all([
        fetchJson<RouteClusterOption[]>(
          `/api/route-clusters?day=${encodeURIComponent(day)}`,
          { cache: "no-store" },
          "Unable to load route-cluster data for the selected day."
        ),
        fetchJson<RouteSummaryDto[]>(
          `/api/routes/summary?day=${encodeURIComponent(day)}&topStops=${nextTopStops}`,
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

      await loadRoute(day, nextSelectedRouteClusterId, nextTopStops);
    } catch (error) {
      console.error(error);
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unexpected error");
    }
  }

  async function loadRoute(
    day: string,
    routeClusterId: number,
    nextTopStops = topStops,
    preferredStopId?: number | null
  ) {
    startTransition(() => {
      setLoadState("loading");
      setSelectedRouteClusterId(routeClusterId);
      setSelectedStopId(preferredStopId ?? null);
    });

    try {
      const detail = await fetchJson<RouteDetailDto>(
        `/api/routes?day=${encodeURIComponent(day)}&routeClusterId=${routeClusterId}&topStops=${nextTopStops}`,
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
        routeClusters={routeClusters}
        selectedDay={selectedDay}
        selectedRouteClusterId={selectedRouteClusterId}
        routeDetail={routeDetail}
        selectedStopId={selectedStopId}
        loadState={loadState}
        errorMessage={errorMessage}
        onDayChange={(day) => void loadDay(day)}
        onRouteClusterChange={(routeClusterId) => void loadRoute(selectedDay, routeClusterId)}
        onApplyTopStops={(value) => {
          setTopStops(value);
          if (selectedDay) {
            void loadDay(selectedDay, selectedRouteClusterId, value);
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
            void loadRoute(selectedDay, routeClusterId, topStops, stopClusterId)
          }
          onStopSelect={setSelectedStopId}
        />
      </section>
    </main>
  );
}
