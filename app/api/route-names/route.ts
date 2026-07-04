import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDatabaseUnavailableError } from "@/lib/errors";
import { badRequest, serverError, serviceUnavailable } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type RouteNameDto = {
  routeClusterId: number;
  name: string;
  status: string;
  aliases: string[];
  updatedBy: string;
  updatedAt: string;
};

function toDto(row: {
  routeClusterId: number;
  name: string;
  status: string;
  aliases: string[];
  updatedBy: string;
  updatedAt: Date;
}): RouteNameDto {
  return {
    routeClusterId: row.routeClusterId,
    name: row.name,
    status: row.status,
    aliases: row.aliases,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function GET() {
  try {
    const rows = await prisma.routeName.findMany({
      orderBy: { routeClusterId: "asc" }
    });
    return NextResponse.json(rows.map(toDto));
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to load route names.");
  }
}

const patchSchema = z.object({
  routeClusterId: z.coerce.number().int().nonnegative(),
  name: z
    .string()
    .trim()
    .min(1, "Name must be between 1 and 64 characters.")
    .max(64, "Name must be between 1 and 64 characters.")
    .refine((value) => !value.includes(","), "Name must not contain commas."),
  updatedBy: z.string().trim().min(1, "Editor name must be between 1 and 32 characters.").max(32, "Editor name must be between 1 and 32 characters.")
});

export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const { routeClusterId, name, updatedBy } = parsed.data;

  try {
    const existing = await prisma.routeName.findUnique({
      where: { routeClusterId }
    });

    let updated;
    if (!existing) {
      updated = await prisma.routeName.create({
        data: {
          routeClusterId,
          name,
          status: "provisional",
          aliases: [],
          updatedBy
        }
      });
    } else {
      const aliases = [...existing.aliases];
      if (existing.name !== name && !aliases.includes(existing.name)) {
        aliases.push(existing.name);
      }
      updated = await prisma.routeName.update({
        where: { routeClusterId },
        data: {
          name,
          aliases,
          updatedBy,
          updatedAt: new Date()
        }
      });
    }

    return NextResponse.json(toDto(updated));
  } catch (error) {
    console.error(error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `The name "${name}" is already used by another route.` },
        { status: 409 }
      );
    }
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable("Data is temporarily unavailable because the database connection failed. Please retry in a moment.");
    }
    return serverError("Unable to update route name.");
  }
}
