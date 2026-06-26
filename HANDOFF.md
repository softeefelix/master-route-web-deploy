# Project Handoff

This project is a standalone Next.js application for exploring master route clusters on a Leaflet map. It uses Prisma against a PostgreSQL/PostGIS database and is intended to show route clusters, selected route details, stop ordering, sales/visit metrics, and persistent route selections.

## Current Repository State

- Main app: `app/components/MasterRoutesApp.tsx`
- Map UI: `app/components/RouteMap.tsx`
- Sidebar/filter UI: `app/components/Sidebar.tsx`
- Data access and route ordering: `lib/routes.ts`
- Persistent route cluster helpers: `lib/persistent-route-clusters.ts`
- Client-only arrival time storage: `lib/arrival-times.ts`
- API routes: `app/api/**/route.ts`
- Prisma schema and migrations: `prisma/`
- Seed data and import script: `data/master-routes-address/jan2026_master_routes_with_addresses.csv`, `scripts/seed.ts`

At handoff time the working tree already contains uncommitted changes in several app files plus generated/local files such as `.DS_Store`, `app/.DS_Store`, and `tsconfig.tsbuildinfo`. Treat those as existing work-in-progress and review them before committing or cleaning anything.

## Tech Stack

- Next.js 15 App Router
- React 19
- TypeScript
- Tailwind CSS
- Leaflet and React Leaflet
- Prisma 5
- PostgreSQL with PostGIS enabled
- Zod for API query validation

## Required Environment

Create a local env file with:

```bash
DATABASE_URL="postgresql://..."
```

Optional:

```bash
PIPELINE_RUN_ID_OVERRIDE="123"
SEED_SOURCE_CSV="/absolute/path/to/file.csv"
```

`PIPELINE_RUN_ID_OVERRIDE` is useful for local pipeline testing. Without it, the app uses the newest `pipeline_runs` row with `status = 'ACTIVE'`, ordered by `activated_at` and then ID.

## Common Commands

```bash
npm install
npx prisma generate
npm run dev
npm run build
npm run start
npm run seed
npx prisma migrate dev
```

The app runs at `http://localhost:3000` during development.

There is a `lint` script, but `next lint` has been removed from newer Next.js versions. Verify whether `npm run lint` still works before relying on it.

## Database Expectations

The Prisma schema models:

- `pipeline_runs`
- `route_clusters`
- `stop_clusters`
- `stop_scores`
- `persistent_route_cluster`

The live route queries also reference `sale_stops`, which is not modeled in `prisma/schema.prisma`. This table must exist in the target database for month filtering, sales totals, visit counts, and past arrival windows to work.

PostGIS must be enabled for a fresh database:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Migrations in this repo create the core route/stop/pipeline tables and the `persistent_route_cluster` table. The seed script imports the bundled CSV into the modeled tables and archives any previous active pipeline run, but it does not create or populate `sale_stops`.

## App Behavior

On load, `MasterRoutesApp` fetches:

- available days from `/api/days`
- available months from `/api/months`
- persistent route cluster IDs from `/api/persistent-route-clusters`

It then selects the first available day and all available months, loads route cluster options and route summaries, and displays the first route unless `routeClusterId` is present in the URL.

Primary UI features:

- Day filter
- Month filter
- Route cluster selector
- Top stops limit
- Regular route cluster limit
- Persistent route cluster add/remove
- Map and sidebar route selection sync
- Manual arrival time entry per stop
- Stop hiding for the current route view

Manual arrival times are stored only in browser `localStorage` under keys prefixed with `master-route-web:arrival-times:v1`. They are not persisted to the database.

Persistent route clusters are stored in the database and are always included in visible routes in addition to the configured regular route limit.

## API Surface

- `GET /api/days`
- `GET /api/months`
- `GET /api/route-clusters?day=Monday&month=1&routeClusterLimit=17`
- `GET /api/routes/summary?day=Monday&month=1&topStops=50&routeClusterLimit=17`
- `GET /api/routes?day=Monday&month=1&routeClusterId=1&topStops=50&routeClusterLimit=17`
- `GET /api/persistent-route-clusters`
- `POST /api/persistent-route-clusters` with JSON `{ "routeClusterId": 123 }`
- `DELETE /api/persistent-route-clusters?routeClusterId=123`

Most API routes return `400` for invalid query parameters, `503` for likely database connectivity issues, and `500` for unexpected server failures.

## Route Calculation Notes

Route data is built in `lib/routes.ts`.

- Active pipeline run is selected first.
- Route clusters are loaded for the selected day.
- Seasonal stop rows are aggregated from `sale_stops` for selected months.
- Route clusters are ranked by total sales amount.
- Persistent clusters are included first.
- Remaining visible clusters are selected up to `DEFAULT_ROUTE_CLUSTER_LIMIT` or the user-selected limit.
- Stops are scored from normalized sales and visit frequency.
- The app takes the top N stops, then orders them with a simple distance heuristic:
  - start at the stop farthest from the route centroid
  - repeatedly pick the nearest remaining stop

Route names are derived in `lib/utils.ts`, based on stop address/city information.

## Deployment

`render.yaml` defines a Render web service:

- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm run start`
- Required env var: `DATABASE_URL`

`npm run build` runs `prisma generate && next build`.

## Important Files To Read First

1. `README.md` for baseline setup.
2. `app/components/MasterRoutesApp.tsx` for page state and data flow.
3. `lib/routes.ts` for query behavior and route ordering.
4. `prisma/schema.prisma` for the modeled database shape.
5. `app/api/**/route.ts` for request validation and API responses.
6. `app/components/Sidebar.tsx` and `app/components/RouteMap.tsx` for user-facing behavior.

## Known Risks And Follow-Ups

- Confirm the current uncommitted changes before making broad edits. Some generated files are present and may need `.gitignore` updates.
- `sale_stops` is required by `lib/routes.ts` but is not in the Prisma schema or migrations.
- The seed script is useful for demo data, but it does not populate `sale_stops`, so full current route behavior may need a production-like database.
- `next lint` may not work with Next.js 15; consider adding an ESLint config and updating the script.
- There are no obvious automated tests. Add focused tests around route ranking, persistent cluster selection, API validation, and arrival-time sorting before changing route logic.
- API routes assume database connectivity. Keep the existing unavailable-database handling when adding endpoints.
- Arrival-time edits are local to the browser. If users need shared arrival plans, design a database-backed model instead of extending `localStorage`.
- Persistent route clusters are global, not per user or per pipeline run. Revisit this if multiple users or active runs are expected.

## Suggested Next Development Steps

1. Run `npm run build` against a configured database to establish a clean baseline.
2. Decide whether generated/local files should be ignored, committed, or removed.
3. Add or document the `sale_stops` schema and data source.
4. Add tests for `lib/routes.ts` and `lib/arrival-times.ts`.
5. Update the README to match the newer month, persistent route, and hidden stop features.
