import { NextRequest, NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/http";
import { getRouteDetail } from "@/lib/routes";
import { daySchema, routeClusterIdSchema, topStopsSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const dayParsed = daySchema.safeParse(request.nextUrl.searchParams.get("day"));
  const routeClusterParsed = routeClusterIdSchema.safeParse(
    request.nextUrl.searchParams.get("routeClusterId")
  );
  const topStopsParsed = topStopsSchema.safeParse(request.nextUrl.searchParams.get("topStops") ?? "50");

  if (!dayParsed.success || !routeClusterParsed.success || !topStopsParsed.success) {
    return badRequest("Valid day, routeClusterId, and topStops query parameters are required.");
  }

  try {
    const route = await getRouteDetail(dayParsed.data, routeClusterParsed.data, topStopsParsed.data);

    if (!route) {
      return NextResponse.json({ error: "Route not found." }, { status: 404 });
    }

    return NextResponse.json(route);
  } catch (error) {
    console.error(error);
    return serverError("Unable to load route details.");
  }
}
