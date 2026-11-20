/**
 * Aurealis-Bahn Island HUD — ported from design/island/aurealis-island.html.
 * The markup (ISLAND HTML block) and the behaviour (ISLAND SCRIPT block) are copied verbatim;
 * the only change is that the script runs inside mountIsland(container) on the element it creates,
 * instead of looking up #island at load time. Public API: window.AurealisIsland (see the prototype).
 */
import './island.css';

const MARKUP = `<div class="island" id="island" data-state="idle">
    <svg class="bridge"><path id="bridgePath"/></svg>
    <div class="pill" id="pill" role="button" aria-label="Train status" tabindex="0">

      <div class="layer l-idle" data-layer="idle"></div>

      <div class="layer l-compact" data-layer="compact">
        <div class="l"><span class="badge" data-bind="line">S3</span></div>
        <div class="row" style="gap:7px">
          <span class="r lc num" data-bind="etaShort">2 min</span>
          <svg class="ring" viewBox="0 0 20 20"><circle class="bg" cx="10" cy="10" r="8"/><circle class="fg" id="ringFg" cx="10" cy="10" r="8" stroke-dasharray="50.27" stroke-dashoffset="50.27"/></svg>
        </div>
      </div>

      <div class="layer l-split" data-layer="split">
        <span class="badge" data-bind="line">S3</span>
        <span class="r" data-bind="next">Central</span>
      </div>

      <div class="layer l-expanded" data-layer="expanded">
        <div class="cam" id="cam" aria-hidden="true"></div>                       <!-- reserved top-centre zone (camera pill) -->
        <div class="x-lead"><div class="ex-icon" data-icon="train"></div></div>   <!-- LEADING -->
        <div class="x-trail">                                                    <!-- TRAILING -->
          <div class="big lc num"><span data-bind="etaNum">2</span><small data-bind="etaUnit">min</small></div>
          <div class="sub">Platform <span data-bind="platform">4</span></div>
        </div>
        <div class="x-center">                                                   <!-- CENTER (below the camera pill) -->
          <div class="ex-t">Next: <span data-bind="next">Central</span></div>
          <div class="ex-k"><span data-bind="line">S3</span> · <span data-bind="dest">Ringbahn</span></div>
        </div>
        <div class="x-bottom">                                                   <!-- BOTTOM -->
        <div class="track" id="track">
          <div class="rail"></div><div class="fill" id="fill"></div>
          <div class="stop passed" style="left:0%"></div>
          <div class="stop" id="stopNext" style="left:50%"></div>
          <div class="stop" style="left:100%"></div>
          <div class="lbl first" style="left:0%" data-bind="prev">Altstadt</div>
          <div class="lbl cur" style="left:50%" data-bind="next">Central</div>
          <div class="lbl last" style="left:100%" data-bind="after">Domplatz</div>
          <div class="train" id="trainDot" data-icon="train"></div>
        </div>
        <div class="ex-foot" id="exFoot">
          <span><span class="dot"></span><span class="st" data-bind="status">On time</span> · <span class="num" data-bind="speed">72</span> km/h</span>
          <span>Doors <span data-bind="doors">right</span></span>
        </div>
        </div>
      </div>

      <div class="layer l-alert" data-layer="alert" id="alertLayer">
        <div class="al-ic" id="alIc"></div>
        <div class="al-tx"><div class="al-t" id="alT">Title</div><div class="al-s" id="alS">Sub</div></div>
        <button class="al-btn" id="alBtn">Details</button>
      </div>

      <div class="layer l-actions" data-layer="actions">
        <div class="ac-h"><div class="row"><span class="badge" data-bind="line">S3</span>Driver controls</div><button class="ac-hide" id="acHide">Hide island</button></div>
        <div class="ac-grid">
          <button class="ac" data-act="doors"><i data-icon="door"></i>Doors</button>
          <button class="ac" data-act="horn"><i data-icon="horn"></i>Horn</button>
          <button class="ac" data-act="announce"><i data-icon="speaker"></i>Announce</button>
          <button class="ac" data-act="map"><i data-icon="map"></i>Map</button>
        </div>
      </div>
    </div>
    <div class="bubble" id="bubble"><div class="bi" data-icon="door"></div></div>
  </div>`;

/** Mounts the island into a positioned overlay container and returns window.AurealisIsland. */
export function mountIsland(container) {
container.insertAdjacentHTML('beforeend', MARKUP);
const root = container.querySelector('#island');
const q = sel => root.querySelector(sel);

/* ---------- icons (original line art) ---------- */
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  train:`<svg viewBox="0 0 24 24" ${S}><rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="14" r=".6" fill="currentColor"/><circle cx="15" cy="14" r=".6" fill="currentColor"/></svg>`,
  door:`<svg viewBox="0 0 24 24" ${S}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M9 11v2M15 11v2"/></svg>`,
  horn:`<svg viewBox="0 0 24 24" ${S}><path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M17.5 9.5a4 4 0 0 1 0 5M19.8 7.2a7.2 7.2 0 0 1 0 9.6"/></svg>`,
  speaker:`<svg viewBox="0 0 24 24" ${S}><rect x="3" y="7" width="18" height="10" rx="5"/><path d="M8 12h8M12 17v4M9 21h6"/></svg>`,
  map:`<svg viewBox="0 0 24 24" ${S}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>`,
  warn:`<svg viewBox="0 0 24 24" ${S}><path d="M12 3.5L2.8 19.5h18.4z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/></svg>`,
  bell:`<svg viewBox="0 0 24 24" ${S}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`,
  stop:`<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>`
};
root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = ICON[el.dataset.icon] || '');

/* ---------- spring curve for the content layers (CSS linear()) ---------- */
(function makeSpring(k = 235, c = 21.5) {
  if (!window.CSS || !CSS.supports('transition-timing-function', 'linear(0, 1)')) return;
  let x = 0, v = 0, t = 0; const dt = 1/1000, s = [];
  while (t < 2) { const a = -k*(x-1) - c*v; v += a*dt; x += v*dt; t += dt; s.push(x);
    if (Math.abs(x-1) < 4e-4 && Math.abs(v) < 8e-3) break; }
  const n = 56, pts = [];
  for (let i = 0; i <= n; i++) pts.push(i === n ? 1 : +s[Math.round(i/n*(s.length-1))].toFixed(4));
  root.style.setProperty('--spring', `linear(${pts.join(',')})`);
  root.style.setProperty('--dur', t.toFixed(3) + 's');
})();

/* ---------- liquid bridge between pill and bubble (metaball) ---------- */
const f = n => +n.toFixed(2);
const dist = (p, r) => Math.hypot(p[0]-r[0], p[1]-r[1]);
const vec = (c, a, r) => [c[0] + r*Math.cos(a), c[1] + r*Math.sin(a)];
function metaball(r1, r2, c1, c2, handle = 2.4, v = 0.5) {
  const d = dist(c1, c2), maxD = r1 + r2 * 1.2;
  if (!r1 || !r2 || d > maxD || d <= Math.abs(r1 - r2)) return '';
  let u1 = 0, u2 = 0;
  if (d < r1 + r2) {
    u1 = Math.acos(Math.max(-1, Math.min(1, (r1*r1 + d*d - r2*r2) / (2*r1*d))));
    u2 = Math.acos(Math.max(-1, Math.min(1, (r2*r2 + d*d - r1*r1) / (2*r2*d))));
  }
  const ab = Math.atan2(c2[1]-c1[1], c2[0]-c1[0]);
  const spread = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const a1 = ab + u1 + (spread - u1)*v, a2 = ab - u1 - (spread - u1)*v;
  const a3 = ab + Math.PI - u2 - (Math.PI - u2 - spread)*v, a4 = ab - Math.PI + u2 + (Math.PI - u2 - spread)*v;
  const p1 = vec(c1, a1, r1), p2 = vec(c1, a2, r1), p3 = vec(c2, a3, r2), p4 = vec(c2, a4, r2);
  const dd = Math.min(v*handle, dist(p1, p3)/(r1 + r2)) * Math.min(1, d*2/(r1 + r2));
  const h1 = vec(p1, a1 - Math.PI/2, r1*dd), h2 = vec(p2, a2 + Math.PI/2, r1*dd);
  const h3 = vec(p3, a3 + Math.PI/2, r2*dd), h4 = vec(p4, a4 - Math.PI/2, r2*dd);
  const P = r => `${f(r[0])} ${f(r[1])}`;
  return `M${P(p1)} C${P(h1)} ${P(h3)} ${P(p3)} A${f(r2)} ${f(r2)} 0 ${d > r1 ? 1 : 0} 0 ${P(p4)} C${P(h4)} ${P(h2)} ${P(p2)} Z`;
}

/* ---------- continuous (Apple-style) corners, island only ----------
   Corner geometry as measured from UIKit's paths by the PaintCode team: 3 cubic curves per corner,
   starting 1.52866483 × r from the corner, r capped at min(w,h)/2/1.52866483. Near full radius we
   blend toward a true capsule end so pills don't look boxy. */
const EXT = 1.52866483;
const SEGS = [[1.08849323,0],[0.86840689,0],[0.66993427,0.065496], [0.63149399,0.074911],
  [0.37282392,0.16905899],[0.16906013,0.37282401],[0.07491176,0.63149399], [0,0.86840701],[0,1.08849299],[0,EXT]];
const CIRC = [[1,0],[1,0],[1,0],[1,0],[1,0],[0.734784,0],[0.48043,0.10535],[0.29289,0.29289],[0.10535,0.48043],[0,0.734784],[0,1]];
const CAPSULE_BLEND = 0.7;
function squircle(w, h, r) {
  const half = Math.min(w, h) / 2, limit = half / EXT;
  r = Math.max(0, Math.min(r, half));
  const R = Math.min(r, limit);
  const t = r > limit ? Math.min(1, (r - limit) / (half - limit)) * CAPSULE_BLEND : 0;
  const pts = [[EXT,0], ...SEGS].map(([u, v], i) => [u*R + (CIRC[i][0]*r - u*R)*t, v*R + (CIRC[i][1]*r - v*R)*t]);
  const C = [[w,0,-1,0,0,1],[w,h,0,-1,-1,0],[0,h,1,0,0,-1],[0,0,0,1,1,0]];
  const P = (k, [u, v]) => `${f(k[0] + u*k[2] + v*k[4])} ${f(k[1] + u*k[3] + v*k[5])}`;
  let d = '';
  C.forEach((k, i) => { const q = pts.map(p => P(k, p));
    d += (i ? 'L' : 'M') + q[0] + `C${q[1]} ${q[2]} ${q[3]}L${q[4]}C${q[5]} ${q[6]} ${q[7]}C${q[8]} ${q[9]} ${q[10]}`; });
  return d + 'Z';
}
const cam = root.querySelector('#cam');
if (cam) cam.style.clipPath = `path('${squircle(126, 37, 18.5)}')`;

/* ---------- sizes + frame-by-frame springs ---------- */
const pill = q('#pill'), bubble = q('#bubble'), bubbleIcon = q('#bubble .bi'), bridgePath = q('#bridgePath');
const SIZES = {
  idle:{w:126,h:37,r:18.5}, compact:{w:250,h:37,r:18.5}, split:{w:196,h:37,r:18.5},
  expanded:{w:376,h:178,r:36}, alert:{w:352,h:76,r:38}, actions:{w:352,h:164,r:44}
};
const LAYERS = [...root.querySelectorAll('[data-layer]')];
LAYERS.forEach(l => l.style.width = SIZES[l.dataset.layer].w + 'px');

const SPR = { main:{k:235, c:21.5}, gap:{k:110, c:13.5}, bub:{k:300, c:22} };
const sv = (x, cfg) => ({ x, v:0, t:x, cfg });
const A = { w:sv(126,SPR.main), h:sv(37,SPR.main), r:sv(18.5,SPR.main), bw:sv(0,SPR.bub), gap:sv(0,SPR.gap) };
let raf = null, last = 0;
function setTargets() {
  const z = SIZES[state], sp = state === 'split';
  A.w.t = z.w; A.h.t = z.h; A.r.t = z.r; A.bw.t = sp ? 37 : 0; A.gap.t = sp ? 7 : -4;
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
}
function step(now) {
  // In-game fix: a rAF timestamp can precede the performance.now() taken in setTargets() (heavy WebGL
  // frames), which gave a negative dt and made the springs diverge. Never step backwards in time.
  const dt = Math.max(0, Math.min(0.034, (now - last) / 1000)); last = now;
  let moving = false; const N = 4, h = dt / N;
  for (const key in A) {
    const a = A[key];
    for (let i = 0; i < N; i++) { const acc = -a.cfg.k*(a.x - a.t) - a.cfg.c*a.v; a.v += acc*h; a.x += a.v*h; }
    if (Math.abs(a.x - a.t) > 0.02 || Math.abs(a.v) > 0.02) moving = true; else { a.x = a.t; a.v = 0; }
  }
  draw();
  raf = moving ? requestAnimationFrame(step) : null;
}
function draw() {
  const w = Math.max(37, A.w.x), h = Math.max(30, A.h.x);
  pill.style.width = w + 'px'; pill.style.height = h + 'px';
  const clip = `path('${squircle(w, h, Math.max(0, A.r.x))}')`;             // continuous corners, redrawn every frame
  pill.style.clipPath = clip; pill.style.webkitClipPath = clip;
  const bw = Math.max(0, A.bw.x), gap = A.gap.x, cy = Math.min(h, 37) / 2;
  bubble.style.width = bubble.style.height = bw + 'px';
  bubble.style.left = (w/2 + gap) + 'px'; bubble.style.top = (cy - bw/2) + 'px';
  bubble.style.opacity = bw > 0.8 ? 1 : 0;
  bubbleIcon.style.transform = `scale(${Math.min(1, bw/37)})`;
  bridgePath.setAttribute('d', bw > 1 && h < 46 ? metaball(cy, bw/2, [w/2 - cy, cy], [w/2 + gap + bw/2, cy]) : '');
}

/* ---------- state machine ---------- */
let state = 'idle', base = 'compact', alertTimer = null, doorMode = null, hidden = false;
const OPEN = ['expanded', 'actions', 'alert'];
const rest = () => doorMode ? 'split' : base;          // where the island settles when nothing is open

function setState(s) {
  if (!SIZES[s]) return;
  const changed = s !== state;
  state = s; root.dataset.state = s;
  setTargets();
  root.classList.toggle('lifted', OPEN.includes(s));
  LAYERS.forEach(l => { const on = l.dataset.layer === s; l.classList.toggle('on', on); l.inert = !on; });  // hidden layers can't be tabbed into
  if (s !== 'alert') clearTimeout(alertTimer);
  if (changed && typeof API.onState === 'function') API.onState(s);
}
function userState(s) {
  if (hidden && s !== 'idle' && s !== 'compact') return;          // stays tucked away until show()
  if (s === 'alert') { console.warn('AurealisIsland: use alert({...}) to show an alert'); return; }
  if (!SIZES[s]) return;
  if (s === 'split') { doors(doorMode || 'closing'); setState('split'); return; }   // split always comes with a doors bubble
  if (s === 'idle' || s === 'compact') { base = s; setState(rest()); return; }
  setState(s);
}

function alert({tone='info', icon='bell', title='', sub='', action='Details', duration=3400} = {}) {
  if (hidden) { if (!API.alertsWhenHidden) return; show(); }
  q('#alertLayer').className = 'layer l-alert tone-' + tone + (state === 'alert' ? ' on' : '');
  q('#alIc').innerHTML = ICON[icon] || '';
  q('#alT').textContent = title; q('#alS').textContent = sub;
  q('#alBtn').textContent = action; q('#alBtn').style.display = action ? '' : 'none';
  setState('alert');
  clearTimeout(alertTimer);
  if (duration) alertTimer = setTimeout(() => { if (state === 'alert') setState(rest()); }, duration);
}

function doors(mode) {
  doorMode = mode || null;
  bubble.className = 'bubble' + (doorMode ? ' ' + doorMode : '');
  if (doorMode && (state === 'idle' || state === 'compact' || state === 'split')) setState('split');
  if (!doorMode && state === 'split') setState(base);
}

/* ---------- hide / show ---------- */
function setHidden(h) {
  h = !!h; if (h === hidden) return;
  hidden = h;
  if (h) { clearTimeout(alertTimer); setState('idle'); }     // shrink to the pill first, then fade out
  root.classList.toggle('hidden', h);
  root.inert = h;
  if (!h) setState(rest());
  if (typeof API.onVisibility === 'function') API.onVisibility(h);
}
const hide = () => setHidden(true), show = () => setHidden(false);

/* ---------- interactions ---------- */
function activate() {
  ({ idle:()=>setState('compact'), compact:()=>setState('expanded'), split:()=>setState('expanded'),
     expanded:()=>setState(rest()), alert:()=>setState('expanded'), actions:()=>{} })[state]();
}
let pressT = null, longFired = false;
pill.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;     // left button / touch only
  longFired = false; root.classList.add('press');
  pressT = setTimeout(() => { longFired = true; root.classList.remove('press'); setState('actions'); }, 460);
});
const endPress = () => { clearTimeout(pressT); root.classList.remove('press'); };
['pointerup','pointerleave','pointercancel'].forEach(ev => pill.addEventListener(ev, endPress));
pill.addEventListener('click', e => {
  if (e.target.closest('button')) return;
  if (longFired) { longFired = false; return; }                 // swallow only the click that ends a long-press
  activate();
});
pill.addEventListener('keydown', e => {
  if (e.target !== pill) return;                                // let inner buttons handle their own keys
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
});
pill.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerdown', e => {
  if (!hidden && API.closeOnOutsideClick && !root.contains(e.target) && (state === 'expanded' || state === 'actions')) setState(rest());
});
document.addEventListener('keydown', e => {
  if (hidden || !API.escapeKey || e.key !== 'Escape' || !OPEN.includes(state)) return;   // only when something is open
  e.preventDefault(); e.stopImmediatePropagation();                            // first Esc closes the island, not the game menu
  setState(rest());
}, true);
q('#alBtn').addEventListener('click', e => { e.stopPropagation(); setState('expanded'); });
q('#acHide').addEventListener('click', e => { e.stopPropagation(); hide(); });
bubble.addEventListener('click', e => { e.stopPropagation(); setState('expanded'); });
root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  b.classList.add('hot'); setTimeout(() => b.classList.remove('hot'), 500);
  if (typeof API.onAction === 'function') API.onAction(b.dataset.act);
}));

/* ---------- data binding (text only, never HTML) ---------- */
const D = { line:'S3', color:'#F2B33D', dest:'Ringbahn', prev:'Altstadt', next:'Central', after:'Domplatz',
            etaSec:120, progress:0, platform:'4', speed:72, delayMin:0, doors:'right' };
let lastP = 0;
function render() {
  const e = Math.max(0, Math.round(D.etaSec));
  const vals = { ...D,
    etaShort: e === 0 ? 'Now' : e < 60 ? e + ' s' : Math.round(e/60) + ' min',
    etaNum: e === 0 ? 'Now' : e < 60 ? e : Math.round(e/60), etaUnit: e === 0 ? '' : e < 60 ? 's' : 'min',
    status: D.delayMin > 0 ? `+${D.delayMin} min late` : 'On time', speed: Math.round(D.speed) };
  root.querySelectorAll('[data-bind]').forEach(el => { const v = String(vals[el.dataset.bind] ?? ''); if (el.textContent !== v) el.textContent = v; });
  root.style.setProperty('--line', D.color);
  const p = Math.min(1, Math.max(0, D.progress)), track = q('#track');
  if (p < lastP - 0.3) track.classList.add('reset');            // new segment: jump back without sliding
  q('#fill').style.width = (p*50) + '%'; q('#trainDot').style.left = (p*50) + '%';
  if (track.classList.contains('reset')) { void track.offsetWidth; track.classList.remove('reset'); }
  lastP = p;
  q('#stopNext').classList.toggle('passed', p >= 1);
  q('#ringFg').style.strokeDashoffset = 50.27 * (1 - p);
  q('#exFoot').classList.toggle('late', D.delayMin > 0);
}

const API = window.AurealisIsland = {
  setState: userState, alert, doors, hide, show, toggle: () => setHidden(!hidden),
  get hidden() { return hidden; },
  update: data => { Object.assign(D, data || {}); render(); },
  get state() { return state; },
  get doorMode() { return doorMode; },
  get data() { return { ...D }; },
  onAction: null, onState: null, onVisibility: null, alertsWhenHidden: false,
  escapeKey: true, closeOnOutsideClick: true
};

render(); setState('idle'); draw();
return API;
}
