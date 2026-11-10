import { LINE_PATHS, STATION_LAYOUT, COMPLEX_LAYOUT, DECOR_LAYOUT, MAP_SIZE } from './network-map-layout.js';

/**
 * Builds the HUD map model by READING the live game network. Station names,
 * line names and colours, stop order, line membership, the U5 river loop,
 * platform levels and physical transfers all come from the game. The layout
 * table only says where to draw them. Nothing here writes to the network.
 */

// ---------- SVG path flattening (M, L, Q) for measurement and projection ----------
export function flattenPath(d, spacing = 1.5) {
  const tokens = d.match(/[MLQ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const points = []; let i = 0, command = null, x = 0, y = 0, length = 0;
  const add = (nx, ny, move = false) => {
    if (!move && points.length) length += Math.hypot(nx - x, ny - y);
    points.push({ x: nx, y: ny, t: length, move }); x = nx; y = ny;
  };
  while (i < tokens.length) {
    if (/^[MLQ]$/i.test(tokens[i])) command = tokens[i++].toUpperCase();
    if (command === 'M') { add(+tokens[i], +tokens[i + 1], true); i += 2; command = 'L'; }
    else if (command === 'L') { add(+tokens[i], +tokens[i + 1]); i += 2; }
    else if (command === 'Q') {
      const cx = +tokens[i], cy = +tokens[i + 1], ex = +tokens[i + 2], ey = +tokens[i + 3], sx = x, sy = y; i += 4;
      const n = Math.max(2, Math.ceil((Math.hypot(cx - sx, cy - sy) + Math.hypot(ex - cx, ey - cy)) / spacing));
      for (let k = 1; k <= n; k++) {
        const u = k / n, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
        add(a * sx + b * cx + c * ex, a * sy + b * cy + c * ey);
      }
    } else throw new Error(`Unsupported map path command in "${d.slice(0, 24)}…"`);
  }
  return { points, length };
}

/** Nearest point on a flattened path: distance from the point and position along the path. */
export function projectOnPath(flat, px, py) {
  let best = { distance: Infinity, t: 0, x: 0, y: 0 };
  const pts = flat.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; if (b.move) continue;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
    const x = a.x + u * dx, y = a.y + u * dy, distance = Math.hypot(px - x, py - y);
    if (distance < best.distance) best = { distance, t: a.t + u * (b.t - a.t), x, y };
  }
  return best;
}

/** Polyline points between two positions along a flattened path. */
export function slicePath(flat, t0, t1) {
  const from = Math.min(t0, t1), to = Math.max(t0, t1), out = [], pts = flat.points;
  const at = (a, b, t) => { const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.t < from || a.t > to) continue;
    if (!out.length) out.push(a.t >= from ? { x: a.x, y: a.y } : at(a, b, from));
    out.push(b.t <= to ? { x: b.x, y: b.y } : at(a, b, to));
    if (b.t >= to) break;
  }
  return out;
}

export function polylineBounds(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const FLAT_CACHE = new Map();
const flat = d => { if (!FLAT_CACHE.has(d)) FLAT_CACHE.set(d, flattenPath(d)); return FLAT_CACHE.get(d); };

/** Where a station meets a given line in the drawing (the Central complex has per-line platforms). */
export function stationAnchor(stationId, lineId) {
  const platform = COMPLEX_LAYOUT[stationId]?.platforms?.[lineId];
  if (platform) return platform;
  const complex = COMPLEX_LAYOUT[stationId];
  if (complex) {
    // Lines run through the complex body; anchor to the body point nearest the line.
    const b = complex.body, path = flat(LINE_PATHS[lineId].main);
    let best = null;
    for (let y = b.y + b.r; y <= b.y + b.h - b.r; y += 2) {
      const p = projectOnPath(path, b.x + b.w / 2, y);
      if (!best || p.distance < best.distance) best = p;
    }
    return { x: best.x, y: best.y };
  }
  return STATION_LAYOUT[stationId];
}

const levelText = y => `${y < 0 ? '−' : y > 0 ? '+' : ''}${Math.abs(Math.round(y))} m`;
const mode = values => {
  const counts = new Map(); for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const relativeLuminance = hex => {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** Readable text colour on a line colour (dark ink on yellow U9, white elsewhere). */
export const inkFor = color => relativeLuminance(color) > 0.45 ? '#1d2414' : '#ffffff';

const parsePlatformId = id => { const i = id.lastIndexOf(':'); return { stationId: id.slice(0, i), lineId: id.slice(i + 1) }; };

/**
 * @param network   the live MetroNetwork (route.network)
 * @param transfers physical connections: [{ platformIds: [a, b], type: 'stairs'|'passage', lifts?: boolean }]
 * @param variants  active route variants per line, e.g. { U5: 'scenic' }
 */
export function buildNetworkMapModel({ network, transfers = [], variants = {} }) {
  const lineOrder = [...network.lines.keys()];
  const issues = [];
  const lines = new Map();
  const membership = new Map();
  const join = (stationId, lineId) => { if (!membership.has(stationId)) membership.set(stationId, new Set()); membership.get(stationId).add(lineId); };

  for (const line of network.lines.values()) {
    const drawing = LINE_PATHS[line.id];
    if (!drawing) { issues.push(`No drawing for line ${line.id}`); continue; }
    const main = flat(drawing.main);
    const stops = line.nodeIds.map(id => {
      join(id, line.id);
      const anchor = stationAnchor(id, line.id);
      if (!anchor) { issues.push(`No drawing position for ${id}`); return { id, t: 0, distance: Infinity }; }
      const p = projectOnPath(main, anchor.x, anchor.y);
      return { id, t: p.t, distance: p.distance };
    });
    const ts = stops.map(s => s.t), full = Math.abs(Math.min(...ts)) < 0.5 && Math.abs(Math.max(...ts) - main.length) < 0.5;
    const span = { from: Math.min(...ts), to: Math.max(...ts) };
    const mainPoints = slicePath(main, span.from, span.to);
    let variant = null;
    const branch = line.id === 'U5' ? network.phase6?.branch : null;
    if (drawing.variant && branch?.stations?.length) {
      const path = flat(drawing.variant.d);
      const loop = branch.stations.map(s => {
        join(s.id, line.id);
        const anchor = STATION_LAYOUT[s.id];
        if (!anchor) { issues.push(`No drawing position for ${s.id}`); return { id: s.id, t: 0, distance: Infinity }; }
        const p = projectOnPath(path, anchor.x, anchor.y);
        return { id: s.id, t: p.t, distance: p.distance };
      });
      variant = { id: drawing.variant.id, d: drawing.variant.d, length: path.length, stops: loop, points: path.points, active: variants[line.id] === drawing.variant.id };
    }
    const color = line.color;
    lines.set(line.id, {
      id: line.id, name: line.name && line.name !== line.id ? line.name : '', color, ink: inkFor(color),
      d: drawing.main, full, points: mainPoints, length: span.to - span.from, offset: span.from, halo: Boolean(drawing.halo),
      stops, variant,
      first: line.nodeIds[0], last: line.nodeIds.at(-1),
      count: stops.length + (variant?.stops.length ?? 0),
      bbox: polylineBounds(variant ? [...mainPoints, ...variant.points] : mainPoints),
    });
  }

  // Physical transfers, read from the game's stairs, lifts and passages.
  const transferMap = new Map();
  for (const link of transfers) {
    const [a, b] = link.platformIds.map(parsePlatformId);
    if (!a || !b || a.stationId !== b.stationId || a.lineId === b.lineId) continue;
    const pair = [a.lineId, b.lineId].sort((p, q) => lineOrder.indexOf(p) - lineOrder.indexOf(q));
    const key = `${a.stationId}|${pair.join('|')}`;
    const kind = link.type === 'passage' ? 'passage' : link.lifts ? 'stairs and lifts' : 'stairs';
    const previous = transferMap.get(key);
    if (!previous || (kind === 'stairs and lifts' && previous.kind === 'stairs')) transferMap.set(key, { stationId: a.stationId, lines: pair, kind });
  }

  const stations = new Map();
  for (const [id, served] of membership) {
    const node = network.nodes.get(id), drawing = STATION_LAYOUT[id];
    if (!node || !drawing) continue;
    const lineIds = lineOrder.filter(l => served.has(l));
    const isEnd = lineIds.length === 1 && [lines.get(lineIds[0])?.first, lines.get(lineIds[0])?.last].includes(id);
    const kind = lineIds.length > 1 ? 'interchange' : isEnd ? 'terminus' : 'stop';
    const platforms = Object.values(node.platforms ?? {});
    const elevated = platforms.find(p => (p.position?.y ?? 0) > 0 && typeof p.outdoor === 'boolean');
    const levels = [...new Set(platforms.map(p => p.floorY ?? p.position?.y ?? 0))].sort((a, b) => b - a)
      .map(y => ({ y, text: levelText(y), lines: lineOrder.filter(l => node.platforms[l] && (node.platforms[l].floorY ?? node.platforms[l].position?.y ?? 0) === y && served.has(l)) }))
      .filter(level => level.lines.length);
    const onLoop = [...lines.values()].some(l => l.variant?.stops.some(s => s.id === id));
    stations.set(id, {
      id, name: node.name, lines: lineIds, kind, onLoop,
      sub: elevated ? (elevated.outdoor ? 'open-air' : 'enclosed') : '',
      chips: kind === 'interchange' ? lineIds : kind === 'terminus' ? lineIds : [],
      transfers: [...transferMap.values()].filter(t => t.stationId === id).map(t => `${t.lines[0]} ↔ ${t.lines[1]} · ${t.kind}`),
      levels: levels.length > 2 ? levels : [],
      complex: Boolean(COMPLEX_LAYOUT[id]),
      x: drawing.x, y: drawing.y, layout: drawing,
    });
  }
  for (const id of network.nodes.keys()) if (!stations.has(id) && membership.has(id)) issues.push(`Station ${id} is not drawn`);

  // Section captions derived from platform levels (e.g. "U10 underground · −72 m").
  const sections = DECOR_LAYOUT.sections.flatMap(section => {
    const line = network.lines.get(section.line), drawn = lines.get(section.line);
    if (!line || !drawn) return [];
    if (section.kind === 'variant') return drawn.variant ? [{ ...section, text: `${line.id} river loop (alternative route)` }] : [];
    const ys = line.nodeIds.map(id => network.nodes.get(id).platforms[line.id]?.position?.y ?? 0);
    const under = ys.filter(y => y < 0), over = ys.filter(y => y > 0);
    if (section.kind === 'underground') return under.length && over.length ? [{ ...section, text: `${line.id} underground · ${levelText(mode(under))}` }] : [];
    if (section.kind === 'elevated') return over.length ? [{ ...section, text: `${line.id} elevated · ${levelText(mode(over))}` }] : [];
    if (section.kind === 'portal') return under.length && over.length ? [{ ...section, text: 'portal' }] : [];
    return [];
  });
  const decor = {
    viaduct: lines.has(DECOR_LAYOUT.viaduct.line) && sections.some(s => s.kind === 'elevated') ? DECOR_LAYOUT.viaduct : null,
    portal: lines.has(DECOR_LAYOUT.portal.line) && sections.some(s => s.kind === 'portal') ? DECOR_LAYOUT.portal : null,
    sections,
  };
  const complexes = Object.entries(COMPLEX_LAYOUT).filter(([id]) => stations.has(id)).map(([id, c]) => ({
    id, ...c, platforms: Object.fromEntries(Object.entries(c.platforms ?? {}).filter(([lineId]) => stations.get(id).lines.includes(lineId))),
  }));
  const stationList = [...stations.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { size: MAP_SIZE, lines, stations, stationList, decor, complexes, issues, lineOrder: lineOrder.filter(id => lines.has(id)) };
}

/** Collects physical transfers from the game's passenger information and transfer objects (read-only). */
export function collectTransfers(services, pedestrianTransfers = []) {
  const links = services.flatMap(service => service.passengerInformation?.transferLinks ?? []);
  const withLifts = new Set(pedestrianTransfers.filter(t => t.lifts?.length).map(t => (t.platformIds ?? []).slice().sort().join('|')));
  const seen = new Set();
  return links.filter(link => {
    const key = `${link.type}|${link.platformIds.slice().sort().join('|')}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  }).map(link => ({ ...link, lifts: withLifts.has(link.platformIds.slice().sort().join('|')) }));
}
