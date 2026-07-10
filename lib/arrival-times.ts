import type { RouteStopDto } from "@/types/routes";

export type ArrivalTimesByStop = Record<string, string>;
export type RouteOverridesState = {
  arrivalTimes: ArrivalTimesByStop;
  hiddenStopIds: number[];
};

const ARRIVAL_TIME_KEY_PREFIX = "master-route-web:arrival-times:v1";
const ARRIVAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * MR25: overrides are persisted in the DB (route_stop_overrides) via
 * /api/stop-overrides so edits are durable and visible to every user and to
 * the print sheet. localStorage remains a read-through cache / offline
 * fallback only — the DB is the source of truth.
 */
export async function fetchRouteOverrides(
  routeClusterId: number,
  dow: string
): Promise<RouteOverridesState> {
  try {
    const response = await fetch(
      `/api/stop-overrides?day=${encodeURIComponent(dow)}&routeClusterId=${routeClusterId}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error(`stop-overrides ${response.status}`);
    }
    const dto = (await response.json()) as {
      overrides: Array<{ stopClusterId: number; arrivalTime: string | null; hidden: boolean }>;
    };
    const arrivalTimes: ArrivalTimesByStop = {};
    const hiddenStopIds: number[] = [];
    for (const override of dto.overrides) {
      if (override.arrivalTime && isArrivalTime(override.arrivalTime)) {
        arrivalTimes[String(override.stopClusterId)] = override.arrivalTime;
      }
      if (override.hidden) {
        hiddenStopIds.push(override.stopClusterId);
      }
    }
    writeArrivalTimesCache(routeClusterId, dow, arrivalTimes);
    return { arrivalTimes, hiddenStopIds };
  } catch {
    // Offline / API failure: fall back to the local cache (times only).
    return { arrivalTimes: getArrivalTimes(routeClusterId, dow), hiddenStopIds: [] };
  }
}

export async function persistStopOverride(
  routeClusterId: number,
  dow: string,
  stopClusterId: number,
  override: { arrivalTime: string | null; hidden: boolean }
): Promise<boolean> {
  try {
    const response = await fetch("/api/stop-overrides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeClusterId,
        day: dow,
        stopClusterId,
        arrivalTime: override.arrivalTime,
        hidden: override.hidden
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function getArrivalTimes(routeClusterId: number, dow: string): ArrivalTimesByStop {
  const storage = getLocalStorage();
  if (!storage) {
    return {};
  }

  try {
    const rawValue = storage.getItem(getArrivalTimesKey(routeClusterId, dow));
    if (!rawValue) {
      return {};
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      return {};
    }

    return Object.entries(parsedValue).reduce<ArrivalTimesByStop>((times, [stopClusterId, time]) => {
      if (typeof time === "string" && isArrivalTime(time)) {
        times[stopClusterId] = time;
      }

      return times;
    }, {});
  } catch {
    return {};
  }
}

export function sortStopsByArrivalTime<TStop extends Pick<RouteStopDto, "stopClusterId">>(
  stops: TStop[],
  savedTimes: ArrivalTimesByStop
) {
  return stops
    .map((stop, index) => ({
      stop,
      index,
      arrivalTime: getSavedArrivalTime(savedTimes, stop.stopClusterId)
    }))
    .sort((left, right) => {
      if (left.arrivalTime && right.arrivalTime) {
        if (left.arrivalTime !== right.arrivalTime) {
          return left.arrivalTime.localeCompare(right.arrivalTime);
        }

        return left.index - right.index;
      }

      if (left.arrivalTime) {
        return -1;
      }

      if (right.arrivalTime) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ stop }) => stop);
}

function getArrivalTimesKey(routeClusterId: number, dow: string) {
  return `${ARRIVAL_TIME_KEY_PREFIX}:route_cluster:${routeClusterId}:dow:${dow}`;
}

function getSavedArrivalTime(savedTimes: ArrivalTimesByStop, stopClusterId: number) {
  const time = savedTimes[String(stopClusterId)];
  return isArrivalTime(time) ? time : null;
}

export function isArrivalTime(time: unknown): time is string {
  return typeof time === "string" && ARRIVAL_TIME_PATTERN.test(time);
}

function writeArrivalTimesCache(routeClusterId: number, dow: string, times: ArrivalTimesByStop) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const key = getArrivalTimesKey(routeClusterId, dow);
    if (Object.keys(times).length === 0) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, JSON.stringify(times));
  } catch {
    return;
  }
}

function getLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
