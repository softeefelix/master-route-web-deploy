import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PersistentRouteClusterDto } from "@/types/routes";

export async function getPersistentRouteClusters(): Promise<PersistentRouteClusterDto[]> {
  return prisma.$queryRaw<PersistentRouteClusterDto[]>(Prisma.sql`
    SELECT route_cluster_id AS "routeClusterId"
    FROM persistent_route_cluster
    ORDER BY route_cluster_id
  `);
}

export async function getPersistentRouteClusterIds() {
  const persistentRoutes = await getPersistentRouteClusters();
  return persistentRoutes.map((route) => route.routeClusterId);
}

export async function addPersistentRouteCluster(routeClusterId: number) {
  if (!(await routeClusterExists(routeClusterId))) {
    return false;
  }

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO persistent_route_cluster (route_cluster_id)
    VALUES (${routeClusterId})
    ON CONFLICT (route_cluster_id) DO NOTHING
  `);

  return true;
}

export async function removePersistentRouteCluster(routeClusterId: number) {
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM persistent_route_cluster
    WHERE route_cluster_id = ${routeClusterId}
  `);
}

async function routeClusterExists(routeClusterId: number) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM route_clusters
      WHERE route_cluster_id = ${routeClusterId}
    ) AS exists
  `);

  return rows[0]?.exists ?? false;
}
