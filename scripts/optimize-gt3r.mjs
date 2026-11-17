// Offline asset pipeline for the Porsche 911 GT3 R (992) model. Never shipped to the browser.
//
//   node scripts/optimize-gt3r.mjs <folder with scene.gltf, scene.bin, textures/ and license.txt>
//
// Output: public/vehicles/gt3r/gt3r.glb plus the original licence and attribution files.
// The derived model is distributed under the same licence terms as the source (see ATTRIBUTION.md).
//
// Steps (visual detail preserved; texture resolutions unchanged):
//  1. Correct the authored 1/100 scale (the root FBX node scales metre data by 0.01) → model in metres.
//  2. Remove unused data, merge duplicate accessors/textures, weld vertices.
//  3. Add a simplified exterior LOD of the cockpit (COCKPIT_LOD1, ~25 % triangles). The full cockpit stays and
//     is shown in the cockpit camera; the LOD is used from outside, where the cabin is only seen through glass.
//  4. Textures: PNG → WebP. Colour maps lossy at quality 92, normal maps lossless. Same pixel dimensions.
//  5. Geometry: meshopt compression (EXT_meshopt_compression), decoded at load by three's bundled MeshoptDecoder.
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, reorder, quantize, textureCompress, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const source = resolve(process.argv[2] || '.cache/gt3r-source');
const outDir = resolve('public/vehicles/gt3r');
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(join(source, 'scene.gltf'));
const root = document.getRoot();
const count = () => { let triangles = 0, primitives = 0; for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) { primitives++; triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; } return { triangles, primitives, meshes: root.listMeshes().length, materials: root.listMaterials().length, textures: root.listTextures().length }; };
const before = count();

// 1. Scale: the FBX root node carries a 0.01 scale on data that is already in metres.
const fbx = root.listNodes().find(n => /\.fbx/i.test(n.getName()));
if (!fbx) throw new Error('FBX root node not found');
const s = fbx.getScale();
if (s.some(v => Math.abs(v - 0.01) > 1e-6)) throw new Error(`unexpected root scale ${s}`);
fbx.setScale([1, 1, 1]);

// 2. Clean up.
await document.transform(dedup(), prune(), weld({ tolerance: 0.00001 }));

// 3. Exterior cockpit LOD: deep-copy the cockpit subtree with its own simplified primitives.
const cockpit = root.listNodes().find(n => /^COCKPIT_HR/.test(n.getName()));
if (!cockpit) throw new Error('cockpit node not found');
const lodStats = { before: 0, after: 0 };
const copyNode = node => {
  const copy = document.createNode(node.getName().replace(/^COCKPIT_HR/, 'COCKPIT_LOD1') + (node === cockpit ? '' : '_lod1'))
    .setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
  const mesh = node.getMesh();
  if (mesh) {
    const lod = document.createMesh(mesh.getName() + '_lod1');
    for (const prim of mesh.listPrimitives()) {
      const p = prim.clone();
      for (const semantic of p.listSemantics()) p.setAttribute(semantic, p.getAttribute(semantic).clone());
      if (p.getIndices()) p.setIndices(p.getIndices().clone());
      const t0 = (p.getIndices()?.getCount() ?? 0) / 3; lodStats.before += t0;
      if (t0 > 300) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.0015, lockBorder: true });
      lodStats.after += (p.getIndices()?.getCount() ?? 0) / 3;
      lod.addPrimitive(p);
    }
    copy.setMesh(lod);
  }
  for (const child of node.listChildren()) copy.addChild(copyNode(child));
  return copy;
};
const parent = cockpit.getParentNode();
parent.addChild(copyNode(cockpit));

// 4. Textures → WebP at the original resolution.
const isNormal = texture => root.listMaterials().some(mat => mat.getNormalTexture() === texture);
await document.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, effort: 90, slots: /^(?!normalTexture).*$/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', lossless: true, slots: /^normalTexture$/ }),
);
for (const t of root.listTextures()) if (t.getMimeType() !== 'image/webp') console.warn('texture kept as', t.getMimeType(), t.getName(), isNormal(t) ? '(normal)' : '');

// 5. Geometry compression (meshopt): reorder for cache/compression, quantize (positions 14 bit, UVs 14 bit, normals 10 bit).
await document.transform(reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeTexcoord: 14, quantizeNormal: 10 }));
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'gt3r.glb'), await io.writeBinary(document));
await copyFile(join(source, 'license.txt'), join(outDir, 'license.txt'));
const after = count(), size = (await stat(join(outDir, 'gt3r.glb'))).size;
const report = { before, after, cockpitLod: lodStats, glbBytes: size };
await writeFile(join(outDir, 'pipeline-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
