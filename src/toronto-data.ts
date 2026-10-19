export type MapPoint = [number, number];
export interface MapBuilding { id: number; name: string; points: MapPoint[]; height: number; heightSource: string; base: number; part: boolean; material: string }
export interface MapPath { name: string; kind: string; points: MapPoint[] }
export interface District { source: string; license: string; downloaded: string; origin: MapPoint; bbox: number[]; buildings: MapBuilding[]; streets: MapPath[]; rails: MapPath[]; parks: { name: string; points: MapPoint[] }[]; trees: MapPoint[] }
export const MAP_SCALE = 0.2;
export const BISHA_HEIGHT = 146.5;
export const CN_HEIGHT = 553.33;
export const BISHA_IDS = [416989000, 944510170, 944510172];
export const BISHA_ROTATION = 0.285;
export const STREET_Y = 3.37;

// Fit the configurable experiment inside the fixed geographic tower envelope.
export function bishaPlacement(points: MapPoint[], floors: number, cars: number) {
  const c = Math.cos(BISHA_ROTATION), s = Math.sin(BISHA_ROTATION);
  const local = points.map(([x, z]) => [c * x - s * z, s * x + c * z]);
  const xs = local.map(p => p[0]), zs = local.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
  const scaleY = BISHA_HEIGHT * MAP_SCALE / ((floors + 6) * 0.65 - STREET_Y);
  return {
    position: [(c * x + s * z) * MAP_SCALE, STREET_Y * (1 - scaleY), (-s * x + c * z) * MAP_SCALE] as [number, number, number],
    scale: [(maxX - minX) * MAP_SCALE * 0.82 / (cars * 1.85 + 3.8), scaleY, (maxZ - minZ) * MAP_SCALE * 0.8 / 4] as [number, number, number],
  };
}
export function projectLocation(lon: number, lat: number, origin: MapPoint): MapPoint {
  return [(lon - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180), (origin[1] - lat) * 111320];
}
export function centre(points: MapPoint[]): MapPoint {
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}
export function contains(point: MapPoint, polygon: MapPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
// Building outlines containing mapped parts are containers, not extra solid towers.
export function visibleBuildings(buildings: MapBuilding[]) {
  const parts = buildings.filter(b => b.part).map(b => centre(b.points));
  return buildings.filter(b => b.part || !parts.some(p => contains(p, b.points)));
}
export function streetWidth(kind: string) {
  return ({ motorway: 13, motorway_link: 7, trunk: 14, primary: 15, secondary: 14, tertiary: 12, residential: 9, unclassified: 8, service: 5, pedestrian: 5, cycleway: 2, footway: 1.8, path: 1.5 } as Record<string, number>)[kind] ?? 3;
}
