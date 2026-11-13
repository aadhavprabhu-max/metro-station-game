import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output=process.env.METRO_SURFACE_EVIDENCE || '/tmp/aurealis-surface-evidence';
await mkdir(output,{recursive:true});
const versions=[
 ['baseline',process.env.METRO_BASELINE_HTML || '/tmp/aurealis-phase1-baseline/index.html'],
 ...(process.env.METRO_PREINSTANCE_HTML ? [['before-instancing',process.env.METRO_PREINSTANCE_HTML]] : []),
 ['updated',new URL('../index.html',import.meta.url)],
];
const report={viewport:[960,600],dpr:1,method:'Frozen production bundle; 25 warmup renders, then 21 synchronous renderer.render + gl.finish samples per pose; median is not gameplay FPS.',versions:[]};
for(const [name,file] of versions){
 const html=await readFile(file);
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,
   args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort());
 await page.goto('http://aurealis-performance.test/app.html?line=U4&station=station-2',{timeout:180000});
 await page.waitForFunction(()=>window.metro?.ready,undefined,{timeout:180000});
 await page.evaluate(()=>{const w=metro.world;w.renderer.setAnimationLoop(null);for(const s of w.services)s.reset();});
 const version={name,sha256:createHash('sha256').update(html).digest('hex'),poses:[]};
 version.renderer=await page.evaluate(()=>{const w=metro.world,gl=w.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return{quality:w.quality,gpu:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'',nodes:w.network.nodes.size,platforms:w.stations.length,services:w.services.length};});
 for(const [pose,line,station] of [['nordplatz','U1','station-1'],['central-u4','U4','station-2'],['arabellapark','U4','u4-arabellapark'],['city','surface',null]]){
  if(process.env.METRO_PERF_POSE && pose!==process.env.METRO_PERF_POSE)continue;
  if(line==='surface' && !await page.evaluate(()=>!!metro.world.surfaceWorld))continue;
  const result=await page.evaluate(({line,station})=>{
   const {world:w,player:p}=metro;
   if(line==='surface'){p.startAt('U4','station-2');p.camera.position.set(-16.2,11.76,-221);p.transferSurface=null;p.yaw=Math.PI;p.pitch=-.02;p.applyLook();}
   else p.startAt(line,station);
   w.update(0);
   for(let i=0;i<25;i++){w.renderer.render(w.scene,w.camera);w.renderer.getContext().finish();}
   const samples=[];
   for(let i=0;i<21;i++){const t=performance.now();w.renderer.render(w.scene,w.camera);w.renderer.getContext().finish();samples.push(performance.now()-t);}
   const sorted=[...samples].sort((a,b)=>a-b);
   return{position:p.camera.position.toArray(),yaw:p.yaw,pitch:p.pitch,samples,medianMs:sorted[10],calls:w.renderer.info.render.calls,
    triangles:w.renderer.info.render.triangles,far:w.camera.far,paused:w.surfaceSimulation?.paused??false,
    geometries:w.renderer.info.memory.geometries,textures:w.renderer.info.memory.textures};
  },{line,station});
  version.poses.push({pose,...result});
  const png=await page.evaluate(()=>metro.world.renderer.domElement.toDataURL('image/png'));
  await writeFile(`${output}/${name}-${pose}.png`,Buffer.from(png.split(',')[1],'base64'));
  console.log(JSON.stringify({version:name,pose,...result}));
 }
 version.cpu=await page.evaluate(()=>{
  const {world:w,player:p}=metro;p.startAt('U4','station-2');w.update(0);
  for(const s of w.services){s.reset();s.requestDeparture();}
  for(let i=0;i<400;i++)w.update(1/60);
  const normal=[];for(let i=0;i<400;i++){const t=performance.now();w.update(1/60);normal.push(performance.now()-t);}
  let surface=null;
  if(w.surfaceWorld){p.camera.position.set(-16.2,11.76,-234);p.transferSurface=null;w.update(0);const samples=[];for(let i=0;i<400;i++){const t=performance.now();w.update(1/60);samples.push(performance.now()-t);}surface=samples;}
  const summarize=a=>a?{totalMs:a.reduce((s,x)=>s+x,0),medianMs:[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],samples:a.length}:null;
  return{method:'400 ordinary 1/60s world.update calls after 400 moving-service warmup calls; rendering excluded',underground:summarize(normal),surface:summarize(surface)};
 });
 version.glError=await page.evaluate(()=>metro.world.renderer.getContext().getError());
 version.errors=errors;report.versions.push(version);await browser.close();
 console.log(JSON.stringify(version));
}
await writeFile(`${output}/performance.json`,JSON.stringify(report,null,2));
if(report.versions.some(v=>v.errors.length || v.glError!==0))throw new Error('Runtime errors during benchmark');
