import { NextRequest, NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { getRouteClusterOptions } from "@/lib/routes";
import { daySchema, monthsSchema, parseOptionalDateRange, routeClusterLimitSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const day = request.nextUrl.searchParams.get("day");
  const dayParsed = daySchema.safeParse(day);
  const monthsParsed = monthsSchema.safeParse(request.nextUrl.searchParams.getAll("month"));
  const routeClusterLimitParsed = routeClusterLimitSchema.safeParse(
    request.nextUrl.searchParams.get("routeClusterLimit") ?? undefined
  );
  const dateRangeParsed = parseOptionalDateRange(
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to")
  );

  if (!dateRangeParsed.success) {
    return badRequest(dateRangeParsed.error);
  }

  // Months are only required when no date range is supplied.
  const monthsRequiredAndInvalid = dateRangeParsed.data === undefined && !monthsParsed.success;

  if (!dayParsed.success || monthsRequiredAndInvalid || !routeClusterLimitParsed.success) {
    return badRequest("Valid day, month (or from/to), and routeClusterLimit query parameters are required.");
  }

  try {
    const routeClusters = await getRouteClusterOptions(
      dayParsed.data,
      monthsParsed.success ? monthsParsed.data : [],
      routeClusterLimitParsed.data,
      dateRangeParsed.data
    );
    return NextResponse.json(routeClusters);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load route clusters.");
  }
}
