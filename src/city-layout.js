/** Metres in the existing world frame. The new city does not relocate railways. */
export const STREET_Y = 10;
/** The original old town; downtown wraps around it (mostly to the south, past the canal). */
export const OLD_TOWN = Object.freeze({ minX: -148, maxX: 120, minZ: -352, maxZ: -50 });
/** The whole walkable street district. */
export const CITY_BOUNDS = Object.freeze({ minX: -310, maxX: 280, minZ: -650, maxZ: 85 });
export const CENTRAL_EXIT = Object.freeze({ stationId: 'station-2', lineId: 'U4', end: -44 });
/** One-click arrival: Central square just outside the station arch, facing into the square. */
export const CITY_ARRIVAL = Object.freeze({ x: -16.2, z: -214, yaw: 0, pitch: -0.02 });
export const CITY_ROUTES = Object.freeze([
  { name: 'Central square', x: -16.2, z: -234 },
  { name: 'West market', x: -104, z: -234 },
  { name: 'Clock lane', x: -104, z: -120 },
  { name: 'Upper lane', x: -104, z: -86 },
  { name: 'Lemon square', x: -16.2, z: -86 },
  { name: 'North walk', x: -16.2, z: -120 },
  { name: 'Garden square', x: 84, z: -120 },
  { name: 'Linden walk', x: 84, z: -234 },
  { name: 'Canal bridge east', x: 84, z: -320 },
  { name: 'Canal promenade', x: -16.2, z: -320 },
  { name: 'Canal bridge west', x: -104, z: -320 },
  { name: 'West market', x: -104, z: -234 },
]);

// Narrow, deliberately surveyed frontages form real street walls. Cross streets,
// Central square and the eastern garden remain open rather than becoming plot scatter.
const FRONTAGES = Object.freeze([
  [-136,12],[-120,13],[-87,13],[-71,12],[-55,13],[-39,12],
  [9,13],[27,14],[45,12],[63,13],[105,14],
]);

/** Connected blocks, with quieter western infill and a separate northern street edge. */
export const CITY_PLOTS = Object.freeze([
  ...[-292,-267,-207,-150].flatMap((z,j)=>FRONTAGES.map(([x,width],i)=>({
    x,z,width,depth:22,floors:2+(i+j)%2,style:(i+j)%4,seed:j*20+i,
  }))),
  ...FRONTAGES.slice(0,6).map(([x,width],i)=>({x,z:-178,width,depth:21,floors:2,style:(i+1)%4,seed:100+i})),
  ...FRONTAGES.map(([x,width],i)=>({x,z:-103,width,depth:17,floors:2+i%2,style:(i+2)%4,seed:200+i})),
  // Northern extension: an upper lane and a terrace around Lemon square.
  ...FRONTAGES.map(([x,width],i)=>({x,z:-67,width,depth:20,floors:3,style:(i+3)%4,seed:300+i})),
]);

/** Paved squares (herringbone brick) and the anchors used for bunting and washing lines. */
export const CITY_SQUARES = Object.freeze([
  { name: 'Central square', minX: -33, maxX: 0.6, minZ: -255, maxZ: -218.6 },
  { name: 'West market', minX: -126, maxX: -82, minZ: -255, maxZ: -219 },
  { name: 'Garden square', minX: 54, maxX: 114, minZ: -195.4, maxZ: -161.6 },
  { name: 'Lemon square', minX: -32.6, maxX: 2, minZ: -76.6, maxZ: -53 },
]);

/**
 * Asphalt roads (no traffic yet). axis 'x' runs east-west at z = c; axis 'z' runs north-south at x = c.
 * width is the carriageway, walk is each sidewalk. Every walking route stays on a road centre line.
 */
export const CITY_ROADS = Object.freeze([
  // Old-town roads, now continuing through downtown.
  { name: 'VIA DEL CORSO', axis: 'x', c: -120, from: CITY_BOUNDS.minX, to: CITY_BOUNDS.maxX, width: 8, walk: 4 },
  { name: 'VIA DEI LIMONI', axis: 'x', c: -86, from: CITY_BOUNDS.minX, to: CITY_BOUNDS.maxX, width: 7, walk: 3 },
  { name: 'VICOLO DEL MERCATO', axis: 'z', c: -104, from: -120, to: CITY_BOUNDS.maxZ, width: 7, walk: 3 },
  { name: 'VIA GARIBALDI', axis: 'z', c: 84, from: -120, to: CITY_BOUNDS.maxZ, width: 7, walk: 3 },
  // Downtown grid: 4-lane avenues (12 m) and 2-lane streets.
  { name: 'NORTH AVENUE', axis: 'x', c: 30, from: CITY_BOUNDS.minX, to: CITY_BOUNDS.maxX, width: 12, walk: 4 },
  { name: 'TERRACE STREET', axis: 'z', c: -16.2, from: -14, to: CITY_BOUNDS.maxZ, width: 8, walk: 4 },
  { name: 'WEST AVENUE', axis: 'z', c: -230, from: CITY_BOUNDS.minZ, to: CITY_BOUNDS.maxZ, width: 12, walk: 4 },
  { name: 'EAST AVENUE', axis: 'z', c: 200, from: CITY_BOUNDS.minZ, to: CITY_BOUNDS.maxZ, width: 12, walk: 4 },
  { name: 'MARKET STREET WEST', axis: 'x', c: -234, from: CITY_BOUNDS.minX, to: -172, width: 8, walk: 4 },
  { name: 'MARKET STREET EAST', axis: 'x', c: -234, from: 142, to: CITY_BOUNDS.maxX, width: 8, walk: 4 },
  { name: 'CANAL QUAY WEST', axis: 'x', c: -346, from: CITY_BOUNDS.minX, to: OLD_TOWN.minX, width: 7, walk: 3 },
  { name: 'CANAL QUAY EAST', axis: 'x', c: -346, from: OLD_TOWN.maxX, to: CITY_BOUNDS.maxX, width: 7, walk: 3 },
  { name: 'CENTRAL AVENUE', axis: 'z', c: -16.2, from: -430, to: -352, width: 12, walk: 4 },
  { name: 'CENTRAL AVENUE SOUTH', axis: 'z', c: -16.2, from: CITY_BOUNDS.minZ, to: -570, width: 12, walk: 4 },
  { name: 'MERCATO AVENUE', axis: 'z', c: -104, from: CITY_BOUNDS.minZ, to: -352, width: 12, walk: 4 },
  { name: 'GARIBALDI AVENUE', axis: 'z', c: 84, from: CITY_BOUNDS.minZ, to: -352, width: 12, walk: 4 },
  { name: 'BROADWAY NORTH', axis: 'x', c: -430, from: CITY_BOUNDS.minX, to: CITY_BOUNDS.maxX, width: 12, walk: 4 },
  { name: 'MIDTOWN STREET', axis: 'x', c: -500, from: CITY_BOUNDS.minX, to: CITY_BOUNDS.maxX, width: 8, walk: 4 },
  { name: 'BROADWAY SOUTH', axis: 'x', c: -570, from: CITY_BOUNDS.minX, to: CITY_BOUNDS.maxX, width: 12, walk: 4 },
]);
/** Road bridges carrying the two outer avenues over the canal (old-town footbridges stay as they are). */
export const ROAD_BRIDGES = Object.freeze([-230, 200]);
/** Reserved for Aurealis Square (Milestone 3): plain paving until then. */
export const SQUARE_SITE = Object.freeze({ minX: -40, maxX: 7.6, minZ: -570, maxZ: -430 });
/** Walkable upper-town terrace north of Lemon square, with a stair at each end of its centre passage. */
export const TERRACE = Object.freeze({ minX: -95, maxX: 75, minZ: -49.4, maxZ: -25, height: 2.4,
  stairSouth: { minX: -19.2, maxX: -13.2, minZ: -49.4, maxZ: -45.8 }, stairNorth: { minX: -19.2, maxX: -13.2, minZ: -25, maxZ: -21.4 } });
/** Weathered stretches of the old town wall left standing as relics. */
export const WALL_RELICS = Object.freeze([
  { name: 'west', points: [[-148.3, -112], [-148.3, -95]], tower: [-148.3, -112] },
  { name: 'north-east', points: [[92, -50.3], [120.3, -50.3], [120.3, -76]], tower: [120.3, -50.3] },
  { name: 'south-east', points: [[120.3, -326], [120.3, -296]], tower: [120.3, -326], gate: { z: -320, width: 8 } },
]);
/** Mid-block zebra crossings where pedestrian lanes meet a road: [road name, position along it]. */
export const CITY_CROSSINGS = Object.freeze([['VIA DEL CORSO', -16.2], ['VIA DEI LIMONI', -16.2], ['VIA DEL CORSO', 30.5]]);
/** Festive canopies (shamianas): centre, size along x and z. */
export const CITY_SHAMIANAS = Object.freeze([
  { name: 'Central square', x: -16.2, z: -247, w: 10.4, d: 6.6 },
  { name: 'West market', x: -92, z: -247.5, w: 9.2, d: 6.2 },
  { name: 'Lemon square', x: -16.2, z: -57.6, w: 9.6, d: 6.2 },
]);

export const rectContains = (r, x, z, margin = 0) => x >= r.minX - margin && x <= r.maxX + margin
  && z >= r.minZ - margin && z <= r.maxZ + margin;
