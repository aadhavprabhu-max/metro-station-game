import { test, expect } from '@playwright/test';
import { openMenu, closeMenu, hudSettled } from './hud.js';

let page;
const errors=[];
const url=process.env.METRO_SURFACE_URL || process.env.METRO_PRODUCTION_URL || 'http://127.0.0.1:5173/app.html';

/** Aim through genuine drag input, with captured-pointer gestures inside the canvas. */
async function face(point) {
  const angle=await page.evaluate(p=>{
    const player=metro.player,dx=p.x-player.camera.position.x,dz=p.z-player.camera.position.z;
    const target=Math.atan2(-dx,-dz);
    return Math.atan2(Math.sin(target-player.yaw),Math.cos(target-player.yaw));
  },point);
  const gestures=Math.max(1,Math.ceil(Math.abs(angle)/.6));
  for(let i=0;i<gestures;i++){
    await page.mouse.move(360,230);await page.mouse.down();
    await page.mouse.move(360-angle/gestures/.0028,230);await page.mouse.up();
  }
}

/** Real keyboard events drive production movement; deterministic ordinary update steps. */
async function walk(point,sprint=false) {
  await face(point);
  if(sprint)await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  const result=await page.evaluate(p=>{
    const {player,world}=metro,flights=new Set();let maxJump=0,steps=0,lightReturnError=0;
    while(Math.hypot(player.camera.position.x-p.x,player.camera.position.z-p.z)>.13 && steps<5000){
      const y=player.camera.position.y;world.update(1/60);steps++;
      maxJump=Math.max(maxJump,Math.abs(player.camera.position.y-y));
      if(world.surfaceWorld.justReturned)lightReturnError=Math.max(lightReturnError,
        Math.abs(world.lighting.keyLight.position.y-(player.camera.position.y-1.76+4.8)));
      if(player.transferSurface?.kind==='stairs')flights.add(player.transferSurface.id);
    }
    return{steps,maxJump,lightReturnError,flights:[...flights],position:player.camera.position.toArray(),distance:Math.hypot(player.camera.position.x-p.x,player.camera.position.z-p.z)};
  },point);
  await page.keyboard.up('w');if(sprint)await page.keyboard.up('Shift');
  expect(result.distance,JSON.stringify({target:point,...result})).toBeLessThan(.14);
  expect(result.maxJump).toBeLessThan(.09);
  expect(result.lightReturnError,'underground shadow lighting restores on the boundary frame').toBeLessThan(.00001);
  return result;
}

test.describe('Central U4 surface milestone',()=>{
 test.describe.configure({mode:'serial'});
 test.beforeAll(async({browser})=>{
  test.setTimeout(180000);
  page=await browser.newPage({viewport:{width:960,height:600}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${url}?line=U4&station=station-2`,{timeout:180000});
  await page.waitForFunction(()=>metro?.ready,undefined,{timeout:180000});
  await page.evaluate(()=>metro.world.renderer.setAnimationLoop(null));
 });
 test.afterEach(()=>expect(errors).toEqual([]));
 test.afterAll(async()=>{await page?.close();});

 test('the existing network and glass HUD coexist with exactly one new U4 entrance',async()=>{
  const result=await page.evaluate(()=>({nodes:metro.world.network.nodes.size,platforms:metro.world.stations.length,
    lines:metro.world.services.map(s=>s.lineId),entrances:metro.world.pedestrianTransfers.filter(t=>t.isCityEntrance).map(t=>t.userData.cityExit),
    originalEntrances:metro.world.lineWorlds.U10.entrances.length,theme:metro.player.station.theme,
    glass:!!window.metroHud,map:metroHud.model.stations.size,cityBuilt:metro.world.surfaceWorld.built}));
  expect(result).toMatchObject({nodes:53,platforms:65,lines:['U1','U2','U3','U4','U5','U6','U9','U10'],
    entrances:[{lineId:'U4',stationId:'station-2',rise:22,flights:8,streetY:10}],originalEntrances:8,
    theme:'golden-hive',glass:true,map:53,cityBuilt:false});
 });

 test('genuine keyboard and mouse input walk all eight flights from U4 into the city',async()=>{
  test.setTimeout(180000);
  const path=await page.evaluate(()=>{
    const e=metro.world.surfaceWorld.entrance;
    return [...e.walkingPath].reverse().concat([{x:e.streetPortal.x,y:10,z:e.streetPortal.z-18}]);
  });
  const flights=new Set();
  for(const point of path){const result=await walk(point);result.flights.forEach(id=>flights.add(id));}
  expect(flights.size).toBe(8);
  expect(await page.evaluate(()=>({surface:metro.player.surfaceExploring,paused:metro.world.surfaceSimulation.paused,y:metro.player.camera.position.y})))
    .toEqual({surface:true,paused:true,y:11.76});
  await expect(page.locator('.surface-status')).toBeVisible();
 });

 test('the district is a continuous walkable loop extending well beyond the U4 corridor',async()=>{
  test.setTimeout(180000);
  const routes=await page.evaluate(()=>metro.world.surfaceWorld.routes);
  let minX=Infinity,maxX=-Infinity;
  for(const point of routes){await walk(point,true);minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);
    expect(await page.evaluate(()=>metro.world.surfaceWorld.entrance.visible),'the Central landmark stays visible across the district').toBe(true);
    expect(await page.evaluate(()=>{metro.world.renderer.shadowMap.needsUpdate=false;metro.world.update(0);return metro.world.renderer.shadowMap.needsUpdate;}),
      'standing still must not force another shadow render').toBe(false);
  }
  expect(maxX-minX).toBeGreaterThan(180);
  const p=await page.evaluate(()=>metro.player.camera.position.toArray());
  // A collision boundary test uses real movement against the nearest solid house.
  await walk({x:-104,z:-267},true);await face({x:-77,z:-267});await page.keyboard.down('w');
  const blocked=await page.evaluate(()=>{for(let i=0;i<360;i++)metro.world.update(1/60);return metro.player.camera.position.toArray();});await page.keyboard.up('w');
  expect(blocked[0]).toBeLessThan(-84);
  await walk({x:-104,z:-267},true);await walk({x:p[0],z:p[2]},true);
 });

 test('the protected glass menu and map remain usable on the surface',async()=>{
  const position=await page.evaluate(()=>metro.player.camera.position.toArray());
  await openMenu(page);await page.evaluate(()=>metroHud.setDetent(2));await hudSettled(page);
  await page.locator('#gm-search').fill('Central');
  await expect(page.locator('.gm-results')).toContainText('Central');
  await page.locator('#gm-search').fill('');await page.evaluate(()=>metroHud.setDetent(0));await hudSettled(page);
  await closeMenu(page);
  expect(await page.evaluate(()=>metro.player.camera.position.toArray())).toEqual(position);
 });

 test('every service state, door progress, events, timetable and junction reservation freeze exactly',async()=>{
  test.setTimeout(180000);
  const report=await page.evaluate(()=>{
    const {world:w,player:p}=metro,results=[];
    const capture=()=>JSON.stringify({services:w.services.map(s=>({snapshot:s.snapshot(),waiting:s.waitingForSignal,
      position:s.train.position.toArray(),rotation:s.train.quaternion.toArray(),cars:s.train.cars.map(c=>({position:c.position.toArray(),rotation:c.quaternion.toArray(),progress:c.doorProgressBySide,targets:c.doorTargets}))})),
      information:w.passengerInformation.map(i=>({time:i.timeSeconds,revision:i.revision,session:i.sessionId,departed:i.departedAt,arrival:i.arrival,events:i.events,seen:[...i.seenEvents],snapshot:i.snapshot})),
      timetable:{elapsed:w.u10Timetable.elapsed,correction:w.u10Timetable.phaseCorrection,previous:w.u10Timetable.previous,departed:w.u10Timetable.departedAt},
      authority:w.phase6World.authority.snapshot()});
    for(const phase of ['boarding','closing','departing','travelling','arriving','stopped','reversal']){
      p.startAt('U4','station-2');w.update(0);
      const reached=[];
      for(const s of w.services){
        s.startAtStop(phase==='reversal'?s.route.stops.at(-2).id:s.route.stops[0].id);
        if(phase!=='boarding')s.requestDeparture();
        const target=phase==='reversal'?'stopped':phase;
        let steps=0;
        while(s.state!==target && steps++<10000)s.update(.25);
        if(phase==='closing')s.update(.2);
        if(s.state!==target)throw new Error(`${s.lineId} failed to reach ${phase}`);
        reached.push({line:s.lineId,state:s.state,direction:s.direction,pending:s.reversalPending});
      }
      for(const i of w.passengerInformation)i.update(1/60);
      w.u10Timetable.update(0);w.phase6World.authority.reserve(w.services.find(s=>s.lineId==='U5'));
      p.camera.position.set(-16.2,11.76,-234);p.transferSurface=null;p.syncSurfaceContext();
      w.surfaceSimulation.synchronize(p);
      const before=capture();for(let i=0;i<120;i++)w.update(.25);
      const frozen=before===capture();
      p.startAt('U4','station-2');p.syncSurfaceContext();w.surfaceSimulation.synchronize(p);
      const beforeResume=w.services.map(s=>({distance:s.distance,time:s.stateTime,legs:s.completedLegs}));
      w.update(1/60);
      const noJump=w.services.every((s,i)=>Math.abs(s.distance-beforeResume[i].distance)<.5);
      const advances=w.services.every((s,i)=>s.stateTime!==beforeResume[i].time || s.distance!==beforeResume[i].distance || s.completedLegs!==beforeResume[i].legs);
      results.push({phase,reached,frozen,noJump,advances,paused:w.surfaceSimulation.paused});
    }
    // Daylight in the upper access must not stop a still-running railway's
    // junction release. Suspension starts at supported public street floor.
    const u5=w.services.find(s=>s.lineId==='U5');u5.startAtStop(u5.route.stops[0].id);
    w.phase6World.authority.reserve(u5);
    const accessPoint=w.surfaceWorld.entrance.walkingPath.find(point=>point.y>4 && point.y<9);
    p.camera.position.set(accessPoint.x,accessPoint.y+1.76,accessPoint.z);p.transferSurface=null;w.update(1/60);
    return {results,upperAccess:{paused:w.surfaceSimulation.paused,rendering:w.surfaceWorld.active,reservationReleased:!w.phase6World.authority.owner}};
  });
  for(const r of report.results){expect(r.frozen,r.phase).toBe(true);expect(r.noJump,r.phase).toBe(true);expect(r.advances,r.phase).toBe(true);expect(r.paused).toBe(false);expect(r.reached.length).toBe(8);}
  expect(report.upperAccess).toEqual({paused:false,rendering:true,reservationReleased:true});
 });

 test('walking back down restores Central platform movement and the underground environment',async()=>{
  test.setTimeout(180000);
  await page.evaluate(()=>{metro.player.camera.position.set(-16.2,11.76,-234);metro.player.transferSurface=null;metro.world.update(0);});
  const path=await page.evaluate(()=>metro.world.surfaceWorld.entrance.walkingPath);
  const flights=new Set();
  for(const point of path){const r=await walk(point);r.flights.forEach(id=>flights.add(id));}
  await walk({x:-16.2,z:-200});
  expect(flights.size).toBe(8);
  expect(await page.evaluate(()=>({paused:metro.world.surfaceSimulation.paused,surface:metro.player.surfaceExploring,y:metro.player.camera.position.y,far:metro.world.camera.far})))
    .toEqual({paused:false,surface:false,y:-10.24,far:180});
  await expect(page.locator('#gh-service-pill')).toBeVisible();
 });

 test('touch movement, look, menu and map remain usable in the surface district',async({browser})=>{
  test.setTimeout(180000);
  await page.close();
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}?line=U4&station=station-2`,{timeout:180000});
  await page.waitForFunction(()=>window.metro?.ready,undefined,{timeout:180000});
  await page.evaluate(()=>{const {world:w,player:p}=metro;w.renderer.setAnimationLoop(null);p.camera.position.set(-16.2,11.76,-234);p.transferSurface=null;p.yaw=Math.PI;p.applyLook();w.update(0);w.renderer.render(w.scene,w.camera);});
  await expect(page.locator('#touch-controls')).toBeVisible();
  const button=await page.locator('[data-move="ArrowUp"]').boundingBox();
  const session=await context.newCDPSession(page);
  const before=await page.evaluate(()=>metro.player.camera.position.toArray());
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:button.x+button.width/2,y:button.y+button.height/2,id:1}]});
  await page.evaluate(()=>{for(let i=0;i<60;i++)metro.world.update(1/60);metro.world.renderer.render(metro.world.scene,metro.world.camera);});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const after=await page.evaluate(()=>({position:metro.player.camera.position.toArray(),keys:metro.player.keys.size,paused:metro.world.surfaceSimulation.paused}));
  expect(Math.hypot(after.position[0]-before[0],after.position[2]-before[2])).toBeGreaterThan(4);
  expect(after.keys).toBe(0);expect(after.paused).toBe(true);
  const yaw=await page.evaluate(()=>metro.player.yaw);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:360,id:2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:240,y:360,id:2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(()=>metro.player.yaw)).toBeLessThan(yaw);
  await page.touchscreen.tap(354,36);await expect(page.locator('#gh-panel')).toBeVisible();
  await page.evaluate(()=>metroHud.setDetent(2));await hudSettled(page);
  await expect(page.locator('#gm-view')).toBeVisible();
  expect(await page.evaluate(()=>metroHud.model.stations.size)).toBe(53);
  await page.screenshot({path:'/tmp/aurealis-surface-touch.png'});
 });
});
