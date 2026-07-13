/**
 * Map visual modes and tile sources optimized for ops screenshots/print.
 * Andrew captures map chunks for drivers — B&W is currently the best pass-through.
 */
export type MapVisualMode = "bw" | "street";

export type MapStyleConfig = {
  label: string;
  /** Primary/base tile layer (land, water, roads). */
  tileUrl: string;
  attribution: string;
  /** Optional second layer for labels (street names); stacked above the base. */
  labelTileUrl?: string;
  selectedStroke: string;
  selectedCase: string;
  unselectedStroke: string;
  pinDefault: string;
  pinTop: string;
};

export const MAP_VISUAL_MODES: Record<MapVisualMode, MapStyleConfig> = {
  /**
   * True monochrome ops basemap (Esri light gray + reference labels).
   * Survives desaturation / B&W print much better than full-color street maps.
   * Route centerline is pure black on a white casing.
   */
  bw: {
    label: "B&W capture",
    tileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Light Gray Canvas",
    selectedStroke: "#000000",
    selectedCase: "#FFFFFF",
    unselectedStroke: "#666666",
    pinDefault: "#111111",
    pinTop: "#000000"
  },
  /** Full color streets — secondary when color print is needed. */
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

/** Knowledge defaults to B&W — screenshots desaturate and color washout loses labels. */
export const DEFAULT_MAP_VISUAL_MODE: MapVisualMode = "bw";
