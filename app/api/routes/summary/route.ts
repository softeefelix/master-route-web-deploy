import { NextRequest, NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { getRouteSummaries } from "@/lib/routes";
import { daySchema, monthsSchema, routeClusterLimitSchema, topStopsSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const dayParsed = daySchema.safeParse(request.nextUrl.searchParams.get("day"));
  const topStopsParsed = topStopsSchema.safeParse(request.nextUrl.searchParams.get("topStops") ?? undefined);
  const routeClusterLimitParsed = routeClusterLimitSchema.safeParse(
    request.nextUrl.searchParams.get("routeClusterLimit") ?? undefined
  );
  const monthsParsed = monthsSchema.safeParse(request.nextUrl.searchParams.getAll("month"));

  if (!dayParsed.success || !topStopsParsed.success || !routeClusterLimitParsed.success || !monthsParsed.success) {
    return badRequest("Valid day, month, topStops, and routeClusterLimit query parameters are required.");
  }

  try {
    const summaries = await getRouteSummaries(
      dayParsed.data,
      monthsParsed.data,
      topStopsParsed.data,
      routeClusterLimitParsed.data
    );
    return NextResponse.json(summaries);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load route summaries.");
  }
}
