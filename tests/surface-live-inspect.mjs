/** Normal-animation walk; optional camera diagnostics happen after the walk trace ends. */
import { chromium } from 'playwright';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import {createHash} from 'node:crypto';

const output=process.env.METRO_SURFACE_LIVE_OUTPUT || '/tmp/aurealis-surface-live';
const viewport={width:Number(process.env.METRO_LIVE_WIDTH || 960),height:Number(process.env.METRO_LIVE_HEIGHT || 600)};
const tour=process.env.METRO_LIVE_TOUR || 'access';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,
 args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport}),errors=[],failed=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>failed.push(r.url()));
const html=await readFile(new URL('../index.html',import.meta.url));
await page.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({status:200,contentType:'text/html',body:html}):r.abort());
await page.goto('http://aurealis-live.test/app.html?line=U4&station=station-2',{timeout:180000});
await page.waitForFunction(()=>window.metro?.ready,undefined,{timeout:180000});
await page.bringToFront();
await page.evaluate(()=>{
 const trace={flights:[],maxHeightChange:0,frames:0,surfaceFrames:0,minFeet:Infinity,maxFeet:-Infinity,last:null};window.surfaceWalkTrace=trace;
 function sample(){const p=metro.player,feet=p.camera.position.y-1.76;if(trace.last!==null)trace.maxHeightChange=Math.max(trace.maxHeightChange,Math.abs(feet-trace.last));trace.last=feet;trace.minFeet=Math.min(trace.minFeet,feet);trace.maxFeet=Math.max(trace.maxFeet,feet);trace.frames++;if(p.surfaceExploring)trace.surfaceFrames++;const id=p.transferSurface?.kind==='stairs'?p.transferSurface.id:null;if(id&&!trace.flights.includes(id))trace.flights.push(id);if(!trace.done)requestAnimationFrame(sample);}requestAnimationFrame(sample);
});
async function face(target){
 const angle=await page.evaluate(t=>{const p=metro.player,dy=Math.atan2(-(t.x-p.camera.position.x),-(t.z-p.camera.position.z))-p.yaw;return Math.atan2(Math.sin(dy),Math.cos(dy));},target);
 const n=Math.max(1,Math.ceil(Math.abs(angle)/.6));
 for(let i=0;i<n;i++){await page.mouse.move(360,230);await page.mouse.down();await page.mouse.move(360-angle/n/.0028,230);await page.mouse.up();}
}
let lastTarget=null;
const visited=[];
async function walk(target,sprint=false){
 if(visited.length && Math.hypot(target.x-visited.at(-1).x,target.z-visited.at(-1).z)<.001)return;
 lastTarget=target;
 const from=await page.evaluate(()=>({x:metro.player.camera.position.x,z:metro.player.camera.position.z}));
 if(Math.hypot(target.x-from.x,target.z-from.z)<.16)return;
 const length=Math.hypot(target.x-from.x,target.z-from.z);
 if(length>12.001){const next={x:from.x+(target.x-from.x)*12/length,z:from.z+(target.z-from.z)*12/length};await walk(next,sprint);return walk(target,sprint);}
 await face(target);if(sprint)await page.keyboard.down('Shift');await page.keyboard.down('w');
 try{await page.waitForFunction(({from,target})=>{
  const p=metro.player.camera.position,dx=target.x-from.x,dz=target.z-from.z,len=Math.hypot(dx,dz);
  return((p.x-from.x)*dx+(p.z-from.z)*dz)/len>=len-.12;
 },{from,target},{timeout:180000});}finally{await page.keyboard.up('w');if(sprint)await page.keyboard.up('Shift');}
 const distance=await page.evaluate(t=>Math.hypot(metro.player.camera.position.x-t.x,metro.player.camera.position.z-t.z),target);
 if(distance>.4)throw new Error(`Missed waypoint by ${distance} m: ${JSON.stringify(target)}`);
 visited.push(target);
 console.log(JSON.stringify({waypoint:visited.length,target,position:await page.evaluate(()=>metro.player.camera.position.toArray())}));
}
const path=await page.evaluate(()=>metro.world.surfaceWorld.entrance.walkingPath);
const transportState=()=>page.evaluate(()=>JSON.stringify({services:metro.world.services.map(s=>({state:s.snapshot(),position:s.train.position.toArray(),cars:s.train.cars.map(c=>({position:c.position.toArray(),doors:c.doorProgressBySide,targets:c.doorTargets}))})),information:metro.world.passengerInformation.map(i=>({time:i.timeSeconds,revision:i.revision,events:i.events.map(e=>e.id)})),timetable:{elapsed:metro.world.u10Timetable.elapsed,phase:metro.world.u10Timetable.phaseCorrection},junction:metro.world.phase6World.authority.snapshot()}));
const started=Date.now(),shots=[];
const monitor=setInterval(()=>page.evaluate(()=>({position:metro.player.camera.position.toArray(),keys:[...metro.player.keys],enabled:metro.player.enabled,frames:metro.frames,hidden:document.hidden,mode:metro.player.surfaceExploring})).then(state=>console.log(JSON.stringify({progressSeconds:(Date.now()-started)/1000,visited:visited.length,target:lastTarget,...state}))).catch(()=>{}),15000);
async function shot(name){const png=await page.evaluate(()=>metro.world.renderer.domElement.toDataURL('image/png'));await writeFile(`${output}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));shots.push(name);}
try{
 await shot('01-central-platform');
 const ascent=[...path].reverse();
 for(let i=0;i<ascent.length;i++){
  await walk(ascent[i]);
  if(i===2)await shot('02-lower-vaulted-access');
  if(i===Math.floor(ascent.length/2))await shot('03-medieval-stairs');
 }
 await walk({x:-16.2,z:-221});await face({x:-16.2,z:-190});await shot('04-central-entrance');
 if(!await page.evaluate(()=>metro.world.surfaceSimulation.paused))throw new Error('Trains did not suspend on surface');
 const suspended=await transportState();
 await walk({x:-16.2,z:-234});await face({x:-16.2,z:-190});await shot('04b-central-square');await walk({x:-104,z:-234},true);await shot('05-west-market');
 if(tour==='full'){
  await walk({x:-104,z:-320},true);await walk({x:-104,z:-344},true);await shot('06-canal-crossing');
  await walk({x:-104,z:-320},true);await walk({x:84,z:-320},true);await shot('07-canal-promenade');
  await walk({x:84,z:-234},true);
 }
 await walk({x:-16.2,z:-234},true);
 if(suspended!==await transportState())throw new Error('Transport state advanced during the normal-animation city walk');
 for(const point of path)await walk(point);
 await walk({x:-16.2,z:-201});await shot('08-returned-to-u4');
 const resumed=await transportState();
 await page.waitForFunction(before=>JSON.stringify(metro.world.services.map(s=>s.snapshot()))!==before,
   await page.evaluate(()=>JSON.stringify(metro.world.services.map(s=>s.snapshot()))),{timeout:10000});
 const result=await page.evaluate(()=>{surfaceWalkTrace.done=true;return{...surfaceWalkTrace,paused:metro.world.surfaceSimulation.paused,surface:metro.player.surfaceExploring,position:metro.player.camera.position.toArray(),far:metro.world.camera.far,glError:metro.world.renderer.getContext().getError()};});
 if(result.flights.length!==8 || result.paused || result.surface || result.maxHeightChange>.3 || result.glError!==0)throw new Error(`Invalid normal-animation trace: ${JSON.stringify(result)}`);
 const report={method:'Normal production animation loop, genuine mouse drags and keyboard movement throughout; query-string spawn only during the walk',capture:'Preserved WebGL drawing buffer; scene pixels exclude the DOM HUD',tour,viewport,seconds:(Date.now()-started)/1000,...result,suspendedWhileWalking:true,suspendedStateSha256:createHash('sha256').update(suspended).digest('hex'),resumedNormally:resumed!==await transportState(),shots,errors,failed};
 // Supplementary views are explicitly separate from the completed input walk.
 clearInterval(monitor);await page.evaluate(()=>metro.world.renderer.setAnimationLoop(null));await page.setViewportSize({width:960,height:600});
 report.diagnosticShots=[];
 for(const pose of [{name:'diagnostic-market',x:-104,z:-234,tx:-16.2,tz:-196,pitch:-.03},{name:'diagnostic-canal',x:-16.2,z:-321,tx:-104,tz:-333.5,pitch:-.1},{name:'diagnostic-garden',x:84,z:-182,tx:45,tz:-178,pitch:-.02}]){
  await page.evaluate(pose=>{const {world:w,player:p}=metro;p.camera.position.set(pose.x,11.76,pose.z);p.transferSurface=null;p.yaw=Math.atan2(-(pose.tx-pose.x),-(pose.tz-pose.z));p.pitch=pose.pitch;p.applyLook();w.update(0);w.renderer.render(w.scene,w.camera);},pose);
  const png=await page.evaluate(()=>metro.world.renderer.domElement.toDataURL('image/png'));await writeFile(`${output}/${pose.name}.png`,Buffer.from(png.split(',')[1],'base64'));report.diagnosticShots.push(pose.name);
 }
 report.diagnosticMethod='Camera repositioning after the completed normal-animation trace; these views are not real-time walking evidence.';
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(errors.length||failed.length)throw new Error('Browser errors during normal-animation walk');
}catch(error){await shot('failure');const state=await page.evaluate(()=>({position:metro.player.camera.position.toArray(),keys:[...metro.player.keys],enabled:metro.player.enabled,frames:metro.frames,hidden:document.hidden,trace:surfaceWalkTrace}));await writeFile(`${output}/failure.json`,JSON.stringify({message:error.message,viewport,lastTarget,visited:visited.length,state,errors,failed,seconds:(Date.now()-started)/1000},null,2));throw error;}
finally{clearInterval(monitor);await browser.close();}
