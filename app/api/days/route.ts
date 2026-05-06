import { NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { getDays } from "@/lib/routes";
import { serverError, serviceUnavailable } from "@/lib/http";

export async function GET() {
  try {
    const days = await getDays();
    return NextResponse.json(days);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load days.");
  }
}
