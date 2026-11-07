import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import '@babylonjs/core/Collisions/collisionCoordinator.js';
import geometry from './worldGeometry.json' with { type: 'json' };

export interface Vec3 { x: number; y: number; z: number; }
export interface WorldHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  surface: 'sand' | 'hard';
}
export interface PlayerHit { distance: number; headshot: boolean; }
export const WORLD_SOURCE_HASH = geometry.sourceHash;
export const PLAYER_RADIUS = .32;
export const PLAYER_HALF_HEIGHT = .85;
export const PLAYER_EYE_HEIGHT = .75;
/** Match these explicit hitboxes in the remote avatar presentation. Coordinates use collider centre. */
export const PLAYER_HITBOXES = Object.freeze({
  body: Object.freeze({ min: Object.freeze({ x: -.32, y: -.85, z: -.24 }), max: Object.freeze({ x: .32, y: .42, z: .24 }) }),
  head: Object.freeze({ min: Object.freeze({ x: -.23, y: .42, z: -.23 }), max: Object.freeze({ x: .23, y: .88, z: .23 }) }),
});

const finite = (value: Vec3) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const vector = (value: Vec3) => new Vector3(value.x, value.y, value.z);
const plain = (value: Vector3): Vec3 => ({ x: value.x, y: value.y, z: value.z });

/**
 * CPU-only authority using the same Babylon triangle collision algorithm and .32/.85
 * ellipsoid as the existing client. Data is generated from buildMap, including rotated
 * arch stones, open gate leaves, tapered pots, trees, crates and the central wagon.
 * Neither a DOM nor a WebGL context is created. One instance can serve a whole room.
 */
export class WorldCollision {
  private readonly engine = new NullEngine({ renderWidth: 1, renderHeight: 1, textureSize: 1, deterministicLockstep: false, lockstepMaxSteps: 1 });
  private readonly scene = new Scene(this.engine);
  private readonly mover = new Mesh('authority ellipsoid', this.scene);
  private disposed = false;

  constructor() {
    this.scene.collisionsEnabled = true;
    const material = new StandardMaterial('CPU collision triangle material', this.scene);
    for (const source of geometry.meshes) {
      const mesh = new Mesh(source.name, this.scene);
      const data = new VertexData();
      data.positions = source.positions;
      data.indices = source.indices;
      data.applyToMesh(mesh);
      mesh.material = material;
      mesh.checkCollisions = true;
      mesh.isPickable = true;
      mesh.metadata = { world: true, surface: source.surface };
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
    }
    this.mover.ellipsoid.set(PLAYER_RADIUS, PLAYER_HALF_HEIGHT, PLAYER_RADIUS);
    this.mover.isPickable = false;
    this.mover.isVisible = false;
  }

  move(position: Vec3, displacement: Vec3): Vec3 {
    if (this.disposed) throw new Error('World collision is disposed.');
    if (!finite(position) || !finite(displacement)) throw new Error('Nonfinite movement is invalid.');
    this.mover.position.set(position.x, position.y, position.z);
    this.mover.computeWorldMatrix(true);
    this.mover.moveWithCollisions(vector(displacement));
    return plain(this.mover.position);
  }

  trace(origin: Vec3, direction: Vec3, maxRange: number): WorldHit | null {
    if (this.disposed || !finite(origin) || !finite(direction) || !Number.isFinite(maxRange) || maxRange <= 0) return null;
    const heading = vector(direction);
    if (heading.lengthSquared() < 1e-12) return null;
    const hit = this.scene.pickWithRay(new Ray(vector(origin), heading.normalize(), maxRange), mesh => mesh.metadata?.world === true);
    if (!hit?.hit || !hit.pickedPoint || !hit.pickedMesh || hit.distance > maxRange) return null;
    return { distance: hit.distance, point: plain(hit.pickedPoint), normal: plain(hit.getNormal(true, false) ?? Vector3.Up()), surface: hit.pickedMesh.metadata.surface };
  }

  grounded(position: Vec3): boolean {
    return this.trace(position, { x: 0, y: -1, z: 0 }, .91) !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.dispose();
    this.engine.dispose();
  }
}

/** Fresh spawn positions leave room for five distinct human players per team. */
export function spawnFor(team: 'attackers' | 'defenders', index: number): Vec3 {
  if ((team !== 'attackers' && team !== 'defenders') || !Number.isInteger(index) || index < 0 || index > 4) throw new Error('Invalid team spawn.');
  return { x: (index - 2) * 1.8, y: .86, z: team === 'attackers' ? -12 : 20 };
}

/** Server-owned axis-aligned body/head hitboxes, independent of cosmetic avatar animation. */
export function rayPlayerHit(origin: Vec3, direction: Vec3, maxRange: number, position: Vec3): PlayerHit | null {
  if (!finite(origin) || !finite(direction) || !finite(position) || !Number.isFinite(maxRange) || maxRange <= 0) return null;
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (magnitude < 1e-6) return null;
  const heading = { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude };
  let nearest: PlayerHit | null = null;
  for (const kind of ['head', 'body'] as const) {
    const bounds = PLAYER_HITBOXES[kind];
    let enter = 0, exit = maxRange;
    for (const axis of ['x', 'y', 'z'] as const) {
      const low = position[axis] + bounds.min[axis], high = position[axis] + bounds.max[axis];
      if (Math.abs(heading[axis]) < 1e-10) {
        if (origin[axis] < low || origin[axis] > high) { exit = -1; break; }
      } else {
        const first = (low - origin[axis]) / heading[axis], last = (high - origin[axis]) / heading[axis];
        enter = Math.max(enter, Math.min(first, last)); exit = Math.min(exit, Math.max(first, last));
        if (enter > exit) break;
      }
    }
    if (enter <= exit && (!nearest || enter < nearest.distance)) nearest = { distance: enter, headshot: kind === 'head' };
  }
  return nearest;
}
