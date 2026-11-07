/** Regenerate exact server collision triangles from the existing procedural map. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mapSource = await readFile(join(root, 'src/game/map.ts'), 'utf8');
const scratch = await mkdtemp(join(tmpdir(), 'burma-world-'));
try {
  const entry = `
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildMap } from './src/game/map';
export function extract() {
  const engine = new NullEngine();
  // Map textures do not affect geometry. These methods never draw or create GPU resources.
  const context = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 0 }) }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
    set(target, key, value) { target[key] = value; return true; },
  });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => context });
  const scene = new Scene(engine);
  const map = buildMap(scene);
  try {
    return scene.meshes.filter(mesh => mesh.metadata?.solid && mesh.checkCollisions).map(mesh => {
      // Matrix evaluation includes rotated arch stones and parented open gate leaves.
      const matrix = mesh.computeWorldMatrix(true);
      const raw = mesh.getVerticesData('position');
      const positions = [], indices = [], unique = new Map();
      for (const index of mesh.getIndices()) {
        const point = Vector3.TransformCoordinates(Vector3.FromArray(raw, index * 3), matrix);
        const key = point.x + ',' + point.y + ',' + point.z;
        let vertex = unique.get(key);
        if (vertex === undefined) {
          vertex = positions.length / 3; unique.set(key, vertex);
          positions.push(point.x, point.y, point.z);
        }
        indices.push(vertex);
      }
      return { name: mesh.name, surface: mesh.name === 'courtyard ground' ? 'sand' : 'hard', positions, indices };
    });
  } finally { map.dispose(); scene.dispose(); engine.dispose(); }
}`;
  const bundle = join(scratch, 'extract.mjs');
  await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'extract-world.ts' }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { extract } = await import(pathToFileURL(bundle).href);
  const meshes = extract();
  const result = JSON.stringify({ version: 1, sourceHash: createHash('sha256').update(mapSource).digest('hex'), meshes });
  const target = resolve(root, 'src/shared/worldGeometry.json');
  if (process.argv.includes('--check')) {
    if ((await readFile(target, 'utf8')).trim() !== result) throw new Error('Map collision data is stale. Run npm run generate:world.');
    console.log('Exact map collision data is current.');
  } else {
    await writeFile(target, result + '\n');
    console.log('Generated ' + meshes.length + ' exact collision meshes (' + meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0) + ' triangles).');
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
