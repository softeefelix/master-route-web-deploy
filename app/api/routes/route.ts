import { NextRequest, NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { getRouteDetail } from "@/lib/routes";
import {
  daySchema,
  monthsSchema,
  parseOptionalDateRange,
  routeClusterIdSchema,
  routeClusterLimitSchema,
  topStopsSchema
} from "@/lib/validators";

export async function GET(request: NextRequest) {
  const dayParsed = daySchema.safeParse(request.nextUrl.searchParams.get("day"));
  const routeClusterParsed = routeClusterIdSchema.safeParse(
    request.nextUrl.searchParams.get("routeClusterId")
  );
  const topStopsParsed = topStopsSchema.safeParse(request.nextUrl.searchParams.get("topStops") ?? undefined);
  const routeClusterLimitParsed = routeClusterLimitSchema.safeParse(
    request.nextUrl.searchParams.get("routeClusterLimit") ?? undefined
  );
  const monthsParsed = monthsSchema.safeParse(request.nextUrl.searchParams.getAll("month"));
  const dateRangeParsed = parseOptionalDateRange(
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to")
  );

  if (!dateRangeParsed.success) {
    return badRequest(dateRangeParsed.error);
  }

  const monthsRequiredAndInvalid = dateRangeParsed.data === undefined && !monthsParsed.success;

  if (
    !dayParsed.success ||
    !routeClusterParsed.success ||
    !topStopsParsed.success ||
    !routeClusterLimitParsed.success ||
    monthsRequiredAndInvalid
  ) {
    return badRequest(
      "Valid day, month (or from/to), routeClusterId, topStops, and routeClusterLimit query parameters are required."
    );
  }

  try {
    const route = await getRouteDetail(
      dayParsed.data,
      monthsParsed.success ? monthsParsed.data : [],
      routeClusterParsed.data,
      topStopsParsed.data,
      routeClusterLimitParsed.data,
      dateRangeParsed.data
    );

    if (!route) {
      return NextResponse.json({ error: "Route not found." }, { status: 404 });
    }

    return NextResponse.json(route);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load route details.");
  }
}
