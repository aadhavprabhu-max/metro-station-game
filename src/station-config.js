/** Architecture only. Network nodes remain authoritative for names, lines and poses. */
export const STATION_FAMILIES = Object.freeze({
  scandinavian: 'Moulded ceramic ceiling and integrated lighting',
  urban: 'Structured urban concrete and ceramic',
  brick: 'Brick station with expressed masonry vaults',
  refined: 'Warm stone, bronze and deep structural coffers',
  industrial: 'Exposed steel portals and practical concrete',
  waterfront: 'Waterfront steel hall with an original three-dimensional quay',
  glass: 'Daylit glazed canopy and slender structural frame',
  green: 'Green ceramic, timber and restrained daylight',
  events: 'Broad structural ribs and generous clear sightlines',
  airport: 'High linear roof, skylights and long circulation axes',
  radial: 'Radial structural ceiling around a clear central landmark',
});

const palette = (wall, accent, floor, metal, warmth = '#f0eee4') => ({ wall, accent, floor, metal, warmth });
const urban = palette('#ced2cf', '#647e78', '#949f9c', '#657773');
const warm = palette('#d4c9b4', '#9b7853', '#a9a493', '#75695b', '#f4e5c9');
const cool = palette('#d5dfe0', '#657f91', '#8c9d9f', '#71878f', '#e5f1f5');
const green = palette('#d6ded1', '#528073', '#879b90', '#75887d', '#eaf0de');
const iron = palette('#9caaa6', '#8a644c', '#7c8580', '#485954', '#f1dfc5');

const definition = (family, colors, height, bay, extra = {}) => ({
  family, palette: colors, ceilingHeight: height, structuralBay: bay,
  roofRise: 0, columnProfile: 'rectangular', wallBay: 3,
  lighting: { color: colors.warmth, intensity: 88, height: 4.4, distance: 30 },
  ...extra,
});

/** Each of the twenty-seven shared station nodes has one explicit visual identity. */
export const STATION_ARCHITECTURE = Object.freeze({
  'station-1': { family: 'preserved', signature: 'original-nordplatz', preserved: true },
  'station-2': { family: 'preserved', signature: 'central-two-level', preserved: true,
    platformStyles: { U1: 'urban-interchange', U2: 'urban-interchange', U3: 'golden-hive', U4: 'golden-hive' } },
  'station-3': { family: 'preserved', signature: 'rosenheimer-urban', preserved: true },
  'u2-stadtzentrum': { family: 'preserved', signature: 'glass-cathedral', preserved: true },
  'u2-schwarzkopf': { family: 'preserved', signature: 'irregular-natural-rock', preserved: true },
  'u2-eisenwerk': { family: 'preserved', signature: 'ironworks', preserved: true },
  'u3-schattenufer': { family: 'preserved', signature: 'oculus-diagrid', preserved: true },
  'u3-ostbahnhof': { family: 'preserved', signature: 'railway-interchange-coffers', preserved: true },
  'u3-stadtbruecke': { family: 'preserved', signature: 'tied-steel-bridge-arches', preserved: true },
  'u4-kaiser-humboldt': { family: 'preserved', signature: 'historic-masonry-vault', preserved: true },
  'u4-westbahnhof': { family: 'preserved', signature: 'brick-railway-vault', preserved: true },
  'u4-arabellapark': { family: 'preserved', signature: 'sage-garden-vault', preserved: true },

  'u5-suedstadt': definition('brick', palette('#b59077', '#95634c', '#a19a8d', '#5d5b52', '#f1dfc8'), 5.8, 6.3, { roofRise: 0.8, signature: 'urban-brick-and-glazed-entrance', wallBay: 1.45 }),
  'u5-stadionpark': definition('events', palette('#c7cecb', '#668374', '#969f94', '#617268'), 7.7, 5, { roofRise: 0.6, signature: 'stadium-concrete-ribs', ribWidth: 0.3, bracePattern: 'fan', wallBay: 4.8 }),
  'u5-messepark': definition('events', palette('#dfe3df', '#788c9c', '#a6b1ad', '#97a8ae', '#edf4f3'), 8.1, 8, { roofRise: 1.0, signature: 'exhibition-folded-roof', ribWidth: 0.21, bracePattern: 'diamond', wallBay: 6 }),
  'u5-technologiecampus': definition('scandinavian', palette('#d1dbe0', '#5c7e90', '#89979c', '#8c9ba1', '#e9f3f6'), 6.3, 4.5, { roofRise: 0.25, signature: 'silver-precision-ceiling', columnProfile: 'round', wallBay: 2.15, diskRadius: 0.11 }),
  'u5-flughafen': definition('airport', palette('#d9dfdc', '#6b8590', '#a3aeaa', '#849ca4', '#edf4f4'), 8.0, 7.5, { roofRise: 0.55, signature: 'airport-linear-skylight-hall', finSpacing: 1.35, wallBay: 4.8 }),
  'u5-nordklinikum': definition('scandinavian', palette('#e1e7de', '#729c91', '#a0afa6', '#8a9c93', '#f1f5eb'), 5.5, 8, { roofRise: 0.35, signature: 'calm-white-ceramic-ceiling', wallBay: 3.75, diskRadius: 0.15 }),
  'u5-waldtor': definition('green', palette('#d1d4c3', '#658574', '#91a08d', '#7a8571', '#f0eddb'), 6.2, 7.3, { roofRise: 0.9, signature: 'open-timber-city-gateway', canopyCoverage: 0.65, openAir: true, planterRhythm: 10 }),
  'u5-hafenbogen': definition('waterfront', palette('#abb5ae', '#80694c', '#7c8b86', '#435c5a', '#f1d8ad'), 8.0, 6.3, { roofRise: 1.15, signature: 'harbour-bow-girder-hall', trussDepth: 1.1, bracePattern: 'warren', wallBay: 4.5, waterfront: true }),

  'u6-theaterinsel': definition('refined', palette('#cfc4b0', '#97724d', '#a39c8c', '#7b6655', '#f2ddba'), 6.8, 4.7, { roofRise: 0.6, signature: 'bronze-theatre-proscenium', cofferDepth: 0.6, wallBay: 2.1 }),
  'u6-suedklinikum': definition('scandinavian', palette('#dce5de', '#6c96a0', '#a1b0aa', '#8d9e9d', '#edf5f1'), 5.8, 6, { roofRise: 0.5, signature: 'clinical-daylight-ceramic-vault', columnProfile: 'round', wallBay: 4.25, diskRadius: 0.17 }),
  'u6-sonnenfeld': definition('scandinavian', palette('#e1d6bc', '#af8b57', '#b0a58e', '#9d8d70', '#fff0d0'), 5.4, 7.5, { roofRise: 0.7, signature: 'warm-neighbourhood-ceramic-ceiling', wallBay: 2.8, warmPanels: true }),
  'u6-ringplatz': definition('radial', palette('#cdd3cc', '#758b7d', '#8f9d94', '#77847b'), 7.2, 7, { roofRise: 0.85, signature: 'radial-civic-roof', spokes: 32, ringRadius: 5.4, wallBay: 3.5 }),
  'u6-waldsee': definition('green', palette('#d3ddcd', '#4f8268', '#7c988a', '#6b8776', '#edf3df'), 6.5, 5.8, { roofRise: 0.95, signature: 'green-ceramic-timber-lantern', canopyCoverage: 0.8, planterRhythm: 8, calmWater: true }),
  'u6-feldkirchen': definition('glass', palette('#d8dfd4', '#6b8c79', '#a1ad9b', '#8c9f96', '#edf1e2'), 5.9, 7.8, { roofRise: 0.8, signature: 'suburban-glass-and-cycle-canopy', glassMode: 'double-pitch', openAir: true, cycleRacks: true, wallBay: 4.6 }),
  'u6-industriepark': definition('industrial', palette('#b7bcb3', '#777d67', '#858e7e', '#5c665a', '#e9e5d1'), 6.7, 5.2, { roofRise: 0.8, signature: 'commuter-steel-lattice', trussDepth: 0.7, bracePattern: 'pratt', wallBay: 3.1 }),
});

export function getStationArchitecture(stationId, lineId = null) {
  const architecture = STATION_ARCHITECTURE[stationId];
  if (!architecture) throw new Error(`Missing station architecture: ${stationId}`);
  const platformStyle = lineId && architecture.platformStyles?.[lineId];
  return platformStyle ? { ...architecture, platformStyle } : architecture;
}
