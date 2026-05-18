import type { RouteStopDto } from "@/types/routes";

export type ArrivalTimesByStop = Record<string, string>;

const ARRIVAL_TIME_KEY_PREFIX = "master-route-web:arrival-times:v1";
const ARRIVAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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

export function saveArrivalTime(
  routeClusterId: number,
  dow: string,
  stopClusterId: number,
  time: string
) {
  if (!isArrivalTime(time)) {
    return;
  }

  writeArrivalTimes(routeClusterId, dow, {
    ...getArrivalTimes(routeClusterId, dow),
    [String(stopClusterId)]: time
  });
}

export function clearArrivalTime(routeClusterId: number, dow: string, stopClusterId: number) {
  const currentTimes = getArrivalTimes(routeClusterId, dow);
  delete currentTimes[String(stopClusterId)];
  writeArrivalTimes(routeClusterId, dow, currentTimes);
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

function isArrivalTime(time: unknown): time is string {
  return typeof time === "string" && ARRIVAL_TIME_PATTERN.test(time);
}

function writeArrivalTimes(routeClusterId: number, dow: string, times: ArrivalTimesByStop) {
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
