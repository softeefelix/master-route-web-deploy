import { NextRequest, NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { getRouteClusterOptions } from "@/lib/routes";
import { daySchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const day = request.nextUrl.searchParams.get("day");
  const parsed = daySchema.safeParse(day);

  if (!parsed.success) {
    return badRequest("A valid day query parameter is required.");
  }

  try {
    const routeClusters = await getRouteClusterOptions(parsed.data);
    return NextResponse.json(routeClusters);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load route clusters.");
  }
}
