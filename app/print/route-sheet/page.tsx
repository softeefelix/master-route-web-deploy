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
  source?: string;
  seasonVariant?: string | null;
  geotabRouteName?: string | null;
};

type RouteName = { routeClusterId: number; name: string };

function shortAddress(address: string): string {
  // Keep the venue/street + city (first 3 comma parts), drop county/state/zip noise.
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 3).join(", ") || address;
}

async function fetchFromApi<T>(path: string): Promise<T | null> {
  const host = (await headers()).get("host");
  const protocol = host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https";
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

  const [timed, names, overrides] = await Promise.all([
    fetchFromApi<TimedRoute>(
      `/api/timed-route?day=${encodeURIComponent(day)}&routeClusterId=${encodeURIComponent(routeClusterId)}`
    ),
    fetchFromApi<RouteName[]>(`/api/route-names`),
    fetchFromApi<{ overrides: Array<{ stopClusterId: number; hidden: boolean; arrivalTime?: string | null }> }>(
      `/api/stop-overrides?day=${encodeURIComponent(day)}&routeClusterId=${encodeURIComponent(routeClusterId)}`
    )
  ]);

  const hiddenStops = new Set(
    (overrides?.overrides ?? []).filter((o) => o.hidden).map((o) => o.stopClusterId)
  );
  const arrivalOverride = new Map(
    (overrides?.overrides ?? [])
      .filter((o) => o.arrivalTime)
      .map((o) => [o.stopClusterId, o.arrivalTime as string])
  );
  const routeName =
    names?.find((n) => n.routeClusterId === Number(routeClusterId))?.name ?? `Route ${routeClusterId}`;
  const stops = (timed?.stops ?? []).filter((s) => !hiddenStops.has(s.stopClusterId));
  const totalExpected = stops.reduce((sum, s) => sum + (s.expPerVisit || 0), 0);
  const sourceNote =
    timed?.source === "geotab"
      ? `Geotab master${timed.seasonVariant ? ` (${timed.seasonVariant})` : ""}`
      : timed?.source === "timed"
        ? "Timed builder"
        : "Schedule";

  return (
    <main className="print-sheet">
      <style>{`
        html, body { background: #fff !important; color: #111 !important; }
        .print-sheet {
          font-family: system-ui, -apple-system, sans-serif;
          color: #111;
          background: #fff;
          padding: 24px;
          max-width: 800px;
          margin: 0 auto;
        }
        .print-sheet h1 { font-size: 20px; margin: 0 0 2px; color: #111; }
        .print-sheet .sub { font-size: 12px; color: #333; margin-bottom: 14px; }
        .print-sheet table { width: 100%; border-collapse: collapse; font-size: 12px; color: #111; }
        .print-sheet th {
          text-align: left; border-bottom: 2px solid #111; padding: 4px 6px;
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #111;
        }
        .print-sheet td { border-bottom: 1px solid #999; padding: 5px 6px; vertical-align: top; color: #111; }
        .print-sheet td.time { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .print-sheet td.window { color: #333; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .print-sheet td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .print-sheet .checkbox {
          width: 14px; height: 14px; border: 1.5px solid #111; border-radius: 3px; display: inline-block;
        }
        .print-sheet .footer { margin-top: 14px; font-size: 10px; color: #444; }
        .print-btn {
          margin-bottom: 16px; padding: 8px 18px; font-size: 13px; font-weight: 600;
          border-radius: 8px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; color: #111;
        }
        @media print {
          /* Isolated print page (no map) — still force plain black text on white */
          html, body {
            background: #fff !important;
            color: #111 !important;
            height: auto !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body * { visibility: visible !important; }
          .print-btn { display: none !important; }
          .print-sheet {
            padding: 0 !important;
            max-width: none !important;
            color: #111 !important;
            background: #fff !important;
            position: static !important;
          }
          .print-sheet, .print-sheet * { color: #111 !important; }
          .print-sheet td, .print-sheet th { border-color: #444 !important; }
          @page { margin: 12mm; }
        }
      `}</style>
      <button type="button" className="print-btn" id="print-trigger">
        Print this sheet
      </button>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.getElementById('print-trigger')?.addEventListener('click',function(){window.print()});`
        }}
      />
      <h1>
        {routeName} — {day}
      </h1>
      <div className="sub">
        {stops.length} stops · {sourceNote}
        {totalExpected > 0 ? ` · expected $${Math.round(totalExpected).toLocaleString()}/day` : ""}
        {" · "}times = arrive / leave-by when available
        {timed?.generatedAt ? ` · generated ${new Date(timed.generatedAt).toLocaleDateString()}` : ""}
      </div>
      {stops.length === 0 ? (
        <p>No schedule (or all stops hidden) for this route and day yet.</p>
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
            {stops.map((stop, index) => {
              const arrive = arrivalOverride.get(stop.stopClusterId) || stop.arrive || "";
              return (
                <tr key={`${stop.order}-${stop.stopClusterId}`}>
                  <td>
                    <span className="checkbox" />
                  </td>
                  <td>{stop.order || index + 1}</td>
                  <td className="time">{arrive}</td>
                  <td className="time">{stop.leaveBy || ""}</td>
                  <td>{shortAddress(stop.address || `Stop ${stop.stopClusterId}`)}</td>
                  <td className="window">
                    {stop.windowStart && stop.windowEnd ? `${stop.windowStart}–${stop.windowEnd}` : ""}
                  </td>
                  <td className="num">
                    {stop.expPerVisit ? `$${Math.round(stop.expPerVisit)}` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="footer">
        Mister Softee NorCal · Master Routes · stop order = lane the drivers should run.
      </div>
    </main>
  );
}
