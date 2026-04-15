# Master Route Web

Standalone Next.js app for exploring route clusters on a Leaflet map with a PostgreSQL/PostGIS backend.

## What Is In This Repo

- `app/`: Next.js App Router pages, API routes, and UI components
- `lib/`: Prisma-backed data access, route ordering, naming, and shared helpers
- `prisma/`: schema and migration files
- `scripts/seed.ts`: optional CSV import for a fresh database
- `data/master-routes-address/jan2026_master_routes_with_addresses.csv`: seed CSV used by the import script
- `SQL/postgis_setup.sql`: one-line PostGIS enablement helper

## Main Behavior

- Two-panel layout with route filters on the left and Leaflet map on the right
- Day filter and route-cluster filter
- Top-stops filter that limits each route to its highest-scoring stops
- Selected route sync between map and sidebar
- Start and finish pin markers on the selected route
- Route names derived from the highest-scoring stop's city

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create env file

```bash
cp .env.example .env
```

3. Point `DATABASE_URL` at your existing database in `.env`

4. Generate Prisma client

```bash
npx prisma generate
```

5. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

- The app currently uses only `route_clusters`, `stop_clusters`, and `stop_scores`.
- Route order is derived at request time from the selected subset of stops.
- The optional seed script is only needed for a fresh database.
