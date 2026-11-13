/** Metres in the existing world frame. The new city does not relocate railways. */
export const STREET_Y = 10;
export const CITY_BOUNDS = Object.freeze({ minX: -148, maxX: 120, minZ: -352, maxZ: -92 });
export const CENTRAL_EXIT = Object.freeze({ stationId: 'station-2', lineId: 'U4', end: -44 });
export const CITY_ROUTES = Object.freeze([
  { name: 'Central square', x: -16.2, z: -234 },
  { name: 'West market', x: -104, z: -234 },
  { name: 'Clock lane', x: -104, z: -120 },
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
]);

export const rectContains = (r, x, z, margin = 0) => x >= r.minX - margin && x <= r.maxX + margin
  && z >= r.minZ - margin && z <= r.maxZ + margin;
