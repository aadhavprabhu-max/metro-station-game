import * as THREE from 'three';
import { canvasTexture, seededRandom } from './geometry.js';

export function createMaterials() {
  const random = seededRandom();
  const concreteMap = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b4b4aa';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 20000; i++) {
      const shade = Math.floor(120 + random() * 100);
      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.16)`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
  });
  concreteMap.wrapS = concreteMap.wrapT = THREE.RepeatWrapping;
  concreteMap.repeat.set(3, 2);
  const ballastMap = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#353836'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      const shade = Math.floor(36 + random() * 50);
      ctx.fillStyle = `rgb(${shade},${shade + 2},${shade})`;
      ctx.beginPath();
      ctx.ellipse(random() * w, random() * h, 1 + random() * 4, 1 + random() * 3, random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ballastMap.wrapS = ballastMap.wrapT = THREE.RepeatWrapping;
  ballastMap.repeat.set(4, 80);
  const standard = (color, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    concrete: new THREE.MeshStandardMaterial({ color: '#c0c0b3', map: concreteMap, roughness: 0.92 }),
    tile: standard('#bfc2b7', 0.78), grout: standard('#858b80', 0.96),
    wall: standard('#a9b5aa', 0.82), wallTile: standard('#d6dad1', 0.5),
    greenTile: standard('#496a60', 0.52), beam: standard('#747f77', 0.72, 0.18),
    dark: standard('#242f2e', 0.8, 0.2), rubber: standard('#182222', 0.94),
    steel: standard('#99a8a7', 0.32, 0.83), aluminum: standard('#acb7b6', 0.39, 0.65),
    whitePaint: standard('#d6ded9', 0.4, 0.3), trainAccent: standard('#316c65', 0.4, 0.2),
    trainBlue: standard('#287fbb', 0.36, 0.22),
    trainSilver: standard('#b9c1c8', 0.42, 0.55),
    cabCharcoal: standard('#253039', 0.58, 0.25),
    yellow: standard('#c4a759', 0.79), wood: standard('#9b7960', 0.82),
    trackBed: new THREE.MeshStandardMaterial({ map: ballastMap, roughness: 1, color: '#9fa39f' }),
    sleeper: standard('#66685e', 0.95), wheel: standard('#3e4848', 0.55, 0.8),
    interior: standard('#d6d8cc', 0.84), seat: standard('#617a73', 0.9),
    glass: new THREE.MeshPhysicalMaterial({ color: '#597975', metalness: 0.12, roughness: 0.16, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    trainGlass: new THREE.MeshPhysicalMaterial({ color: '#29424d', metalness: 0.16, roughness: 0.14, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    cabGlass: new THREE.MeshPhysicalMaterial({ color: '#17252e', roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide }),
    warmLight: new THREE.MeshStandardMaterial({ color: '#fff0ce', emissive: '#fff1d4', emissiveIntensity: 2.5, roughness: 0.5 }),
    tubeLight: new THREE.MeshStandardMaterial({ color: '#eff3e7', emissive: '#eff8ea', emissiveIntensity: 3, roughness: 0.4 }),
    redLight: new THREE.MeshBasicMaterial({ color: '#df594e', toneMapped: false }),
  };
}
