import * as THREE from 'three';

/** Cull remote geometry and the adjacent hall behind its opaque dividing wall.
 * Every service continues simulating. Pedestrian passages reveal the connected
 * halls on their actual floor; nothing moves when visibility changes.
 */
export class WorldVisibility {
  constructor(world) {
    this.world = world;
    this.range = 145;
    this.sections = [];
    world.scene.updateMatrixWorld(true);
    for (const [lineId, root] of Object.entries(world.lineWorlds)) {
      for (const group of root.children) {
        if (group.stationId || world.interchanges.includes(group)) continue;
        this.sections.push({ lineId, group, bounds: new THREE.Box3().setFromObject(group) });
      }
    }
    this.stationCenters = new Map(world.stations.map(station => [station, station.getWorldPosition(new THREE.Vector3())]));
    this.nearest = new THREE.Vector3();
  }

  update(player) {
    const { world } = this;
    const camera = player.camera.position;
    const lineId = player.service?.lineId ?? 'U1';
    const feetY = camera.y - 1.76;
    const visibleLines = new Set([lineId]);
    if (player.transferSurface) {
      visibleLines.clear();
      for (const id of feetY > -6 ? ['U1', 'U2'] : ['U3', 'U4']) visibleLines.add(id);
    }
    if (!player.ridingCar) for (const interchange of world.interchanges) {
      const passage = interchange.worldBounds;
      const inPassage = Math.abs(feetY - interchange.floorY) < 0.6
        && camera.x >= passage.minX - 0.8 && camera.x <= passage.maxX + 0.8
        && camera.z >= passage.minZ - 1 && camera.z <= passage.maxZ + 1;
      if (inPassage) for (const platform of interchange.platforms) visibleLines.add(platform.lineId);
    }
    const showsLine = id => visibleLines.has(id);
    let changed = false;
    const show = (object, visible) => {
      if (object.visible !== visible) { object.visible = visible; changed = true; }
    };
    for (const station of world.stations) {
      show(station, showsLine(station.lineId) && Math.abs(this.stationCenters.get(station).z - camera.z) < this.range + 44);
    }
    for (const { lineId: sectionLine, group, bounds } of this.sections) {
      bounds.clampPoint(camera, this.nearest);
      show(group, showsLine(sectionLine) && this.nearest.distanceToSquared(camera) < this.range * this.range);
    }
    for (const train of world.trains) show(train, showsLine(train.lineId) && Math.abs(train.position.z - camera.z) < this.range + 26);
    world.lighting.children.forEach(group => {
      const station = world.stations.find(item => item.platformId === group.userData.platformId);
      if (station) show(group, station.visible);
    });
    for (const interchange of world.interchanges) {
      show(interchange, interchange.platforms.some(platform => showsLine(platform.lineId))
        && Math.abs(camera.z + 264) < this.range);
    }
    show(world.verticalInterchange, Math.abs(camera.z + 288) < this.range
      && (player.station.stationId === 'station-2' || Boolean(player.transferSurface)));
    if (changed) world.renderer.shadowMap.needsUpdate = true;
  }
}
