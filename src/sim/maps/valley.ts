import { offsetPolyline, v, type Polygon, type Vec2 } from '../geom';
import type { MapDef } from '../types';

function river(center: Vec2[], width: number): Polygon {
  return [...offsetPolyline(center, -width / 2), ...offsetPolyline(center, width / 2).reverse()];
}

/** Original map: a river splits three western towns from three eastern ones. World units, y down. */
export const VALLEY: MapDef = {
  name: 'Valley',
  halfW: 3000,
  halfH: 2000,
  water: [
    river(
      [v(-700, -2100), v(-600, -1450), v(-950, -800), v(-650, -250), v(100, 150), v(700, 420), v(920, 1000), v(700, 1600), v(900, 2100)],
      95,
    ),
    // Lake south of Dunmore.
    [v(-2600, 1550), v(-2250, 1450), v(-1900, 1600), v(-1850, 1850), v(-2300, 1950), v(-2700, 1850)],
  ],
  hills: [
    [v(-2900, -1950), v(-1500, -1950), v(-1250, -1500), v(-1800, -1350), v(-2600, -1450), v(-2950, -1600)],
    [v(1450, 380), v(2350, 250), v(2750, 600), v(2500, 950), v(1700, 900)],
    [v(-1250, 150), v(-850, 300), v(-900, 650), v(-1350, 600)],
  ],
  towns: [
    { name: 'Ashford', center: v(-1750, -850), pop: 2200, districts: 3 },
    { name: 'Brookvale', center: v(650, -1300), pop: 1400, districts: 2 },
    { name: 'Carlow', center: v(2050, -250), pop: 1800, districts: 2 },
    { name: 'Dunmore', center: v(-2150, 1000), pop: 900, districts: 2 },
    { name: 'Elmstead', center: v(-250, 800), pop: 2600, districts: 3 },
    { name: 'Fairhaven', center: v(1700, 1450), pop: 1200, districts: 2 },
  ],
};
