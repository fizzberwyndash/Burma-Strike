import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'burma-world-test-'));
const bundle = join(scratch, 'world.mjs');
await build({ stdin: { contents: "export * from './src/shared/world'; export { MAP_ROUTES } from './src/game/map';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
const { WorldCollision, rayPlayerHit, spawnFor, WORLD_SOURCE_HASH, MAP_ROUTES } = await import(pathToFileURL(bundle).href);
const world = new WorldCollision();
after(async () => { world.dispose(); await rm(scratch, { recursive: true, force: true }); });

const near = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('generated collision data is tied to the existing procedural map source', async () => {
  const map = await readFile(join(root, 'src/game/map.ts'), 'utf8');
  assert.equal(WORLD_SOURCE_HASH, createHash('sha256').update(map).digest('hex'), 'Run npm run world:generate after editing map.ts.');
  const generated = JSON.parse(await readFile(join(root, 'src/shared/worldGeometry.json'), 'utf8'));
  assert.equal(generated.meshes.length, 18);
  assert.equal(generated.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0), 4518);
  assert.ok(generated.meshes.every(mesh => !mesh.name.includes('dummy') && !mesh.name.includes('skyline')));
  assert.equal(generated.meshes.filter(mesh => mesh.name.includes('open timber gate')).length, 10);
});

test('all ten distinct team spawn points start on unobstructed collision ground', () => {
  const positions = [];
  for (const team of ['attackers', 'defenders']) for (let i = 0; i < 5; i++) {
    const position = spawnFor(team, i); positions.push(position);
    assert.equal(world.grounded(position), true);
    const next = world.move(position, { x: .1, y: -.04, z: .1 });
    near(next.x, position.x + .1); near(next.z, position.z + .1);
    assert.ok(next.y >= .84 && next.y < .9);
  }
  assert.equal(new Set(positions.map(p => `${p.x},${p.z}`)).size, 10);
  assert.throws(() => spawnFor('attackers', 5));
  assert.throws(() => spawnFor('unknown', 0));
});

test('all six tactical navigation routes remain traversable with the authority ellipsoid', () => {
  for (const route of MAP_ROUTES) {
    let position = { ...route.points[0], y: .86 };
    for (const destination of route.points.slice(1)) {
      let attempts = 0;
      while (Math.hypot(destination.x - position.x, destination.z - position.z) > .11 && attempts++ < 800) {
        const dx = destination.x - position.x, dz = destination.z - position.z;
        const scale = Math.min(.08, Math.hypot(dx, dz)) / Math.hypot(dx, dz);
        position = world.move(position, { x: dx * scale, y: -.015, z: dz * scale });
      }
      assert.ok(Math.hypot(destination.x - position.x, destination.z - position.z) <= .12, `${route.name}: blocked at ${JSON.stringify(position)}`);
    }
  }
});

test('perimeter walls stop swept movement rather than letting a large displacement tunnel', () => {
  const east = world.move({ x: 20, y: .86, z: 0 }, { x: 20, y: -.02, z: 0 });
  const west = world.move({ x: -20, y: .86, z: -10 }, { x: -20, y: -.02, z: 0 });
  const north = world.move({ x: 0, y: .86, z: 26 }, { x: 0, y: -.02, z: 20 });
  const south = world.move({ x: 0, y: .86, z: -15 }, { x: 0, y: -.02, z: -20 });
  assert.ok(east.x < 26 && east.x > 25);
  assert.ok(west.x > -26 && west.x < -25);
  assert.ok(north.z < 30 && north.z > 29);
  assert.ok(south.z > -20 && south.z < -18);
});

test('collision and hitscan stop at real cover while the open arch passage stays open', () => {
  const wagon = world.trace({ x: 0, y: 1.6, z: 10 }, { x: 0, y: 0, z: 1 }, 40);
  assert.ok(wagon); near(wagon.point.z, 15.2, .0001); near(wagon.distance, 5.2, .0001);
  assert.equal(wagon.surface, 'hard'); assert.deepEqual(wagon.normal, { x: 0, y: 0, z: -1 });
  assert.equal(world.trace({ x: 0, y: 1.6, z: 10 }, { x: 0, y: 0, z: 1 }, 5), null);
  const blocked = world.move({ x: 0, y: .86, z: 13 }, { x: 0, y: -.02, z: 8 });
  assert.ok(blocked.z < 15 && blocked.z > 14.5);
  assert.equal(world.trace({ x: -20, y: 1.6, z: -6 }, { x: 0, y: 0, z: 1 }, 12), null);
  const arch = world.trace({ x: -20, y: 5.6, z: -6 }, { x: 0, y: 0, z: 1 }, 12);
  assert.ok(arch && arch.distance < 5, 'The upper curved arch must remain solid.');
});

test('grounding, jump/fall and sand hits use the same continuous terrain plane', () => {
  const point = spawnFor('attackers', 2);
  assert.equal(world.grounded(point), true);
  const airborne = world.move(point, { x: 0, y: .7, z: 0 });
  assert.equal(world.grounded(airborne), false);
  const landed = world.move(airborne, { x: 0, y: -3, z: 0 });
  assert.equal(world.grounded(landed), true); near(landed.y, .8585, .005);
  const sand = world.trace({ x: 0, y: 2, z: -12 }, { x: 0, y: -1, z: 0 }, 3);
  assert.ok(sand); assert.equal(sand.surface, 'sand'); near(sand.point.y, 0, .00001);
});

test('authoritative body/head hitboxes honor nearest intersection, range and invalid rays', () => {
  const target = { x: 0, y: .86, z: 10 };
  const head = rayPlayerHit({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 2 }, 20, target);
  assert.ok(head?.headshot); near(head.distance, 9.77, .00001);
  const body = rayPlayerHit({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 20, target);
  assert.equal(body?.headshot, false); near(body.distance, 9.76, .00001);
  assert.equal(rayPlayerHit({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 9, target), null);
  assert.equal(rayPlayerHit({ x: 1, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 }, 20, target), null);
  assert.equal(rayPlayerHit({ x: 0, y: 1, z: 0 }, { x: NaN, y: 0, z: 1 }, 20, target), null);
  assert.equal(world.trace(target, { x: 0, y: 0, z: 0 }, 20), null);
  assert.throws(() => world.move(target, { x: Infinity, y: 0, z: 0 }));
});

test('disposal is idempotent and rejects later movement', () => {
  const temporary = new WorldCollision(); temporary.dispose(); temporary.dispose();
  assert.equal(temporary.trace({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, 5), null);
  assert.throws(() => temporary.move({ x: 0, y: .86, z: 0 }, { x: 1, y: 0, z: 0 }));
});
