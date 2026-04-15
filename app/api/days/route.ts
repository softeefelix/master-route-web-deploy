import { NextResponse } from "next/server";
import { getDays } from "@/lib/routes";
import { serverError } from "@/lib/http";

export async function GET() {
  try {
    const days = await getDays();
    return NextResponse.json(days);
  } catch (error) {
    console.error(error);
    return serverError("Unable to load days.");
  }
}
