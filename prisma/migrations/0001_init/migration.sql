CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE "route_clusters" (
    "route_cluster_id" SERIAL NOT NULL,
    "centroid_lat" DOUBLE PRECISION NOT NULL,
    "centroid_long" DOUBLE PRECISION NOT NULL,
    "radius" DOUBLE PRECISION NOT NULL,
    "n_route_runs" INTEGER NOT NULL,
    "n_signature_stops" INTEGER NOT NULL,
    "stop_freq" JSONB NOT NULL,
    "dow" VARCHAR(10) NOT NULL,
    CONSTRAINT "route_clusters_pkey" PRIMARY KEY ("route_cluster_id")
);

CREATE TABLE "stop_clusters" (
    "stop_cluster_id" INTEGER NOT NULL,
    "centroid_lat" DOUBLE PRECISION NOT NULL,
    "centroid_long" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    CONSTRAINT "stop_clusters_pkey" PRIMARY KEY ("stop_cluster_id")
);

CREATE TABLE "stop_scores" (
    "stop_cluster_id" INTEGER NOT NULL,
    "route_cluster_id" INTEGER NOT NULL,
    "dow" VARCHAR(10) NOT NULL,
    "total_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "sales_norm" DOUBLE PRECISION,
    "visits_norm" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "last_updated" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stop_scores_pkey" PRIMARY KEY ("stop_cluster_id","route_cluster_id","dow")
);

CREATE INDEX "route_clusters_dow_route_cluster_id_idx" ON "route_clusters"("dow", "route_cluster_id");
CREATE INDEX "stop_scores_dow_route_cluster_id_idx" ON "stop_scores"("dow", "route_cluster_id");

ALTER TABLE "stop_scores"
ADD CONSTRAINT "stop_scores_stop_cluster_id_fkey"
FOREIGN KEY ("stop_cluster_id") REFERENCES "stop_clusters"("stop_cluster_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stop_scores"
ADD CONSTRAINT "stop_scores_route_cluster_id_fkey"
FOREIGN KEY ("route_cluster_id") REFERENCES "route_clusters"("route_cluster_id") ON DELETE RESTRICT ON UPDATE CASCADE;
