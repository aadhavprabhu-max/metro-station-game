import * as THREE from 'three';
import { box, canvasTexture } from './geometry.js';

// Live rows come from each running train service; no sample timetable is shown.
export const INITIAL_DEPARTURES = [];

/** The same data feeds the physical display and the small HUD. */
export class DeparturesBoard extends THREE.Group {
  constructor(materials, { position = [-2.2, 3.5, -22], yaw = -2.64, stationName = 'Nordplatz' } = {}) {
    super();
    this.name = 'DeparturesBoard';
    this.position.set(...position);
    this.rotation.y = yaw;
    this.departures = INITIAL_DEPARTURES.map(item => ({ ...item }));
    this.clock = '14:32';
    this.stationName = stationName;
    this.networkInfo = [];
    this.platformLineId = 'U1';
    this.platformNumber = '01';
    this.interchange = false;
    this.revision = 0;
    box(this, materials.dark, [4.35, 1.88, 0.18], [0, 0, 0]);
    box(this, materials.aluminum, [4.4, 0.03, 0.18], [0, -0.93, 0]);
    box(this, materials.rubber, [4.12, 1.66, 0.035], [0, 0, 0.1]);
    for (const x of [-1.6, 1.6]) {
      box(this, materials.steel, [0.045, 1.1, 0.045], [x, 1.48, 0]);
      box(this, materials.dark, [0.19, 0.04, 0.19], [x, 2.02, 0]);
    }
    this.texture = canvasTexture(1536, 640, () => {});
    this.canvas = this.texture.image;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 1.66), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.screen.position.z = 0.122;
    this.add(this.screen);
    this.renderDisplay();
  }

  setDepartures(departures) {
    // A live service may ask for the same rows many times. Upload the screen
    // texture only when the visible timetable actually changes.
    if (JSON.stringify(departures) === JSON.stringify(this.departures)) return;
    this.departures = departures.map(item => ({ ...item }));
    this.revision++;
    this.renderDisplay();
  }

  setClock(clock) {
    if (clock === this.clock) return;
    this.clock = clock;
    this.renderDisplay();
  }

  setStationName(stationName) {
    if (stationName === this.stationName) return;
    this.stationName = stationName;
    this.renderDisplay();
  }

  setNetworkInfo(lines) {
    if (JSON.stringify(lines) === JSON.stringify(this.networkInfo)) return;
    this.networkInfo = lines.map(line => ({ ...line, stations: [...line.stations] }));
    this.renderDisplay();
  }

  setPlatformInfo(lineId, platform, interchange = false) {
    if (lineId === this.platformLineId && platform === this.platformNumber && interchange === this.interchange) return;
    this.platformLineId = lineId;
    this.platformNumber = platform;
    this.interchange = interchange;
    this.renderDisplay();
  }

  renderDisplay() {
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.width;
    ctx.fillStyle = '#111e1d'; ctx.fillRect(0, 0, w, 640);
    ctx.fillStyle = '#cedecc'; ctx.font = '600 43px Arial'; ctx.fillText('DEPARTURES', 56, 65);
    ctx.fillStyle = '#e0e6d9'; ctx.font = '500 39px monospace'; ctx.textAlign = 'right'; ctx.fillText(this.clock, w - 54, 65); ctx.textAlign = 'left';
    ctx.fillStyle = '#7b9990'; ctx.fillRect(54, 93, w - 108, 2);
    ctx.font = '22px Arial'; ctx.fillText('LINE', 59, 131); ctx.fillText('DESTINATION / NEXT STOP', 218, 131); ctx.fillText('PLATFORM', 1058, 131); ctx.fillText('DUE', 1360, 131);
    this.departures.slice(0, 5).forEach((item, index) => {
      const y = 190 + index * 84;
      ctx.fillStyle = item.color; ctx.beginPath(); ctx.roundRect(56, y - 29, 100, 51, 7); ctx.fill();
      ctx.font = 'bold 32px Arial'; ctx.fillStyle = '#fff7e9'; ctx.fillText(item.route, 81, y + 8);
      const destination = item.destination.toUpperCase();
      let fontSize = item.nextStop ? 37 : 43;
      ctx.font = `500 ${fontSize}px Arial`;
      while (ctx.measureText(destination).width > 790 && fontSize > 28) ctx.font = `500 ${--fontSize}px Arial`;
      ctx.fillStyle = '#f0efd7'; ctx.fillText(destination, 218, item.nextStop ? y - 3 : y + 8);
      if (item.nextStop) {
        ctx.font = '22px Arial'; ctx.fillStyle = '#b6c9bd';
        ctx.fillText(`${item.direction}  ·  Next ${item.nextStop}`, 218, y + 25, 790);
      }
      ctx.font = '37px monospace'; ctx.fillStyle = '#abc2b7'; ctx.fillText(item.platform, 1106, y + 8);
      ctx.textAlign = 'right'; ctx.fillStyle = '#e8c779'; ctx.font = item.due && item.due.length > 7 ? '32px monospace' : '40px monospace'; ctx.fillText(item.due ?? `${item.minutes} min`, w - 56, y + 8); ctx.textAlign = 'left';
      ctx.fillStyle = '#263a34'; ctx.fillRect(56, y + 38, w - 112, 1);
    });
    if (this.networkInfo.length && this.departures.length < 5) {
      const y = 190 + this.departures.length * 84;
      ctx.fillStyle = '#7fa398'; ctx.font = '20px Arial'; ctx.fillText('LIVE NETWORK · CHANGE AT CENTRAL', 56, y - 3);
      this.networkInfo.slice(0, 2).forEach((line, index) => {
        ctx.fillStyle = line.color; ctx.font = 'bold 24px Arial'; ctx.fillText(line.id, 56, y + 25 + index * 27);
        ctx.fillStyle = '#b6c9bd'; ctx.font = '22px Arial'; ctx.fillText(line.stations.join('  →  '), 128, y + 25 + index * 27, w - 184);
      });
    }
    const guidance = this.interchange ? 'U1 / U2 transfer · Follow passage signs' : 'Please stand behind the safety line';
    ctx.fillStyle = '#86a296'; ctx.font = '20px Arial'; ctx.fillText(`${this.stationName.toUpperCase()}  ·  ${this.platformLineId} PLATFORM ${this.platformNumber}  ·  ${guidance}`, 56, 620, w - 112);
    this.texture.needsUpdate = true;
  }
}
