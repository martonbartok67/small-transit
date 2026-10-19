import { offsetPolyline, v, type Polygon, type Vec2 } from '../geom';
import type { MapDef } from '../types';

function river(center: Vec2[], width: number): Polygon {
  return [...offsetPolyline(center, -width / 2), ...offsetPolyline(center, width / 2).reverse()];
}

const P = (pts: [number, number][]): Vec2[] => pts.map(([x, y]) => v(x, y));

/**
 * Original map: a river splits three western towns from three eastern ones.
 * Country roads already join the towns; farms, forests and an oil well feed a food plant, a sawmill and a refinery.
 * World units, y down.
 */
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
    P([[-2600, 1550], [-2250, 1450], [-1900, 1600], [-1850, 1850], [-2300, 1950], [-2700, 1850]]),
  ],
  hills: [
    P([[-2900, -1950], [-1500, -1950], [-1250, -1500], [-1800, -1350], [-2600, -1450], [-2950, -1600]]),
    P([[1450, 380], [2350, 250], [2750, 600], [2500, 950], [1700, 900]]),
    P([[-1250, 150], [-850, 300], [-900, 650], [-1350, 600]]),
  ],
  forests: [
    P([[-450, -1980], [250, -1960], [380, -1700], [200, -1480], [-200, -1450], [-480, -1650]]),
    P([[2250, 1150], [2700, 1050], [2950, 1350], [2900, 1900], [2400, 1950], [2200, 1550]]),
    P([[-2900, -1950], [-2200, -1950], [-2350, -1600], [-2850, -1550]]),
    P([[1500, 450], [1900, 380], [2050, 600], [1750, 780]]),
    P([[-2950, 450], [-2700, 380], [-2650, 700], [-2950, 750]]),
    P([[1150, -1950], [1700, -1950], [1650, -1650], [1250, -1600]]),
  ],
  roads: [
    P([[-1750, -850], [-1900, -300], [-2100, 300], [-2150, 1000]]),
    P([[-1750, -850], [-1250, -450], [-650, -150], [-400, 300], [-250, 800]]),
    P([[-250, 800], [-800, 950], [-1500, 1050], [-2150, 1000]]),
    P([[-250, 800], [300, 900], [800, 1150], [1200, 1350], [1700, 1450]]),
    P([[650, -1300], [1100, -1000], [1450, -700], [2050, -250]]),
    P([[2050, -250], [1700, 150], [1350, 650], [1500, 1100], [1700, 1450]]),
    P([[650, -1300], [450, -700], [250, -100], [-50, 400], [-250, 800]]),
    P([[-1750, -850], [-1200, -1150], [-500, -1300], [650, -1300]]),
  ],
  towns: [
    { name: 'Ashford', center: v(-1750, -850), pop: 2200, districts: 3 },
    { name: 'Brookvale', center: v(650, -1300), pop: 1400, districts: 2 },
    { name: 'Carlow', center: v(2050, -250), pop: 1800, districts: 2 },
    { name: 'Dunmore', center: v(-2150, 1000), pop: 900, districts: 2 },
    { name: 'Elmstead', center: v(-250, 800), pop: 2600, districts: 3 },
    { name: 'Fairhaven', center: v(1700, 1450), pop: 1200, districts: 2 },
  ],
  industries: [
    { kind: 'farm', name: 'Westfield Farm', pos: v(-2650, 150) },
    { kind: 'farm', name: 'Riverside Farm', pos: v(1250, 650) },
    { kind: 'foodplant', name: 'Valley Foods', pos: v(-1350, 1150) },
    { kind: 'forest', name: 'North Woods', pos: v(-100, -1600) },
    { kind: 'forest', name: 'Eastwood', pos: v(2500, 1450) },
    { kind: 'sawmill', name: 'Carlow Sawmill', pos: v(1500, -650) },
    { kind: 'oilwell', name: 'Mirror Lake Oil', pos: v(-1500, 1700) },
    { kind: 'refinery', name: 'Southport Refinery', pos: v(1250, 1800) },
  ],
};
