import { headers } from "next/headers";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Route Sheet" };

type TimedStop = {
  order: number;
  stopClusterId: number;
  arrive: string;
  leaveBy: string;
  windowStart: string;
  windowEnd: string;
  expPerVisit: number;
  visits: number;
  address: string;
};

type TimedRoute = {
  routeClusterId: number;
  day: string;
  stops: TimedStop[];
  generatedAt: string | null;
};

type RouteName = { routeClusterId: number; name: string };

function shortAddress(address: string): string {
  // Keep the venue/street + city (first 3 comma parts), drop county/state/zip noise.
  const parts = address.split(",").map((p) => p.trim());
  return parts.slice(0, 3).join(", ");
}

async function fetchFromApi<T>(path: string): Promise<T | null> {
  const host = (await headers()).get("host");
  const protocol = host?.startsWith("localhost") ? "http" : "https";
  try {
    const res = await fetch(`${protocol}://${host}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function PrintRoutePage({
  searchParams
}: {
  searchParams: Promise<{ day?: string; routeClusterId?: string }>;
}) {
  const params = await searchParams;
  const day = params.day ?? "";
  const routeClusterId = params.routeClusterId ?? "";

  if (!day || !routeClusterId) {
    return <main style={{ padding: 32, fontFamily: "system-ui" }}>Missing day or routeClusterId.</main>;
  }

  const [timed, names] = await Promise.all([
    fetchFromApi<TimedRoute>(
      `/api/timed-route?day=${encodeURIComponent(day)}&routeClusterId=${encodeURIComponent(routeClusterId)}`
    ),
    fetchFromApi<RouteName[]>(`/api/route-names`)
  ]);

  const routeName =
    names?.find((n) => n.routeClusterId === Number(routeClusterId))?.name ?? `Route ${routeClusterId}`;
  const stops = timed?.stops ?? [];
  const totalExpected = stops.reduce((sum, s) => sum + s.expPerVisit, 0);

  return (
    <main className="print-sheet">
      <style>{`
        .print-sheet { font-family: system-ui, -apple-system, sans-serif; color: #111; padding: 24px; max-width: 800px; margin: 0 auto; }
        .print-sheet h1 { font-size: 20px; margin: 0 0 2px; }
        .print-sheet .sub { font-size: 12px; color: #555; margin-bottom: 14px; }
        .print-sheet table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .print-sheet th { text-align: left; border-bottom: 2px solid #111; padding: 4px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
        .print-sheet td { border-bottom: 1px solid #ccc; padding: 5px 6px; vertical-align: top; }
        .print-sheet td.time { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .print-sheet td.window { color: #555; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .print-sheet td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .print-sheet .checkbox { width: 14px; height: 14px; border: 1.5px solid #111; border-radius: 3px; display: inline-block; }
        .print-sheet .footer { margin-top: 14px; font-size: 10px; color: #777; }
        .print-btn { margin-bottom: 16px; padding: 8px 18px; font-size: 13px; font-weight: 600; border-radius: 8px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; }
        @media print {
          .print-btn { display: none; }
          .print-sheet { padding: 0; }
          @page { margin: 12mm; }
        }
      `}</style>
      <button className="print-btn" id="print-trigger">
        Print this sheet
      </button>
      <script dangerouslySetInnerHTML={{ __html: `document.getElementById('print-trigger').addEventListener('click',function(){window.print()});` }} />
      <h1>
        {routeName} — {day}
      </h1>
      <div className="sub">
        {stops.length} stops · expected ${Math.round(totalExpected).toLocaleString()}/day · times = arrive by /
        leave by · window = when this stop actually sells
        {timed?.generatedAt ? ` · schedule generated ${new Date(timed.generatedAt).toLocaleDateString()}` : ""}
      </div>
      {stops.length === 0 ? (
        <p>No timed schedule exists for this route and day yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>#</th>
              <th>Arrive</th>
              <th>Leave by</th>
              <th>Stop</th>
              <th>Sells during</th>
              <th style={{ textAlign: "right" }}>Exp $</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((stop) => (
              <tr key={stop.order}>
                <td>
                  <span className="checkbox" />
                </td>
                <td>{stop.order}</td>
                <td className="time">{stop.arrive}</td>
                <td className="time">{stop.leaveBy}</td>
                <td>{shortAddress(stop.address)}</td>
                <td className="window">
                  {stop.windowStart}–{stop.windowEnd}
                </td>
                <td className="num">${Math.round(stop.expPerVisit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="footer">
        Mister Softee NorCal · Master Routes · stop order respects each stop&apos;s productive time window —
        arriving outside the window costs sales.
      </div>
    </main>
  );
}
