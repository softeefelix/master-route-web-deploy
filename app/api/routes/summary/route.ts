import { NextRequest, NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/http";
import { getRouteSummaries } from "@/lib/routes";
import { daySchema, topStopsSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const dayParsed = daySchema.safeParse(request.nextUrl.searchParams.get("day"));
  const topStopsParsed = topStopsSchema.safeParse(request.nextUrl.searchParams.get("topStops") ?? "50");

  if (!dayParsed.success || !topStopsParsed.success) {
    return badRequest("Valid day and topStops query parameters are required.");
  }

  try {
    const summaries = await getRouteSummaries(dayParsed.data, topStopsParsed.data);
    return NextResponse.json(summaries);
  } catch (error) {
    console.error(error);
    return serverError("Unable to load route summaries.");
  }
}
