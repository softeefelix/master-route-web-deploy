import { NextRequest, NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { getRouteClusterOptions } from "@/lib/routes";
import { daySchema, monthsSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const day = request.nextUrl.searchParams.get("day");
  const dayParsed = daySchema.safeParse(day);
  const monthsParsed = monthsSchema.safeParse(request.nextUrl.searchParams.getAll("month"));

  if (!dayParsed.success || !monthsParsed.success) {
    return badRequest("Valid day and month query parameters are required.");
  }

  try {
    const routeClusters = await getRouteClusterOptions(dayParsed.data, monthsParsed.data);
    return NextResponse.json(routeClusters);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load route clusters.");
  }
}
