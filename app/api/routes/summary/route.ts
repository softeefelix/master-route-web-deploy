import { NextRequest, NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { getRouteSummaries } from "@/lib/routes";
import { daySchema, monthsSchema, topStopsSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const dayParsed = daySchema.safeParse(request.nextUrl.searchParams.get("day"));
  const topStopsParsed = topStopsSchema.safeParse(request.nextUrl.searchParams.get("topStops") ?? "50");
  const monthsParsed = monthsSchema.safeParse(request.nextUrl.searchParams.getAll("month"));

  if (!dayParsed.success || !topStopsParsed.success || !monthsParsed.success) {
    return badRequest("Valid day, month, and topStops query parameters are required.");
  }

  try {
    const summaries = await getRouteSummaries(dayParsed.data, monthsParsed.data, topStopsParsed.data);
    return NextResponse.json(summaries);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load route summaries.");
  }
}
