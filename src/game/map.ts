import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';

export interface PracticeTarget {
  root: TransformNode;
  meshes: Mesh[];
  position: Vector3;
  health: number;
  respawnAt: number;
}

/** An original, entirely procedural sunset fortress and target range. */
export function buildMap(scene: Scene) {
  const assets: Array<{ dispose: () => void }> = [];
  const animated: Array<{ mesh: Mesh; phase: number }> = [];
  const healthBars: Array<{ fill: Mesh; target: PracticeTarget }> = [];
  const targets: PracticeTarget[] = [];
  let seed = 8271;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const track = <T extends { dispose: () => void }>(asset: T) => { assets.push(asset); return asset; };
  const material = (name: string, hex: string, emissive = 0) => {
    const result = track(new StandardMaterial(name, scene));
    result.diffuseColor = Color3.FromHexString(hex);
    result.specularColor = new Color3(.045, .035, .025);
    if (emissive) result.emissiveColor = result.diffuseColor.scale(emissive);
    return result;
  };
  const clay = material('sun-warmed fortress brick', '#b66e4a');
  const stone = material('carved pale sandstone', '#d1ac77');
  const darkStone = material('weathered inset stone', '#724b38');
  const wood = material('seasoned gate timber', '#63432e');
  const brass = material('aged brass', '#ae8348');
  const darkMetal = material('blackened iron', '#363b39');
  const green = material('sparse desert leaves', '#64714b');
  const redFabric = material('oxblood pennants', '#863c32');
  const teal = material('patinated turquoise', '#376c68');
  const pale = material('target ceramic', '#dfd6bd');
  const orange = material('target scoring rings', '#d87742', .15);
  const ink = material('target dark markings', '#343d3b');

  const brickTexture = track(new DynamicTexture('procedural hand-laid brick', { width: 512, height: 512 }, scene, false));
  const brickContext = brickTexture.getContext();
  brickContext.fillStyle = '#8c6249'; brickContext.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 16; row++) {
    for (let col = -1; col < 9; col++) {
      const x = col * 64 + (row % 2) * 32;
      const tone = Math.floor(150 + random() * 38);
      brickContext.fillStyle = `rgb(${tone},${Math.floor(tone * .59)},${Math.floor(tone * .39)})`;
      brickContext.fillRect(x + 1, row * 32 + 1, 62, 30);
      brickContext.fillStyle = 'rgba(255,215,168,.09)';
      brickContext.fillRect(x + 3, row * 32 + 2, 57, 2);
      brickContext.fillStyle = 'rgba(43,29,20,.09)';
      brickContext.fillRect(x + 3, row * 32 + 28, 57, 2);
    }
  }
  brickTexture.update();
  brickTexture.wrapU = brickTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  clay.diffuseTexture = brickTexture;
  clay.diffuseColor = new Color3(1, .98, .96);

  const sand = material('soft courtyard sand', '#c6aa7a');
  const sandTexture = track(new DynamicTexture('procedural sand grain', { width: 512, height: 512 }, scene, false));
  const sandContext = sandTexture.getContext();
  sandContext.fillStyle = '#c9af83'; sandContext.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 15000; i++) {
    sandContext.fillStyle = random() > .5 ? 'rgba(255,237,195,.12)' : 'rgba(100,71,45,.1)';
    sandContext.fillRect(random() * 512, random() * 512, 1 + random() * 2, 1);
  }
  sandTexture.update(); sandTexture.uScale = sandTexture.vScale = 20;
  sandTexture.wrapU = sandTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  sand.diffuseTexture = sandTexture;
  sand.diffuseColor = new Color3(.9, .9, .9);

  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, mat = clay, solid = true) => {
    const mesh = track(MeshBuilder.CreateBox(name, {
      width: w, height: h, depth: d,
      faceUV: mat === clay ? [new Vector4(0, 0, w / 8, h / 8), new Vector4(0, 0, w / 8, h / 8),
        new Vector4(0, 0, d / 8, h / 8), new Vector4(0, 0, d / 8, h / 8),
        new Vector4(0, 0, w / 8, d / 8), new Vector4(0, 0, w / 8, d / 8)] : undefined,
    }, scene));
    mesh.position.set(x, y, z); mesh.material = mat;
    mesh.checkCollisions = solid; mesh.isPickable = solid;
    mesh.metadata = solid ? { solid: true } : { decorative: true };
    return mesh;
  };
  const cylinder = (name: string, x: number, y: number, z: number, height: number, bottom: number, top: number, mat = clay, tessellation = 16) => {
    const mesh = track(MeshBuilder.CreateCylinder(name, { height, diameterBottom: bottom, diameterTop: top, tessellation }, scene));
    mesh.position.set(x, y, z); mesh.material = mat; mesh.isPickable = false;
    return mesh;
  };
  const ground = track(MeshBuilder.CreateGround('courtyard ground', { width: 220, height: 220 }, scene));
  ground.material = sand; ground.checkCollisions = true; ground.metadata = { solid: true };

  scene.clearColor = new Color4(.72, .64, .56, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = .005; scene.fogColor = new Color3(.72, .64, .56);
  scene.ambientColor = new Color3(.15, .16, .18);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.12;
  scene.imageProcessingConfiguration.contrast = 1.03;
  scene.skipPointerMovePicking = true;
  const skyLight = track(new HemisphericLight('open desert sky', new Vector3(-.15, 1, -.8), scene));
  skyLight.intensity = 1.05; skyLight.diffuse = new Color3(.84, .9, 1);
  skyLight.groundColor = new Color3(.42, .39, .35);
  const sunLight = track(new DirectionalLight('late afternoon sun', new Vector3(-45, -30, -27).normalize(), scene));
  sunLight.position.set(45, 32, 32);
  sunLight.diffuse = new Color3(1, .86, .69); sunLight.intensity = 1.15;
  sunLight.shadowFrustumSize = 88;
  sunLight.autoUpdateExtends = false;
  sunLight.shadowMinZ = 1; sunLight.shadowMaxZ = 145;
  const sunMat = material('hazy sunset disc', '#ffdb95', 1);
  sunMat.disableLighting = true;
  const sun = track(MeshBuilder.CreateSphere('setting sun', { diameter: 14, segments: 24 }, scene));
  sun.position.set(90, 62, 59); sun.material = sunMat; sun.isPickable = false;

  // Contact shadows are procedural decals, avoiding a costly real-time shadow map.
  const shadowMat = material('soft contact shadow', '#4c372a');
  const shadowTexture = track(new DynamicTexture('soft circular shade', 128, scene, false));
  const shadowContext = shadowTexture.getContext();
  const gradient = shadowContext.createRadialGradient(64, 64, 10, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(31,23,15,.45)'); gradient.addColorStop(1, 'rgba(31,23,15,0)');
  shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 128, 128); shadowTexture.update();
  shadowTexture.hasAlpha = true; shadowMat.diffuseTexture = shadowTexture;
  shadowMat.emissiveTexture = shadowTexture;
  shadowMat.useAlphaFromDiffuseTexture = true; shadowMat.disableLighting = true;
  shadowMat.emissiveColor = Color3.White(); shadowMat.backFaceCulling = false;
  const shade = (x: number, z: number, w: number, d: number) => {
    const mesh = track(MeshBuilder.CreateGround('contact shade', { width: w, height: d }, scene));
    mesh.position.set(x, .016, z); mesh.material = shadowMat; mesh.isPickable = false;
  };

  const wall = (name: string, x: number, z: number, width: number, height = 5, depth = 1.2) => {
    box(name, x, height / 2, z, width, height, depth);
    box(`${name} sandstone footing`, x, .22, z, width + .22, .44, depth + .26, darkStone);
    box(`${name} cornice`, x, height - .05, z, width + .22, .3, depth + .3, stone);
    const count = Math.floor(width / 2);
    for (let i = 0; i < count; i++) box(`${name} merlon`, x - width / 2 + 1 + i * 2, height + .46, z, .85, .76, depth + .05);
  };
  wall('west rampart', -27, 5, 1.6, 5, 50);
  wall('east rampart', 27, 5, 1.6, 5, 50);
  wall('south rampart', 0, -20, 54, 5, 1.4);
  wall('north west rampart', -17, 30, 20, 6, 1.5);
  wall('north east rampart', 17, 30, 20, 6, 1.5);
  // The sanctuary passage ends at a closed timber gate inside the perimeter.
  box('closed northern fortress gate', 0, 3, 30, 14, 6, .65, wood);
  for (let i = -6; i <= 6; i++) {
    box('northern gate timber seam', i, 3, 29.65, .04, 5.8, .05, darkMetal, false);
  }
  for (const y of [1, 3, 5]) {
    box('northern gate iron crossbar', 0, y, 29.6, 13.7, .18, .12, darkMetal, false);
  }
  box('northern gate crown', 0, 6.05, 30, 14.5, .4, 1.0, stone);

  const roof = (name: string, x: number, z: number, baseY: number, radius: number, levels = 4) => {
    for (let level = 0; level < levels; level++) {
      const r = radius * Math.pow(.72, level);
      cylinder(`${name} tier ${level}`, x, baseY + level * .85, z, 1.25, r * 2, r * 1.27, clay, 8);
      cylinder(`${name} gold roof edge ${level}`, x, baseY + level * .85 - .54, z, .13, r * 2.05, r * 2.05, stone, 8);
    }
    const top = baseY + (levels - 1) * .85 + .5;
    cylinder(`${name} finial`, x, top + 1.05, z, 2.2, .35, 0, brass, 12);
  };
  const tower = (name: string, x: number, z: number, height: number, width = 4.2) => {
    box(`${name} base`, x, .32, z, width + .8, .64, width + .8, darkStone);
    box(`${name} shaft`, x, height / 2, z, width, height, width);
    box(`${name} shoulder`, x, height - .2, z, width + .65, .5, width + .65, stone);
    for (const side of [-1, 1]) {
      box(`${name} inset`, x + side * width / 2, height * .64, z, .035, 1.5, .55, darkStone, false);
      box(`${name} inset front`, x + side * .9, height * .64, z - width / 2 - .01, .55, 1.5, .035, darkStone, false);
    }
    roof(name, x, z, height + .6, width * .75);
    shade(x, z, width * 1.8, width * 1.8);
  };
  tower('western sentinel', -25, 27, 9, 5);
  tower('eastern sentinel', 25, 27, 10.5, 5);
  tower('southwest watch', -25, -18, 7, 4);
  tower('southeast watch', 25, -18, 7, 4);

  // Voussoirs form an actual open arch, with collision on each wedge.
  const arch = (name: string, x: number, z: number, radius: number, springY: number, depth: number) => {
    const thickness = .65;
    for (const side of [-1, 1]) {
      box(`${name} pier`, x + side * (radius + thickness / 2), springY / 2, z, thickness, springY, depth, stone);
      box(`${name} pier plinth`, x + side * (radius + thickness / 2), .24, z, thickness + .5, .48, depth + .4, darkStone);
      box(`${name} impost`, x + side * (radius + thickness / 2), springY, z, thickness + .32, .25, depth + .3, stone);
    }
    const count = 17;
    for (let i = 0; i < count; i++) {
      const angle = (i + .5) * Math.PI / count;
      const mesh = box(`${name} carved arch stone ${i}`, x + Math.cos(angle) * (radius + thickness / 2),
        springY + Math.sin(angle) * (radius + thickness / 2), z,
        thickness, (radius + thickness) * Math.PI / count * 1.04, depth, i === 8 ? darkStone : stone);
      mesh.rotation.z = angle;
    }
  };
  // Large sanctuary facade at the end of the central approach.
  wall('sanctuary left wing', -10.9, 23.8, 13, 7, 2.2);
  wall('sanctuary right wing', 10.9, 23.8, 13, 7, 2.2);
  arch('great sun arch', 0, 23.8, 3.7, 4.5, 2.2);
  box('great arch pediment', 0, 9.2, 23.8, 9, 1.4, 2.4);
  box('great arch crown molding', 0, 10, 23.8, 9.8, .3, 2.8, stone);
  roof('sanctuary crown', 0, 23.8, 10.8, 3.8, 5);
  tower('sanctuary left turret', -6.2, 23.8, 9, 2.5);
  tower('sanctuary right turret', 6.2, 23.8, 9, 2.5);
  // Side courtyards have open gates, while layered walls frame the range.
  wall('western court outer wall', -20, 8, 10, 4.5, 1.2);
  arch('western court arch', -20, -2, 2.5, 2.9, 1.1);
  wall('western courtyard left', -25.2, -2, 4.7, 5.6, 1.1);
  wall('western courtyard right', -14.8, -2, 4.7, 5.6, 1.1);
  box('western arch lintel', -20, 6.1, -2, 6.5, 1.0, 1.1);
  roof('western gate canopy', -20, -2, 6.9, 3.9, 2);
  arch('eastern court arch', 20, 3, 2.4, 3, 1.1);
  wall('eastern court left', 15.2, 3, 4.2, 5.6, 1.1);
  wall('eastern court right', 24.8, 3, 4.2, 5.6, 1.1);
  box('eastern arch lintel', 20, 6.1, 3, 6.3, 1.0, 1.1);
  roof('eastern gate canopy', 20, 3, 6.9, 3.9, 2);

  const gateLeaf = (name: string, x: number, z: number, angle: number) => {
    const pivot = track(new TransformNode(name, scene)); pivot.position.set(x, 0, z); pivot.rotation.y = angle;
    for (let i = 0; i < 5; i++) {
      const plank = box(`${name} timber ${i}`, .24 + i * .48, 1.8, 0, .455, 3.6, .19, wood);
      plank.parent = pivot;
    }
    for (const y of [.65, 2.75]) {
      const brace = box(`${name} iron brace`, 1.2, y, -.13, 2.4, .15, .08, darkMetal, false); brace.parent = pivot;
      for (const x of [.25, .8, 1.4, 2]) {
        const stud = cylinder(`${name} rivet`, x, y, -.2, .075, .085, .085, brass, 8);
        stud.rotation.x = Math.PI / 2; stud.parent = pivot;
      }
    }
  };
  gateLeaf('western open timber gate', -22.4, -1.5, -1.2);
  gateLeaf('eastern open timber gate', 22.4, 3.5, -1.95);

  const crate = (x: number, z: number, size = 1.7, y = 0) => {
    box('supply crate body', x, y + size / 2, z, size, size, size, wood);
    for (const side of [-1, 1]) {
      for (const offset of [-.36, .36]) {
        box('crate vertical framing', x + size * offset, y + size / 2, z + side * (size / 2 + .025), .12, size, .08, stone, false);
        box('crate side framing', x + side * (size / 2 + .025), y + size / 2, z + size * offset, .08, size, .12, stone, false);
      }
      for (const height of [.12, .88]) {
        box('crate horizontal framing', x, y + size * height, z + side * (size / 2 + .07), size, .12, .1, brass, false);
      }
    }
    shade(x, z, size * 1.7, size * 1.7);
  };
  crate(-12, -7, 2); crate(-14.2, -6.7, 1.6); crate(-12, -7, 1.5, 2);
  crate(10, -2, 1.8); crate(12, -1.7, 1.4); crate(21, 13, 2); crate(23.2, 13, 1.5);
  crate(-18, 17, 1.6); crate(-20, 17, 1.6);

  const banner = (x: number, z: number, y: number, alternate = false) => {
    box('banner pole', x, y + .95, z, .07, 3.4, .07, brass, false);
    const cloth = box('courtyard hanging pennant', x + .58, y + 1.35, z, 1.1, 1.7, .035, alternate ? teal : redFabric, false);
    const stripe = box('pennant golden stripe', x + .58, y + 1.35, z - .025, .13, 1.7, .01, brass, false);
    animated.push({ mesh: cloth, phase: random() * 6 }, { mesh: stripe, phase: random() * 6 });
  };
  banner(-12.5, 22.3, 5); banner(12.5, 22.3, 5, true);
  banner(-24, -3, 3.5); banner(24, 2, 3.5, true);

  const sign = (label: string, subtitle: string, x: number, z: number, color: string) => {
    const texture = track(new DynamicTexture(`${label} practice site sign`, { width: 512, height: 512 }, scene, false));
    const context = texture.getContext();
    context.fillStyle = '#2e3d38'; context.fillRect(0, 0, 512, 512);
    context.strokeStyle = '#d3b378'; context.lineWidth = 12; context.strokeRect(22, 22, 468, 468);
    context.fillStyle = color; context.font = 'bold 285px sans-serif';
    (context as CanvasRenderingContext2D).textAlign = 'center';
    context.fillText(label, 256, 320);
    context.fillStyle = '#eee0ba'; context.font = 'bold 32px sans-serif'; context.fillText(subtitle, 256, 413);
    texture.update();
    const mat = material(`${label} sign material`, '#ffffff', .16); mat.diffuseTexture = texture;
    const mesh = box(`${label} site marker`, x, 3.25, z, 1.7, 1.7, .12, mat, false);
    return mesh;
  };
  sign('A', 'WEST COURT', -13.3, -.59, '#e6bd79');
  sign('B', 'EAST COURT', 14.7, 2.39, '#8dc8bc');

  // A few robust planters, tufts, and rubble give the fortress scale.
  for (const [x, z] of [[-24, -8], [-16, 5], [24, 8], [15, 18], [-14, 21]]) {
    const amphora = cylinder('terracotta amphora', x, .65, z, 1.25, .75, .55, clay);
    amphora.checkCollisions = true; amphora.isPickable = true; amphora.metadata = { solid: true };
    cylinder('amphora rim', x, 1.3, z, .13, .66, .66, stone);
    cylinder('amphora opening', x, 1.34, z, .02, .46, .46, darkStone);
    shade(x, z, 2, 2);
    for (let i = 0; i < 5; i++) {
      const leaf = box('dry planter foliage', x, 1.75, z, .09, 1.15, .32, green, false);
      leaf.rotation.z = (i - 2) * .3; leaf.rotation.y = i * 1.7;
    }
  }
  for (let i = 0; i < 48; i++) {
    const x = (random() > .5 ? 1 : -1) * (22 + random() * 3);
    const z = -16 + random() * 43;
    const chip = box('tumbled masonry chip', x, .06 + random() * .06, z, .12 + random() * .3, .12, .16 + random() * .3, i % 3 === 0 ? stone : clay, false);
    chip.rotation.y = random() * Math.PI;
  }
  // Monument silhouettes are outside the playable perimeter, all original geometry.
  for (let i = 0; i < 20; i++) {
    const x = -94 + i * 10 + random() * 6;
    const z = 58 + random() * 36;
    const height = 4 + random() * 8;
    const radius = 2.2 + random() * 2.5;
    cylinder('distant sanctuary terrace', x, .5, z, 1, radius * 3.1, radius * 2.9, clay, 8);
    cylinder('distant sanctuary drum', x, 1.7, z, 2, radius * 2.7, radius * 2.2, clay, 12);
    cylinder('distant bell silhouette', x, 3 + height / 3, z, height * .65, radius * 2.3, radius * .9, clay, 24);
    roof('distant sanctuary', x, z, height * .65 + 3, radius * .9, 4);
  }
  // Gentle paving guides the central approach without copying any existing map.
  for (let i = 0; i < 15; i++) {
    const paver = box('worn ceremonial path slab', (i % 2 ? -.55 : .55), .012, -16 + i * 2.5, 2, .025, 1.4, stone, false);
    paver.rotation.y = (random() - .5) * .09;
  }

  const positions = [new Vector3(-8, 0, 5), new Vector3(1, 0, 12), new Vector3(11, 0, 8)];
  positions.forEach((position, index) => {
    const root = track(new TransformNode(`practice dummy ${index + 1}`, scene));
    root.position.copyFrom(position);
    const meshes: Mesh[] = [];
    const targetBox = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, mat: StandardMaterial, hit = false, headshot = false) => {
      const mesh = box(name, x, y, z, w, h, d, mat, false); mesh.parent = root;
      mesh.isPickable = hit; mesh.metadata = hit ? { targetIndex: index, headshot } : { decorative: true };
      mesh.checkCollisions = hit;
      meshes.push(mesh); return mesh;
    };
    targetBox('dummy weighted foot', 0, .08, 0, 1.3, .16, .8, darkMetal);
    targetBox('dummy upright', 0, .65, .12, .14, 1.1, .14, brass);
    const body = targetBox('ceramic target torso', 0, 1.38, 0, .85, 1, .32, pale, true);
    body.rotation.z = .02 * (index - 1);
    targetBox('ceramic target shoulders', 0, 1.76, 0, 1.15, .25, .3, pale, true);
    targetBox('ceramic target head', 0, 2.13, 0, .46, .48, .34, orange, true, true);
    targetBox('dummy faceplate', 0, 2.15, -.179, .28, .12, .016, ink);
    const scoring = track(MeshBuilder.CreateTorus('target chest scoring ring', { diameter: .43, thickness: .055, tessellation: 20 }, scene));
    scoring.rotation.x = Math.PI / 2; scoring.position.set(0, 1.42, -.177); scoring.material = orange;
    scoring.parent = root; scoring.isPickable = false; meshes.push(scoring);
    targetBox('target chest center', 0, 1.42, -.183, .13, .13, .025, ink);
    targetBox('dummy health bar backing', 0, 2.78, -.08, 1.12, .14, .045, darkMetal);
    const fill = targetBox('dummy health bar', 0, 2.78, -.108, 1, .055, .018, teal);
    shade(position.x, position.z, 2.2, 2);
    const target = { root, meshes, position, health: 100, respawnAt: 0 };
    targets.push(target); healthBars.push({ fill, target });
  });

  // Batch static masonry by material and collision role. Targets, waving banners,
  // ground and transparent contact shades keep their independent lifetimes.
  const batches = new Map<string, { material: StandardMaterial; solid: boolean; meshes: Mesh[] }>();
  const animatedMeshes = new Set(animated.map(item => item.mesh));
  for (const asset of assets) {
    if (!(asset instanceof Mesh) || asset.parent || asset === ground || asset === sun || asset.material === shadowMat || animatedMeshes.has(asset)) continue;
    if (!(asset.material instanceof StandardMaterial)) continue;
    const solid = asset.metadata?.solid === true;
    const key = `${asset.material.uniqueId}:${solid}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { material: asset.material, solid, meshes: [] };
      batches.set(key, batch);
    }
    batch.meshes.push(asset);
  }
  for (const batch of batches.values()) {
    if (batch.meshes.length < 2) continue;
    const merged = Mesh.MergeMeshes(batch.meshes, true, true, undefined, false, false);
    if (!merged) continue;
    track(merged);
    merged.name = `${batch.material.name} ${batch.solid ? 'fortress collision batch' : 'static detail batch'}`;
    merged.material = batch.material;
    merged.checkCollisions = batch.solid;
    merged.isPickable = batch.solid;
    merged.metadata = batch.solid ? { solid: true } : { decorative: true };
  }
  // Static matrices avoid recalculating decorative transforms per frame.
  for (const asset of assets) {
    if (asset instanceof Mesh && !asset.isDisposed() && !asset.parent && !animatedMeshes.has(asset)) asset.freezeWorldMatrix();
  }
  // The static fortress needs one filtered shadow render, rather than a shadow pass every frame.
  // Babylon resets the refresh counter while any shadow shader is still compiling.
  const coarsePointer = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const shadows = track(new ShadowGenerator(coarsePointer ? 512 : 1024, sunLight));
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  shadows.bias = .0008;
  shadows.normalBias = .045;
  shadows.setDarkness(.15);
  for (const asset of assets) {
    if (!(asset instanceof Mesh) || asset.isDisposed()) continue;
    if (asset !== sun && asset.material !== shadowMat) asset.receiveShadows = true;
    if (asset !== ground && asset.metadata?.solid && !asset.parent) shadows.addShadowCaster(asset, false);
    if (asset.parent?.name.includes('open timber gate') && asset.metadata?.solid) shadows.addShadowCaster(asset, false);
  }
  const shadowMap = shadows.getShadowMap();
  if (shadowMap) shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  return {
    spawn: new Vector3(0, 1.7, -12), targets,
    animate: (time: number) => {
      for (const { mesh, phase } of animated) mesh.rotation.y = Math.sin(time * 1.5 + phase) * .07;
      for (const { fill, target } of healthBars) {
        const fraction = Math.max(0, Math.min(1, target.health / 100));
        fill.scaling.x = Math.max(.001, fraction);
        fill.position.x = -.5 + fraction * .5;
      }
    },
    dispose: () => { for (const asset of assets.reverse()) asset.dispose(); },
  };
}
