// The HUD map is drawing-only. This check fails if the drawing table and the
// authoritative game network disagree about stations, connections or line
// assignments. Run: node tests/network-map-data.mjs
import assert from 'node:assert/strict';
// network-world.js builds canvas sign textures at import; give it an inert 2D context.
const context = new Proxy({}, { get: (t, k) => k in t ? t[k] : k === 'measureText' ? text => ({ width: text.length * 12 }) : () => {} });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { createPhase6Network } = await import('../src/phase6-network.js');
const { addU10ToNetwork } = await import('../src/u10-network.js');
const { createMetroNetwork, addU2ToNetwork, addLowerLinesToNetwork, createCompleteMetroNetwork } = await import('../src/network.js');
const { NEW_TRANSFERS, PHASE6_TRANSFERS } = await import('../src/network-world.js');
const { U10_TRANSFERS } = await import('../src/u10-network.js');
const { buildNetworkMapModel, flattenPath, projectOnPath, stationAnchor } = await import('../src/network-map-model.js');
const { LINE_PATHS, STATION_LAYOUT } = await import('../src/network-map-layout.js');

// Map units: a station symbol (radius 4.3) must overlap its drawn track stroke
// (half-width 2.5). The same distance decides "passes through" for check 4.
const ON_TRACK = 4.3 + 2.5;
const network = createPhase6Network(); addU10ToNetwork(network);
const before = JSON.stringify([...network.nodes.keys(), ...[...network.lines.values()].map(l => [l.id, l.color, l.nodeIds])]);
const model = buildNetworkMapModel({ network, variants: { U5: 'direct' } });
assert.equal(JSON.stringify([...network.nodes.keys(), ...[...network.lines.values()].map(l => [l.id, l.color, l.nodeIds])]), before, 'building the map must not modify the network');
assert.deepEqual(model.issues, [], 'every game station and line has a drawing');

// 1. Stations: exactly the game's stations are represented; no extras in the drawing table.
const gameStations = [...network.nodes.keys()].sort();
assert.deepEqual([...model.stations.keys()].sort(), gameStations, 'map stations = game stations');
assert.deepEqual(Object.keys(STATION_LAYOUT).sort(), gameStations, 'drawing table has no stations the game lacks');
for (const [id, station] of model.stations) assert.equal(station.name, network.nodes.get(id).name, `${id} name comes from the game`);

// 2. Lines: same ids, names and colours; the drawing table has no extra lines.
assert.deepEqual(model.lineOrder, [...network.lines.keys()], 'map lines = game lines, in game order');
assert.deepEqual(Object.keys(LINE_PATHS).sort(), [...network.lines.keys()].sort(), 'drawing table has no lines the game lacks');
for (const line of network.lines.values()) assert.equal(model.lines.get(line.id).color, line.color, `${line.id} colour comes from the game`);

// 3. Line assignments and connections: each line's game stops lie on that
//    line's drawn track, strictly in the game's stop order, and adjacent stops
//    are consecutive along the drawing (so every drawn connection is a real link).
for (const line of network.lines.values()) {
  const drawn = model.lines.get(line.id);
  assert.deepEqual(drawn.stops.map(s => s.id), line.nodeIds, `${line.id} stop order`);
  for (const stop of drawn.stops) assert.ok(stop.distance <= ON_TRACK, `${line.id} ${stop.id} lies on its drawn track (${stop.distance.toFixed(2)})`);
  const ts = drawn.stops.map(s => s.t);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1] + 5, `${line.id}: ${line.nodeIds[i - 1]} → ${line.nodeIds[i]} is drawn in order`);
  assert.ok(drawn.full, `${line.id} drawing starts and ends at its termini`);
  for (const link of line.linkIds.map(id => network.links.get(id))) {
    const a = drawn.stops.findIndex(s => s.id === link.from), b = drawn.stops.findIndex(s => s.id === link.to);
    assert.equal(Math.abs(a - b), 1, `${link.id} connects consecutive drawn stops`);
  }
}

// 4. No false assignments: a line's track never passes through a station
//    symbol of a station it does not serve (that would imply a fake stop).
for (const line of network.lines.values()) {
  const path = flattenPath(LINE_PATHS[line.id].main);
  for (const [id, station] of model.stations) {
    if (station.lines.includes(line.id) || station.complex) continue;
    const p = projectOnPath(path, station.x, station.y);
    assert.ok(p.distance > ON_TRACK, `${line.id} track does not pass through ${id} (${p.distance.toFixed(2)})`);
  }
}

// 5. Station line assignments equal the game's line memberships.
const branch = network.phase6.branch;
for (const [id, station] of model.stations) {
  const expected = [...network.lines.values()].filter(l => l.nodeIds.includes(id) || (l.id === 'U5' && branch.stations.some(s => s.id === id))).map(l => l.id);
  assert.deepEqual(station.lines, expected, `${id} line assignment`);
  assert.equal(station.kind, expected.length > 1 ? 'interchange' : station.kind, `${id} kind`);
}

// 6. The U5 river loop: the game's branch stops lie on the drawn variant, in order.
const loop = model.lines.get('U5').variant;
assert.deepEqual(loop.stops.map(s => s.id), branch.stations.map(s => s.id), 'river loop stops');
for (const s of loop.stops) assert.ok(s.distance <= ON_TRACK, `${s.id} lies on the river loop drawing`);
for (let i = 1; i < loop.stops.length; i++) assert.ok(loop.stops[i].t > loop.stops[i - 1].t, 'river loop order');

// 7. Transfers come from the game's real stairs/lifts/passages.
const transfers = [
  ...[...NEW_TRANSFERS, ...PHASE6_TRANSFERS, ...U10_TRANSFERS].map(t => ({ type: 'stairs', lifts: Boolean(t.accessible), platformIds: [`${t.id}:${t.upperLine}`, `${t.id}:${t.lowerLine}`] })),
  { type: 'passage', platformIds: ['station-2:U1', 'station-2:U2'] },
];
const withTransfers = buildNetworkMapModel({ network, transfers });
assert.ok(withTransfers.stations.get('u2-stadtzentrum').transfers.includes('U2 ↔ U6 · stairs'));
assert.ok(withTransfers.stations.get('station-2').transfers.includes('U1 ↔ U2 · passage'));
assert.ok(withTransfers.stations.get('u6-ringplatz').transfers.includes('U6 ↔ U10 · stairs and lifts'));
assert.ok(withTransfers.stations.get('u5-waldtor').transfers.includes('U5 ↔ U9 · stairs'));
assert.deepEqual(withTransfers.stations.get('station-2').levels.map(l => [l.lines.join(' '), l.text]),
  [['U1 U2', '0 m'], ['U3 U4', '−12 m'], ['U9', '−48 m'], ['U10', '−72 m']], 'Central levels come from platform depths');
assert.deepEqual(withTransfers.decor.sections.map(s => s.text).sort(), ['U10 elevated · +26 m', 'U10 underground · −72 m', 'U5 river loop (alternative route)', 'portal'].sort());

// 8. Regression networks draw only what they contain (no invented stations or lines).
const original = createMetroNetwork(); addU2ToNetwork(original); addLowerLinesToNetwork(original);
for (const [name, net] of [['original', original], ['phase5', createCompleteMetroNetwork()]]) {
  const m = buildNetworkMapModel({ network: net });
  assert.deepEqual(m.issues, [], `${name}: no undrawn stations`);
  assert.deepEqual([...m.stations.keys()].sort(), [...net.nodes.keys()].sort(), `${name}: stations`);
  assert.deepEqual(m.lineOrder, [...net.lines.keys()], `${name}: lines`);
  for (const line of net.lines.values()) {
    const drawn = m.lines.get(line.id);
    for (const stop of drawn.stops) assert.ok(stop.distance <= ON_TRACK, `${name} ${line.id} ${stop.id} on track`);
    const ts = drawn.stops.map(s => s.t);
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1], `${name} ${line.id} order`);
  }
}
assert.ok(stationAnchor('station-2', 'U10').x === 530);
console.log(`network map data: ${model.stations.size} stations, ${model.lines.size} lines and ${loop.stops.length} river-loop stops match the game network`);
