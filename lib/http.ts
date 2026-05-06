import { NextResponse } from "next/server";

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serviceUnavailable(message: string) {
  return NextResponse.json({ error: message }, { status: 503 });
}

export function serverError(message = "Unexpected server error.") {
  return NextResponse.json({ error: message }, { status: 500 });
}
