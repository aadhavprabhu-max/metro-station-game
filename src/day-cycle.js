import * as THREE from 'three';

/**
 * One shared clock for the HUD, the timetable boards and the surface sky.
 * A full 24-hour day lasts 34 real minutes, so one game hour is 85 seconds.
 * `?time=HH:MM` in the URL sets the starting time (default 14:32).
 */
export const DAY_SECONDS = 34 * 60;
const MINUTES_PER_SECOND = 1440 / DAY_SECONDS;

export function parseClock(text) {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(String(text ?? '').trim());
  if (!match || +match[1] > 23 || +match[2] > 59) return null;
  return +match[1] * 60 + +match[2];
}

const startParam = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('time');

export const dayClock = {
  minutes: parseClock(startParam) ?? 14 * 60 + 32,
  advance(seconds) { if (seconds > 0) this.minutes = (this.minutes + seconds * MINUTES_PER_SECOND) % 1440; },
  /** Jump to a time of day: 'HH:MM' or minutes after midnight. */
  set(time) { const m = typeof time === 'number' ? time : parseClock(time); if (m !== null) this.minutes = ((m % 1440) + 1440) % 1440; },
  get hours() { return this.minutes / 60; },
  text() { const m = Math.floor(this.minutes); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; },
};

/**
 * Sky and light keyframes by hour. Sunrise runs purple → pink → orange → gold → blue;
 * sunset runs back through gold → orange → pink → purple into a navy night.
 * [hour, zenith, mid sky, horizon, key light colour, key intensity, hemi sky, hemi ground, hemi intensity, sun glow, night, exposure]
 */
const NIGHT = ['#050a1f', '#0b1638', '#1b2752', '#9fb4ff', 0.32, '#41528a', '#16161f', 0.6, 0.0, 1, 1.0];
const DAY = ['#0f3fb8', '#2f7fe0', '#a9d8f0', '#fff0d2', 3.4, '#cfe3ff', '#c8b08a', 1.0, 0.3, 0, 0.95];
const KEYS = [
  [0, ...NIGHT],
  [4.6, '#070c26', '#0e1a42', '#1f2b5c', '#a8b8ff', 0.3, '#41528a', '#16161f', 0.6, 0.05, 1, 1.0],
  [5.3, '#161a52', '#3d2a78', '#8a4fa8', '#c9a0ff', 0.14, '#6a5aa0', '#2a2030', 0.62, 0.7, 0.9, 1.0], // purple
  [5.8, '#28358f', '#9a4a9e', '#ff7a8c', '#ff8a7a', 0.05, '#b07aa8', '#4a3030', 0.72, 1.3, 0.7, 1.0], // pink
  [6.3, '#3a5cc0', '#f08a5c', '#ffa040', '#ffa860', 1.3, '#f0b090', '#8a6040', 0.85, 1.4, 0.3, 0.98], // orange
  [6.9, '#2a62d0', '#8fbde8', '#ffdc78', '#ffd8a0', 2.4, '#e0e0f0', '#b8a080', 0.95, 0.8, 0.05, 0.96], // gold
  [7.8, ...DAY],
  [16.8, ...DAY],
  [17.7, '#2558c8', '#8cb8e6', '#ffdf86', '#ffd28a', 2.6, '#e8dccc', '#b89a70', 0.95, 0.8, 0.05, 0.96], // gold
  [18.2, '#2f469e', '#ee7e4c', '#ff9838', '#ff9850', 1.4, '#f0a080', '#806040', 0.85, 1.5, 0.3, 0.98], // orange
  [18.7, '#262c7c', '#b84a92', '#ff607c', '#ff6a70', 0.05, '#b07090', '#403040', 0.72, 1.4, 0.65, 1.0], // pink
  [19.3, '#14174c', '#4a2a80', '#8448a6', '#b0a0ff', 0.15, '#5a4a90', '#201a2a', 0.62, 0.7, 0.9, 1.0], // purple
  [20.2, ...NIGHT],
  [24, ...NIGHT],
].map(([hour, ...v]) => ({ hour, v: v.map(x => typeof x === 'string' ? new THREE.Color(x) : x) }));

/** Share of windows switched on: rising through the evening, thinning after midnight. */
const LIT = [[0, 0.42], [2.5, 0.26], [4.5, 0.22], [6, 0.34], [8, 0.15], [16, 0.12], [18, 0.34], [20, 0.56], [23, 0.52], [24, 0.42]];

// Sunrise 05:48, noon 12:15, sunset 18:42. Azimuth is chosen so mid-afternoon matches the original fixed sun.
const SUNRISE = 5.8, DAYLIGHT = 12.9, MAX_ELEVATION = THREE.MathUtils.degToRad(55), NOON_AZIMUTH = THREE.MathUtils.degToRad(184.85);

const lerp = (a, b, t) => a + (b - a) * t;
export function daylightState(hours, out = {}) {
  const h = ((hours % 24) + 24) % 24;
  let i = 0; while (KEYS[i + 1].hour <= h && i < KEYS.length - 2) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = (h - a.hour) / (b.hour - a.hour), s = t * t * (3 - 2 * t);
  const names = ['zenith', 'mid', 'horizon', 'keyColor', 'keyIntensity', 'hemiSky', 'hemiGround', 'hemiIntensity', 'glow', 'night', 'exposure'];
  names.forEach((name, k) => {
    const x = a.v[k], y = b.v[k];
    if (x.isColor) (out[name] ??= new THREE.Color()).copy(x).lerp(y, s); else out[name] = lerp(x, y, s);
  });
  let j = 0; while (LIT[j + 1][0] <= h && j < LIT.length - 2) j++;
  out.lit = lerp(LIT[j][1], LIT[j + 1][1], (h - LIT[j][0]) / (LIT[j + 1][0] - LIT[j][0]));
  // Sun path; below the horizon the key light becomes the moon, opposite and above.
  const elevation = Math.sin(Math.PI * (h - SUNRISE) / DAYLIGHT) * MAX_ELEVATION;
  const azimuth = NOON_AZIMUTH + (h - (SUNRISE + DAYLIGHT / 2)) * Math.PI / DAYLIGHT;
  out.sun = (out.sun ?? new THREE.Vector3()).set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));
  const moonElevation = Math.max(THREE.MathUtils.degToRad(28), -elevation);
  out.moon = (out.moon ?? new THREE.Vector3()).set(-Math.cos(moonElevation) * Math.cos(azimuth), Math.sin(moonElevation), -Math.cos(moonElevation) * Math.sin(azimuth));
  out.sunUp = elevation > 0;
  out.light = out.sunUp ? out.sun : out.moon;
  return out;
}
