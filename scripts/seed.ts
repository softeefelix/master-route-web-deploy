import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SOURCE_CSV =
  process.env.SEED_SOURCE_CSV ??
  path.join(process.cwd(), "data/master-routes-address/jan2026_master_routes_with_addresses.csv");

type CsvRow = {
  dow: string;
  region_17: string;
  lat: string;
  lon: string;
  stop_id: string;
  total_sales_jan2025: string;
  sale_events_jan2025: string;
  past_sales_per_day_same_dow: string;
  other_dow_avg_sales_per_day: string;
  predicted_sales_per_day: string;
  address: string;
};

type PreparedRow = {
  day: string;
  routeKey: string;
  stopClusterId: number;
  lat: number;
  lon: number;
  totalSales: number;
  visits: number;
  salesNorm: number | null;
  visitsNorm: number | null;
  score: number | null;
  address: string;
};

async function main() {
  const rows = parseCsv(SOURCE_CSV);
  const groupedRoutes = groupByRoute(rows);
  const runMonth = startOfMonthFromSourcePath(SOURCE_CSV);

  await prisma.stopScore.deleteMany();
  await prisma.routeCluster.deleteMany();
  await prisma.stopCluster.deleteMany();
  await prisma.pipelineRun.updateMany({
    where: { status: "ACTIVE" },
    data: {
      status: "ARCHIVED",
      finishedAt: new Date()
    }
  });

  const pipelineRun = await prisma.pipelineRun.create({
    data: {
      runMonth,
      status: "ACTIVE",
      activatedAt: new Date(),
      notes: `Seed import from ${path.basename(SOURCE_CSV)}`
    }
  });

  for (const routeRows of groupedRoutes.values()) {
    const centroid = averagePoint(routeRows);
    const routeCluster = await prisma.routeCluster.create({
      data: {
        pipelineRunId: pipelineRun.id,
        centroidLat: centroid.lat,
        centroidLong: centroid.lon,
        radius: maxDistanceFromCentroid(centroid, routeRows),
        nRouteRuns: 1,
        nSignatureStops: routeRows.length,
        stopFreq: { importedStops: routeRows.length },
        dow: routeRows[0].day
      }
    });

    for (const row of routeRows) {
      await prisma.stopCluster.upsert({
        where: { id: row.stopClusterId },
        update: {
          centroidLat: row.lat,
          centroidLong: row.lon,
          address: row.address
        },
        create: {
          id: row.stopClusterId,
          centroidLat: row.lat,
          centroidLong: row.lon,
          address: row.address
        }
      });

      await prisma.stopScore.create({
        data: {
          pipelineRunId: pipelineRun.id,
          stopClusterId: row.stopClusterId,
          routeClusterId: routeCluster.id,
          dow: row.day,
          totalSales: row.totalSales,
          visits: row.visits,
          salesNorm: row.salesNorm,
          visitsNorm: row.visitsNorm,
          score: row.score
        }
      });
    }
  }

  console.log(`Seeded ${groupedRoutes.size} derived route clusters from ${SOURCE_CSV}`);
}

function parseCsv(filePath: string): PreparedRow[] {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.trim().split(/\r?\n/);
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(",");

  return dataLines.map((line) => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])) as CsvRow;
    return {
      day: row.dow,
      routeKey: `${row.dow}::${row.region_17}`,
      stopClusterId: Number(row.stop_id),
      lat: Number(row.lat),
      lon: Number(row.lon),
      totalSales: Number(row.total_sales_jan2025 || 0),
      visits: Number(row.sale_events_jan2025 || 0),
      salesNorm: numberOrNull(row.past_sales_per_day_same_dow),
      visitsNorm: numberOrNull(row.other_dow_avg_sales_per_day),
      score: numberOrNull(row.predicted_sales_per_day),
      address: row.address
    };
  });
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current);
  return cells;
}

function groupByRoute(rows: PreparedRow[]) {
  return rows.reduce<Map<string, PreparedRow[]>>((acc, row) => {
    const bucket = acc.get(row.routeKey) ?? [];
    bucket.push(row);
    acc.set(row.routeKey, bucket);
    return acc;
  }, new Map());
}

function averagePoint(rows: PreparedRow[]) {
  const sums = rows.reduce(
    (acc, row) => ({
      lat: acc.lat + row.lat,
      lon: acc.lon + row.lon
    }),
    { lat: 0, lon: 0 }
  );

  return {
    lat: sums.lat / rows.length,
    lon: sums.lon / rows.length
  };
}

function maxDistanceFromCentroid(centroid: { lat: number; lon: number }, rows: PreparedRow[]) {
  return Math.max(...rows.map((row) => haversineMeters(centroid.lat, centroid.lon, row.lat, row.lon)));
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function numberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function startOfMonthFromSourcePath(filePath: string) {
  const lowerName = path.basename(filePath).toLowerCase();
  const match = lowerName.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(\d{4})\b/
  );

  if (!match) {
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  }

  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11
  };

  return new Date(Number(match[2]), monthMap[match[1]], 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
