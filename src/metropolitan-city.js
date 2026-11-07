import * as THREE from 'three';
import { instances, seededRandom, box } from './geometry.js';

const UP = new THREE.Vector3(0, 1, 0);
const material = (color, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function meshBatch(group, mat, entries, name, geometry) { if (entries.length) { const mesh = instances(group, mat, entries, geometry, false); mesh.name = name; return mesh; } }
function nearestRail(points, x, z) { let best = Infinity; for (const p of points) best = Math.min(best, Math.hypot(p.x - x, p.z - z)); return best; }

/** Kilometres of real 3D buildings. Detailed street chunks are limited to the exposed railway corridor. */
export class MetropolitanCity extends THREE.Group {
  constructor(route) {
    super(); this.name = 'AurealisMetropolitanRegion'; this.chunks = []; this.groundY = 10;
    const random = seededRandom(71072), rail = [];
    const airportZ = route.stops.at(-1).position.z, botanicalZ = route.stops[6].position.z;
    const skyline = route.stops[4].position;
    for (let d = route.stops[3].distance; d <= route.length; d += 65) rail.push(route.sample(d).position);
    const masonry = [material('#c7c2b2'), material('#9caaac'), material('#a98874'), material('#cfd5d3')];
    const glass = material('#60869b', 0.28, 0.4), roof = material('#626a70', 0.8, 0.18), window = material('#344e61', 0.3, 0.25);
    const pavement = material('#b1afa2'), road = material('#555b5b'), green = material('#7f8d68');
    const windowPane = new THREE.PlaneGeometry(1, 1);
    // A real opening in the terrain exposes the retained cutting; no ground plane crosses the train.
    const cutting = rail.filter(p => p.y >= 3.5 && p.y <= 14);
    const cutMinZ = Math.min(...cutting.map(p => p.z)) - 60, cutMaxZ = Math.max(...cutting.map(p => p.z)) + 60;
    const cutMinX = 1046, cutMaxX = 1068;
    const groundRect = (x0, x1, z0, z1) => box(this, green, [x1 - x0, 0.25, z1 - z0], [(x0 + x1) / 2, 9.72, (z0 + z1) / 2], { shadow: false });
    groundRect(-7700, cutMinX, -13900, 4100); groundRect(cutMaxX, 14300, -13900, 4100);
    groundRect(cutMinX, cutMaxX, -13900, cutMinZ); groundRect(cutMinX, cutMaxX, cutMaxZ, 4100);
    const distant = masonry.map(() => []), distantTops = [], distantGlass = [], infill = [], infillWindows = [], infillRoofs = [];
    let count = 0, detailedCount = 0;
    // Jittered urban blocks, neighbourhood density and clustered business districts.
    for (let gx = -6500; gx < 16000; gx += 180) for (let gz = -13500; gz < 4000; gz += 180) {
      const x = gx + (random() - 0.5) * 65, z = gz + (random() - 0.5) * 65;
      if (x > 5750 && x < 8200 && Math.abs(z - airportZ) < 800) continue;
      if (Math.abs(x - 3200) < 145 && Math.abs(z - botanicalZ) < 150) continue;
      const distance = nearestRail(rail, x, z);
      if (distance < 58) continue;
      if (distance < 650 && x < 5700) for (const [dx, dz] of [[62, 0], [0, 64], [62, 64]]) {
        const xx = x + dx, zz = z + dz;
        if (nearestRail(rail, xx, zz) < 48 || (Math.abs(xx - 3200) < 145 && Math.abs(zz - botanicalZ) < 150)) continue;
        const h = 12 + random() * 22, w = 20 + random() * 13, dep = 22 + random() * 13;
        infill.push({ size: [w, h, dep], position: [xx, 10 + h / 2, zz], color: ['#c9bb9f', '#b49682', '#d2d0bd', '#acb5b5'][count % 4] });
        for (const side of [-1, 1]) {
          infillRoofs.push({ size: [w * 0.54, 0.35, dep + 0.8], position: [xx + side * w / 4, 10 + h + w * 0.08, zz], rotation: [0, 0, side * -0.29] });
          for (let yy = 13.5; yy < 10 + h - 1; yy += 3.4) for (let wx = -w / 2 + 2.2; wx < w / 2 - 1; wx += 4.2) {
            infillWindows.push({ size: [1.4, 1.7, 1], position: [xx + wx, yy, zz + side * (dep / 2 + 0.04)], rotation: [0, side > 0 ? 0 : Math.PI, 0] });
          }
        }
      }
      const district = Math.exp(-((x - skyline.x - 180) ** 2 + (z - skyline.z + 180) ** 2) / 1700000)
        + Math.exp(-((x - 3900) ** 2 + (z - botanicalZ + 1000) ** 2) / 1700000);
      const tower = random() < 0.12 + district * 0.2;
      const height = tower ? 58 + district * 75 + random() * 95 : 14 + random() * 35;
      const width = tower ? 22 + random() * 24 : 35 + random() * 47, depth = 28 + random() * 48;
      const palette = Math.floor(random() * masonry.length);
      count++;
      if (distance > 480 || x < 450) {
        distant[palette].push({ size: [width, height, depth], position: [x, 10 + height / 2, z] });
        distantTops.push({ size: [width * 0.7, tower ? 8 : 2, depth * 0.74], position: [x, 10 + height + (tower ? 4 : 1), z] });
        if (tower) distantGlass.push({ size: [width + 0.02, height * 0.8, depth * 0.72], position: [x, 10 + height * 0.55, z] });
        continue;
      }
      detailedCount++;
      const lod = new THREE.LOD(); lod.position.set(x, 10, z); lod.name = tower ? 'EuropeanOfficeTower' : 'EuropeanUrbanBlock';
      const detailed = new THREE.Group(), medium = new THREE.Group();
      const shells = [], frames = [], panes = [], details = [];
      shells.push({ size: [width, height, depth], position: [0, height / 2, 0] });
      shells.push({ size: [width + 0.7, 0.4, depth + 0.7], position: [0, height + 0.2, 0] });
      if (tower) {
        shells.push({ size: [width * 0.68, 8, depth * 0.76], position: [0, height + 4, 0] });
        frames.push({ size: [width * 0.42, 1.2, depth * 0.54], position: [0, height + 8.5, 0] });
        if (random() > 0.6) details.push({ size: [0.24, 14, 0.24], position: [width * 0.18, height + 15, 0] });
      } else {
        // Two pitched roof planes, cornices, chimneys and a masonry entrance.
        for (const side of [-1, 1]) frames.push({ size: [width * 0.54, 0.35, depth + 0.9], position: [side * width / 4, height + width * 0.08, 0], rotation: [0, 0, side * -0.29] });
        details.push({ size: [1.2, 3, 1.3], position: [width * 0.26, height + 3, depth * 0.2] });
        shells.push({ size: [width + 0.5, 0.45, depth + 0.5], position: [0, height - 2, 0] });
      }
      const floors = Math.floor(height / 3.6);
      for (let floor = 1; floor < floors; floor++) {
        const yy = floor * 3.6 + 1;
        for (const side of [-1, 1]) {
          for (let xx = -width / 2 + 2; xx < width / 2 - 1; xx += tower ? 2.8 : 4.2) {
            panes.push({ size: [tower ? 2.2 : 1.45, tower ? 2.85 : 1.75, 1], position: [xx, yy, side * (depth / 2 + 0.04)], rotation: [0, side > 0 ? 0 : Math.PI, 0] });
          }
          for (let zz = -depth / 2 + 2; zz < depth / 2 - 1; zz += tower ? 2.8 : 4.2) {
            panes.push({ size: [tower ? 2.2 : 1.45, tower ? 2.85 : 1.75, 1], position: [side * (width / 2 + 0.04), yy, zz], rotation: [0, side * Math.PI / 2, 0] });
          }
          if (tower) frames.push({ size: [width + 0.2, 0.12, 0.2], position: [0, yy + 1.5, side * (depth / 2 + 0.1)] });
        }
      }
      details.push({ size: [width * 0.22, 1.6, 4], position: [0, height + 0.8, 0] });
      details.push({ size: [1.9, 2.8, 0.09], position: [width * 0.15, 1.4, depth / 2 + 0.06] });
      // All basic shells/roofs share region-wide instance buffers. Only nearby
      // windows and rooftop equipment need per-building LOD draw calls.
      const worldEntry = entry => ({ ...entry, position: [entry.position[0] + x, entry.position[1] + 10, entry.position[2] + z] });
      distant[palette].push(...shells.map(worldEntry));
      (tower ? distantGlass : distantTops).push(...frames.map(worldEntry));
      meshBatch(detailed, window, panes, 'PhysicalWindowBays', windowPane); meshBatch(detailed, roof, details, 'RooftopEquipmentAndEntrances');
      box(detailed, pavement, [width + 14, 0.18, depth + 14], [0, 0.04, 0], { shadow: false });
      lod.addLevel(detailed, 0); lod.addLevel(medium, 650); this.add(lod); this.chunks.push(lod);
    }
    for (const [i, entries] of distant.entries()) meshBatch(this, masonry[i], entries, 'Distant3DNeighbourhoods');
    meshBatch(this, roof, distantTops, 'DistantRoofGeometry'); meshBatch(this, glass, distantGlass, 'DistantFinancialDistrictGlazing');
    meshBatch(this, material('#ffffff'), infill, 'DenseEuropeanInfillBuildings'); meshBatch(this, roof, infillRoofs, 'InfillPitchedRoofGeometry'); meshBatch(this, window, infillWindows, 'InfillPhysicalWindows', windowPane);
    // Real roads, footways, junctions and street furniture follow urban blocks.
    const roads = [], footways = [], markings = [], lamps = [], poles = [];
    for (let x = 650; x < 5800; x += 360) {
      roads.push({ size: [15, 0.04, 4000], position: [x + 88, 10.01, -4900] });
      for (const side of [-1, 1]) footways.push({ size: [3, 0.18, 4000], position: [x + 88 + side * 9, 10.07, -4900] });
      for (let z = -6700; z < -3000; z += 90) {
        markings.push({ size: [0.12, 0.012, 5], position: [x + 88, 10.04, z] });
        poles.push({ size: [0.1, 7.5, 0.1], position: [x + 98, 13.75, z] }); lamps.push({ size: [1.4, 0.15, 0.3], position: [x + 97.4, 17.5, z] });
      }
    }
    for (let z = -6500; z < -3000; z += 360) {
      roads.push({ size: [5400, 0.045, 15], position: [3250, 10.015, z + 88] });
      for (const side of [-1, 1]) footways.push({ size: [5400, 0.18, 3], position: [3250, 10.07, z + 88 + side * 9] });
    }
    meshBatch(this, road, roads, 'UrbanRoadNetwork'); meshBatch(this, pavement, footways, 'UrbanSidewalks');
    meshBatch(this, material('#e0dcc6'), markings, 'RoadLaneMarkings'); meshBatch(this, roof, poles, 'StreetlightColumns'); meshBatch(this, pavement, lamps, 'StreetlightHeads');
    this.userData = { real3DCity: true, buildingCount: count + infill.length, detailedBuildings: detailedCount + infill.length, geographicExtentKm: [22.5, 17.5], lodDistance: 650, noPhotographicBackdrop: true };
  }
}
