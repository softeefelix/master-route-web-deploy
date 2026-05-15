import { NextRequest, NextResponse } from "next/server";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import {
  addPersistentRouteCluster,
  getPersistentRouteClusters,
  removePersistentRouteCluster
} from "@/lib/persistent-route-clusters";
import { persistentRouteClusterIdSchema } from "@/lib/validators";

export async function GET() {
  try {
    const persistentRouteClusters = await getPersistentRouteClusters();
    return NextResponse.json(persistentRouteClusters);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load persistent route clusters.");
  }
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  const routeClusterId = parseRouteClusterId(body?.routeClusterId);

  if (routeClusterId == null) {
    return badRequest("A valid routeClusterId is required.");
  }

  try {
    const wasAdded = await addPersistentRouteCluster(routeClusterId);
    if (!wasAdded) {
      return NextResponse.json({ error: "Route cluster not found." }, { status: 404 });
    }

    const persistentRouteClusters = await getPersistentRouteClusters();
    return NextResponse.json(persistentRouteClusters);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to add persistent route cluster.");
  }
}

export async function DELETE(request: NextRequest) {
  const routeClusterId = parseRouteClusterId(request.nextUrl.searchParams.get("routeClusterId"));

  if (routeClusterId == null) {
    return badRequest("A valid routeClusterId is required.");
  }

  try {
    await removePersistentRouteCluster(routeClusterId);
    const persistentRouteClusters = await getPersistentRouteClusters();
    return NextResponse.json(persistentRouteClusters);
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to remove persistent route cluster.");
  }
}

async function parseJsonBody(request: NextRequest) {
  try {
    return (await request.json()) as { routeClusterId?: unknown };
  } catch {
    return null;
  }
}

function parseRouteClusterId(value: unknown) {
  if (value == null || (typeof value === "string" && value.trim().length === 0)) {
    return null;
  }

  const parsed = persistentRouteClusterIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
