import { NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { serverError, serviceUnavailable } from "@/lib/http";
import { getMonths } from "@/lib/routes";

export async function GET() {
  try {
    const months = await getMonths();
    return NextResponse.json(months);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load months.");
  }
}
