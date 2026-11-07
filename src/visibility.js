import * as THREE from 'three';

/** Spatial culling only. Hidden railways continue running their real services. */
export class WorldVisibility {
  constructor(world) {
    this.world = world; this.range = 145; this.sections = [];
    world.scene.updateMatrixWorld(true);
    for (const [lineId, root] of Object.entries(world.lineWorlds)) {
      for (const group of root.children) {
        if (group.stationId || world.interchanges.includes(group)) continue;
        this.sections.push({ lineId, group, bounds: new THREE.Box3().setFromObject(group) });
      }
    }
    this.stationCenters = new Map(world.stations.map(station => [station, station.getWorldPosition(new THREE.Vector3())]));
    this.transferBounds = new Map([...world.interchanges, ...world.pedestrianTransfers].map(transfer => {
      const b = transfer.worldBounds;
      return [transfer, new THREE.Box3(new THREE.Vector3(b.minX, b.minY ?? transfer.floorY, b.minZ),
        new THREE.Vector3(b.maxX, b.maxY ?? transfer.floorY + 4, b.maxZ))];
    }));
    this.nearest = new THREE.Vector3();
  }

  update(player) {
    const { world } = this, camera = player.camera.position, feetY = camera.y - 1.76;
    const visibleLines = new Set([player.service?.lineId ?? 'U1']);
    const transfer = player.transferSurface?.transfer;
    if (transfer) for (const platform of transfer.platforms) visibleLines.add(platform.lineId);
    if (!player.ridingCar) for (const interchange of world.interchanges) {
      const passage = interchange.worldBounds;
      if (Math.abs(feetY - interchange.floorY) < 0.6
        && camera.x >= passage.minX - 0.8 && camera.x <= passage.maxX + 0.8
        && camera.z >= passage.minZ - 1 && camera.z <= passage.maxZ + 1) {
        for (const platform of interchange.platforms) visibleLines.add(platform.lineId);
      }
    }
    let changed = false;
    const show = (object, visible) => {
      if (object.visible !== visible) { object.visible = visible; changed = true; }
    };
    const near = (bounds, range = this.range) => {
      bounds.clampPoint(camera, this.nearest);
      return this.nearest.distanceToSquared(camera) < range * range;
    };
    for (const station of world.stations) show(station,
      visibleLines.has(station.lineId) && this.stationCenters.get(station).distanceToSquared(camera) < (station.lineId === 'U10' && feetY > 4 ? 1800 : this.range + 55) ** 2);
    for (const { lineId, group, bounds } of this.sections) show(group, visibleLines.has(lineId) && near(bounds, lineId === 'U10' && feetY > 4 ? 1800 : this.range));
    for (const train of world.trains) show(train,
      visibleLines.has(train.lineId) && train.position.distanceToSquared(camera) < (train.lineId === 'U10' ? 600 : this.range + 30) ** 2);
    world.lighting.children.forEach(group => {
      const station = world.stations.find(item => item.platformId === group.userData.platformId);
      if (station) show(group, station.visible);
    });
    for (const interchange of [...world.interchanges, ...world.pedestrianTransfers]) show(interchange,
      interchange.platforms.some(platform => visibleLines.has(platform.lineId)) && near(this.transferBounds.get(interchange)));
    if (changed) world.renderer.shadowMap.needsUpdate = true;
  }
}
