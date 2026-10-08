import * as THREE from 'three';

/** Cull remote geometry and the adjacent hall behind its opaque dividing wall.
 * Both services continue simulating. Central's pedestrian passage reveals both
 * halls while crossing; nothing is moved or rebuilt when visibility changes.
 */
export class WorldVisibility {
  constructor(world) {
    this.world = world;
    this.range = 145;
    this.sections = [];
    world.scene.updateMatrixWorld(true);
    for (const [lineId, root] of [['U1', world.routeWorld], ['U2', world.u2World]]) {
      for (const group of root.children) {
        if (group.stationId || group === world.u2World.interchange) continue;
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
    const passage = world.u2World.interchange.worldBounds;
    const inPassage = !player.ridingCar && camera.x >= passage.minX - 0.8 && camera.x <= passage.maxX + 0.8
      && camera.z >= passage.minZ - 1 && camera.z <= passage.maxZ + 1;
    const showsLine = id => id === lineId || inPassage;
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
    show(world.u2World.interchange, Math.abs(camera.z + 264) < this.range);
    if (changed) world.renderer.shadowMap.needsUpdate = true;
  }
}
