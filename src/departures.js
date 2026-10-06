import * as THREE from 'three';
import { box, canvasTexture } from './geometry.js';

export const INITIAL_DEPARTURES = [
  { route: 'U1', destination: 'Central', minutes: 2, platform: '01', color: '#c8784d' },
  { route: 'U3', destination: 'Airport', minutes: 6, platform: '01', color: '#509b91' },
  { route: 'U6', destination: 'City Centre', minutes: 11, platform: '02', color: '#a28abb' },
  { route: 'U2', destination: 'North Park', minutes: 16, platform: '02', color: '#6094be' },
  { route: 'U4', destination: 'West End', minutes: 22, platform: '01', color: '#c9ab58' },
];

/** The same data feeds the physical display and the small HUD. */
export class DeparturesBoard extends THREE.Group {
  constructor(materials, { position = [-2.2, 3.5, -22], yaw = -2.64 } = {}) {
    super();
    this.name = 'DeparturesBoard';
    this.position.set(...position);
    this.rotation.y = yaw;
    this.departures = INITIAL_DEPARTURES.map(item => ({ ...item }));
    this.clock = '14:32';
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
    this.departures = departures.map(item => ({ ...item }));
    this.revision++;
    this.renderDisplay();
  }

  setClock(clock) {
    if (clock === this.clock) return;
    this.clock = clock;
    this.renderDisplay();
  }

  renderDisplay() {
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.width;
    ctx.fillStyle = '#111e1d'; ctx.fillRect(0, 0, w, 640);
    ctx.fillStyle = '#cedecc'; ctx.font = '600 43px Arial'; ctx.fillText('DEPARTURES', 56, 65);
    ctx.fillStyle = '#e0e6d9'; ctx.font = '500 39px monospace'; ctx.textAlign = 'right'; ctx.fillText(this.clock, w - 54, 65); ctx.textAlign = 'left';
    ctx.fillStyle = '#7b9990'; ctx.fillRect(54, 93, w - 108, 2);
    ctx.font = '22px Arial'; ctx.fillText('LINE', 59, 131); ctx.fillText('DESTINATION', 218, 131); ctx.fillText('PLATFORM', 1058, 131); ctx.fillText('DUE', 1360, 131);
    this.departures.slice(0, 5).forEach((item, index) => {
      const y = 190 + index * 84;
      ctx.fillStyle = item.color; ctx.beginPath(); ctx.roundRect(56, y - 29, 100, 51, 7); ctx.fill();
      ctx.font = 'bold 32px Arial'; ctx.fillStyle = '#fff7e9'; ctx.fillText(item.route, 81, y + 8);
      ctx.font = '500 43px Arial'; ctx.fillStyle = '#f0efd7'; ctx.fillText(item.destination.toUpperCase(), 218, y + 8);
      ctx.font = '37px monospace'; ctx.fillStyle = '#abc2b7'; ctx.fillText(item.platform, 1106, y + 8);
      ctx.textAlign = 'right'; ctx.fillStyle = '#e8c779'; ctx.font = '40px monospace'; ctx.fillText(`${item.minutes} min`, w - 56, y + 8); ctx.textAlign = 'left';
      ctx.fillStyle = '#263a34'; ctx.fillRect(56, y + 38, w - 112, 1);
    });
    ctx.fillStyle = '#86a296'; ctx.font = '20px Arial'; ctx.fillText('NORDPLATZ     •     Please stand behind the safety line', 56, 620);
    this.texture.needsUpdate = true;
  }
}
