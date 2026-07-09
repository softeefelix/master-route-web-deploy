import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { daySchema, routeClusterIdSchema } from "@/lib/validators";

export type RouteReviewCommentsDto = {
  routeClusterId: number;
  day: string;
  comments: string[];
  generatedAt: string | null;
};

export async function GET(request: NextRequest) {
  const dayParsed = daySchema.safeParse(request.nextUrl.searchParams.get("day"));
  const routeClusterParsed = routeClusterIdSchema.safeParse(
    request.nextUrl.searchParams.get("routeClusterId")
  );

  if (!dayParsed.success || !routeClusterParsed.success) {
    return badRequest("Valid day and routeClusterId query parameters are required.");
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{ comments: unknown; generated_at: Date }>
    >(Prisma.sql`
      SELECT comments, generated_at
      FROM route_review_comments
      WHERE route_cluster_id = ${routeClusterParsed.data} AND dow = ${dayParsed.data}
      LIMIT 1
    `);

    const row = rows[0];
    const dto: RouteReviewCommentsDto = {
      routeClusterId: routeClusterParsed.data,
      day: dayParsed.data,
      comments: Array.isArray(row?.comments)
        ? (row.comments as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
      generatedAt: row ? row.generated_at.toISOString() : null
    };
    return NextResponse.json(dto);
  } catch (error) {
    // Table may not exist yet on a fresh DB — treat as "no comments".
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
      return NextResponse.json({
        routeClusterId: routeClusterParsed.data,
        day: dayParsed.data,
        comments: [],
        generatedAt: null
      });
    }
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable(
        "Data is temporarily unavailable because the database connection failed. Please retry in a moment."
      );
    }
    return serverError("Unable to load route review comments.");
  }
}
