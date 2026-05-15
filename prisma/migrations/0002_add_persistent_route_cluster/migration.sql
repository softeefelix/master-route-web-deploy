CREATE TABLE IF NOT EXISTS "persistent_route_cluster" (
    "route_cluster_id" INTEGER NOT NULL,
    CONSTRAINT "persistent_route_cluster_pkey" PRIMARY KEY ("route_cluster_id"),
    CONSTRAINT "persistent_route_cluster_route_cluster_id_fkey"
      FOREIGN KEY ("route_cluster_id")
      REFERENCES "route_clusters"("route_cluster_id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE
);
