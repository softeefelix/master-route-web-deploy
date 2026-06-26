# Master Route Web

Standalone Next.js app for exploring master route clusters on a Leaflet map with a PostgreSQL/PostGIS backend.

## What Is In This Repo

- `app/`: Next.js App Router pages, API routes, and UI components
- `lib/`: Prisma-backed data access, route ordering, naming, and shared helpers
- `prisma/`: schema and migration files
- `scripts/seed.ts`: optional CSV import for a fresh database
- `data/master-routes-address/jan2026_master_routes_with_addresses.csv`: seed CSV used by the import script
- `SQL/postgis_setup.sql`: one-line PostGIS enablement helper
- `HANDOFF.md`: deeper project notes for future maintainers and AI agents

## Main Behavior

- Two-panel layout with route filters on the left and Leaflet map on the right
- Day, month, and route-cluster filters
- Top-stops filter that limits each route to its highest-scoring stops
- Route-cluster limit for controlling how many ranked route clusters are shown
- Persistent route clusters that remain visible even outside the regular route limit
- Selected route sync between map and sidebar
- Manual arrival-time edits stored in browser `localStorage`
- Stop hiding for the current route view
- Start and finish pin markers on the selected route
- Route names derived from the highest-scoring stop's city

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create env file

```bash
cp .env.local.example .env.local
```

If there is no example file, create `.env.local` manually:

```bash
DATABASE_URL="postgresql://..."
```

3. Point `DATABASE_URL` at your existing database in `.env.local`

4. Generate Prisma client

```bash
npx prisma generate
```

5. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional local environment variables:

```bash
PIPELINE_RUN_ID_OVERRIDE="123"
SEED_SOURCE_CSV="/absolute/path/to/file.csv"
```

`PIPELINE_RUN_ID_OVERRIDE` lets you test a specific pipeline run. Without it, the app uses the newest `pipeline_runs` row with `status = 'ACTIVE'`.

## Fresh Database Setup

If you are creating a brand-new database instead of reusing an existing one:

1. Enable PostGIS

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

2. Run migrations

```bash
npx prisma migrate dev --name init
```

3. Optionally seed data

```bash
npm run seed
```

The current route queries also reference a `sale_stops` table that is not modeled in `prisma/schema.prisma`. A production-like database must include that table for month filtering, sales totals, visit counts, and past arrival windows to work. The bundled seed script imports the CSV into the modeled route/stop tables, but it does not populate `sale_stops`.

## Useful Commands

```bash
npm run dev
npm run build
npm run start
npm run seed
npx prisma generate
npx prisma migrate dev
```

`npm run build` runs `prisma generate && next build`.

The `lint` script currently calls `next lint`, which may not work with newer Next.js versions. Verify it before relying on it in CI.

## API Routes

- `GET /api/days`
- `GET /api/months`
- `GET /api/route-clusters?day=Monday&month=1&routeClusterLimit=17`
- `GET /api/routes/summary?day=Monday&month=1&topStops=50&routeClusterLimit=17`
- `GET /api/routes?day=Monday&month=1&routeClusterId=1&topStops=50&routeClusterLimit=17`
- `GET /api/persistent-route-clusters`
- `POST /api/persistent-route-clusters` with JSON `{ "routeClusterId": 123 }`
- `DELETE /api/persistent-route-clusters?routeClusterId=123`

## Render Deployment

A simple standalone Render setup is:

- Runtime: `Node`
- Build command: `npm install && npm run build`
- Start command: `npm run start`

Set this environment variable in Render:

- `DATABASE_URL`

If you want to use the included blueprint file:

```bash
render blueprint launch
```

with the included `render.yaml`.

## Suggested GitHub Repo Flow

From the parent `render-python` directory:

```bash
cd master-route-web
git init
git add .
git commit -m "Initial standalone master route web app"
git branch -M main
git remote add origin <your-new-repo-url>
git push -u origin main
```

## Notes

- See `HANDOFF.md` before continuing development; it captures current architecture, working-tree caveats, and suggested next steps.
- Route order is derived at request time from the selected subset of stops.
- Manual arrival times are local to the browser and are not saved to the database.
- Persistent route clusters are global, not user-specific.
- The optional seed script is only needed for a fresh/demo database.
