/**
 * Map visual modes and tile sources optimized for ops screenshots/print.
 * Andrew captures map chunks for drivers — B&W is currently the best pass-through.
 */
export type MapVisualMode = "bw" | "street";

export const MAP_VISUAL_MODES: Record<
  MapVisualMode,
  {
    label: string;
    tileUrl: string;
    attribution: string;
    selectedStroke: string;
    selectedCase: string;
    unselectedStroke: string;
    pinDefault: string;
    pinTop: string;
  }
> = {
  /** Max monochrome legibility — open street basemap + pure black route centerline. */
  bw: {
    label: "B&W capture",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    selectedStroke: "#000000",
    selectedCase: "#FFFFFF",
    unselectedStroke: "#555555",
    pinDefault: "#111111",
    pinTop: "#000000"
  },
  /** Color street basemap (still higher-contrast than the old Carto light). */
  street: {
    label: "Color streets",
    tileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri — HERE, Garmin, USGS, OpenStreetMap contributors",
    selectedStroke: "#0B5CAB",
    selectedCase: "#0A1628",
    unselectedStroke: "",
    pinDefault: "#0B5CAB",
    pinTop: "#D35400"
  }
};

/** Knowledge defaults to B&W — screenshots desaturate and color washind loses labels. */
export const DEFAULT_MAP_VISUAL_MODE: MapVisualMode = "bw";
