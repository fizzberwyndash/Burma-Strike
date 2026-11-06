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

export interface MapRoute {
  name: string;
  team: 'attackers' | 'defenders';
  points: Array<{ x: number; z: number }>;
}

/** Traversable route centre lines, also useful to collision-test the original layout. */
export const MAP_ROUTES: MapRoute[] = [
  { name: 'Market Walk → A', team: 'attackers', points: [
    { x: 0, z: -12 }, { x: -8, z: -12 }, { x: -18, z: -12 }, { x: -20, z: -6 },
    { x: -20, z: 1 }, { x: -19, z: 4.5 },
  ] },
  { name: 'Central Courtyard', team: 'attackers', points: [
    { x: 0, z: -12 }, { x: 0, z: 2 }, { x: 4, z: 8 }, { x: 5, z: 13 },
    { x: 5, z: 18 }, { x: 0, z: 18 },
  ] },
  { name: 'Timber Passage → B', team: 'attackers', points: [
    { x: 0, z: -12 }, { x: 7, z: -12 }, { x: 19, z: -12 }, { x: 20, z: -6 },
    { x: 20, z: 3 }, { x: 18, z: 8 }, { x: 18, z: 12 },
  ] },
  { name: 'Defender Market access', team: 'defenders', points: [
    { x: 0, z: 18 }, { x: -7, z: 20 }, { x: -14, z: 20 }, { x: -22, z: 20 },
    { x: -23, z: 13 }, { x: -20, z: 11 }, { x: -20, z: 8 }, { x: -19, z: 4.5 },
  ] },
  { name: 'Defender Courtyard access', team: 'defenders', points: [
    { x: 0, z: 18 }, { x: -3, z: 18 }, { x: -3, z: 13 }, { x: -3, z: 6 }, { x: 0, z: 2 },
  ] },
  { name: 'Defender Timber access', team: 'defenders', points: [
    { x: 0, z: 18 }, { x: 6, z: 21 }, { x: 17, z: 21 }, { x: 18, z: 16 }, { x: 18, z: 12 },
  ] },
];

/** Original secular merchant quarter. Heritage silhouettes stay beyond the sealed ramparts. */
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
  const stucco = material('weathered ochre limewash', '#d4ba8d');
  const fadedStucco = material('faded rose limewash', '#ba8c6c');
  const canopy = material('undyed woven market canvas', '#c5a66f');
  const paleWood = material('woven rattan and seasoned teak', '#a77c48');
  const leavesLight = material('sunlit tamarind leaves', '#8c955d');

  // Shared canvas textures keep the entire town independent of external art downloads.
  const woodTexture = track(new DynamicTexture('procedural teak grain', { width: 256, height: 512 }, scene, false));
  const woodContext = woodTexture.getContext() as CanvasRenderingContext2D;
  woodContext.fillStyle = '#8c6845'; woodContext.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 130; i++) {
    woodContext.strokeStyle = i % 3 ? 'rgba(48,27,15,.16)' : 'rgba(246,205,143,.18)';
    woodContext.lineWidth = .6 + random() * 2;
    const x = random() * 256;
    woodContext.beginPath(); woodContext.moveTo(x, 0);
    woodContext.bezierCurveTo(x + 12, 180, x - 9, 360, x + 4, 512); woodContext.stroke();
  }
  woodTexture.update(); woodTexture.wrapU = woodTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  wood.diffuseTexture = woodTexture; wood.diffuseColor.set(.74, .65, .54);
  paleWood.diffuseTexture = woodTexture; paleWood.diffuseColor.set(1, .93, .77);

  const stuccoTexture = track(new DynamicTexture('procedural time-worn limewash', 256, scene, false));
  const stuccoContext = stuccoTexture.getContext();
  stuccoContext.fillStyle = '#e2cfaa'; stuccoContext.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const alpha = .025 + random() * .06;
    stuccoContext.fillStyle = `rgba(111,73,44,${alpha})`;
    stuccoContext.fillRect(random() * 256, random() * 256, 1 + random() * 14, 1 + random() * 7);
  }
  stuccoTexture.update(); stuccoTexture.wrapU = stuccoTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  for (const mat of [stucco, fadedStucco]) mat.diffuseTexture = stuccoTexture;

  const stoneTexture = track(new DynamicTexture('procedural sandstone bedding', 256, scene, false));
  const stoneContext = stoneTexture.getContext();
  stoneContext.fillStyle = '#d5bb91'; stoneContext.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 600; i++) {
    stoneContext.fillStyle = i % 2 ? 'rgba(255,242,204,.12)' : 'rgba(99,73,45,.09)';
    stoneContext.fillRect(random() * 256, random() * 256, 1 + random() * 28, 1);
  }
  stoneTexture.update(); stoneTexture.wrapU = stoneTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  stone.diffuseTexture = stoneTexture; stone.diffuseColor.set(1, .96, .88);

  const fabricTexture = track(new DynamicTexture('procedural woven awning', 128, scene, false));
  const fabricContext = fabricTexture.getContext();
  fabricContext.fillStyle = '#d5c092'; fabricContext.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 4) {
    fabricContext.fillStyle = 'rgba(73,46,24,.10)'; fabricContext.fillRect(i, 0, 1, 128);
    fabricContext.fillRect(0, i, 128, 1);
  }
  fabricTexture.update(); fabricTexture.wrapU = fabricTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  canopy.diffuseTexture = fabricTexture;

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
  const smallDetail = (mesh: Mesh) => {
    // Only non-colliding, non-cover detail may disappear at low quality.
    mesh.metadata = { ...mesh.metadata, smallDetail: true };
    return mesh;
  };
  const ground = track(MeshBuilder.CreateGround('courtyard ground', { width: 220, height: 220 }, scene));
  ground.material = sand; ground.checkCollisions = true; ground.metadata = { solid: true };

  scene.clearColor = new Color4(.76, .69, .60, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = .0055; scene.fogColor = new Color3(.76, .69, .60);
  scene.ambientColor = new Color3(.15, .16, .18);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.08;
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
    mesh.position.set(x, .052, z); mesh.material = shadowMat; mesh.isPickable = false;
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
  // Sealed civic timber gateway: the playable quarter contains no sacred buildings.
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
      const tier = cylinder(`${name} teak hipped canopy ${level}`, x, baseY + level * .62, z, .85, r * 2, r * 1.22, wood, 4);
      tier.rotation.y = Math.PI / 4;
      const edge = cylinder(`${name} bronze roof drip edge ${level}`, x, baseY + level * .62 - .35, z, .095, r * 2.08, r * 2.08, brass, 4);
      edge.rotation.y = Math.PI / 4;
    }
    box(`${name} ridge cap`, x, baseY + (levels - 1) * .62 + .44, z, radius * .45, .16, .24, brass, false);
  };
  const tower = (name: string, x: number, z: number, height: number, width = 4.2) => {
    box(`${name} base`, x, .32, z, width + .8, .64, width + .8, darkStone);
    box(`${name} shaft`, x, height / 2, z, width, height, width);
    box(`${name} shoulder`, x, height - .2, z, width + .65, .5, width + .65, stone);
    for (const side of [-1, 1]) {
      box(`${name} inset`, x + side * width / 2, height * .64, z, .035, 1.5, .55, darkStone, false);
      box(`${name} inset front`, x + side * .9, height * .64, z - width / 2 - .01, .55, 1.5, .035, darkStone, false);
    }
    roof(name, x, z, height + .6, width * .75, 2);
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
  // The merchant guildhall and clockless watch house frame the central approach.
  wall('merchant guildhall left wing', -10.9, 23.8, 13, 7, 2.2);
  wall('merchant guildhall right wing', 10.9, 23.8, 13, 7, 2.2);
  arch('merchant guildhall great arch', 0, 23.8, 3.7, 4.5, 2.2);
  box('great arch pediment', 0, 9.2, 23.8, 9, 1.4, 2.4);
  box('great arch crown molding', 0, 10, 23.8, 9.8, .3, 2.8, stone);
  roof('guildhall council roof', 0, 23.8, 10.8, 3.8, 3);
  tower('guildhall left watch turret', -6.2, 23.8, 9, 2.5);
  tower('guildhall right watch turret', 6.2, 23.8, 9, 2.5);
  // Side courtyards have open gates, while layered walls frame the range.
  wall('market court north west wall', -24.05, 8, 2.1, 4.5, 1.2);
  wall('market court north east wall', -15.95, 8, 2.1, 4.5, 1.2);
  arch('market court north connecting arch', -20, 8, 2.5, 2.9, 1.2);
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

  // Receding ribs give these working passageways depth without fake closed doorways.
  arch('market vaulted passage inner rib', -20, -.65, 2.5, 2.9, .28);
  arch('timber vaulted passage inner rib', 20, 4.35, 2.4, 3, .28);
  for (const [x, z, width] of [[-20, -2.61, 6.2], [20, 2.39, 6], [0, 22.64, 8.8]]) {
    box('carved gateway horizontal teak beam', x, 5.9, z, width, .22, .24, wood, false);
    for (let i = -2; i <= 2; i++) {
      const diamond = smallDetail(box('original interlocking diamond gateway carving', x + i * .85, 5.9, z - .14, .14, .14, .045, brass, false));
      diamond.rotation.z = Math.PI / 4;
    }
  }

  const bandTexture = track(new DynamicTexture('original linked-diamond textile motif', { width: 128, height: 64 }, scene, false));
  const bandContext = bandTexture.getContext();
  bandContext.fillStyle = '#674b35'; bandContext.fillRect(0, 0, 128, 64);
  bandContext.strokeStyle = '#cda766'; bandContext.lineWidth = 3;
  for (const x of [0, 64, 128]) {
    bandContext.beginPath(); bandContext.moveTo(x - 32, 32); bandContext.lineTo(x, 7);
    bandContext.lineTo(x + 32, 32); bandContext.lineTo(x, 57); bandContext.closePath(); bandContext.stroke();
    bandContext.fillStyle = '#ad7948'; bandContext.fillRect(x - 4, 28, 8, 8);
  }
  bandContext.fillStyle = '#d1ad70'; bandContext.fillRect(0, 3, 128, 2); bandContext.fillRect(0, 59, 128, 2);
  bandTexture.update(); bandTexture.wrapU = Texture.WRAP_ADDRESSMODE; bandTexture.uScale = 5;
  const motif = material('original Burmese-inspired merchant geometric band', '#ffffff');
  motif.diffuseTexture = bandTexture;
  for (const x of [-10.8, 10.8]) {
    box('guildhall time-worn stucco panel', x, 3.65, 22.68, 6.6, 4.2, .035, x < 0 ? stucco : fadedStucco, false);
    box('guildhall merchant geometric frieze', x, 6, 22.64, 6.8, .33, .045, motif, false);
    for (const offset of [-2.1, 0, 2.1]) {
      box('guildhall shutter recess', x + offset, 4.15, 22.63, 1.15, 1.6, .06, darkStone, false);
      box('guildhall solid timber shutter', x + offset, 4.15, 22.59, .97, 1.43, .06, wood, false);
      for (const y of [3.72, 4.55]) box('guildhall shutter rail', x + offset, y, 22.54, 1.05, .09, .08, paleWood, false);
    }
  }

  const timberHouse = (name: string, x: number, z: number, width: number, depth: number, height: number, limewashed = false) => {
    box(`${name} sandstone raised foundation`, x, .36, z, width + .3, .72, depth + .3, darkStone);
    box(`${name} closed inhabited timber volume`, x, height / 2 + .48, z, width, height, depth, limewashed ? fadedStucco : wood);
    for (const side of [-1, 1]) {
      box(`${name} corner post`, x + side * (width / 2 - .14), height / 2 + .48, z - depth / 2 - .06, .22, height, .22, paleWood, false);
      box(`${name} side corner post`, x + side * (width / 2 - .14), height / 2 + .48, z + depth / 2 + .04, .22, height, .22, paleWood, false);
      const panel = box(`${name} overhanging gabled roof`, x, height + .85, z + side * (depth / 4 + .1), width + 1, .18, depth / 2 + .7, wood, false);
      panel.rotation.x = side * .36;
      box(`${name} rain-darkened eave fascia`, x, height + .33, z + side * (depth / 2 + .48), width + 1.05, .2, .13, paleWood, false);
    }
    box(`${name} roof ridge`, x, height + 1.34, z, width + 1.1, .17, .22, darkStone, false);
    box(`${name} geometric carved lintel`, x, height - .06, z - depth / 2 - .09, width - .15, .31, .1, motif, false);
    box(`${name} closed front door`, x, 1.66, z - depth / 2 - .055, 1.1, 2.4, .1, darkStone, false);
    box(`${name} teak door face`, x, 1.66, z - depth / 2 - .12, .96, 2.28, .07, wood, false);
    for (const side of [-1, 1]) {
      const wx = x + side * width * .3;
      box(`${name} dark window inset`, wx, 2.65, z - depth / 2 - .07, .95, 1.08, .1, ink, false);
      for (let i = -1; i <= 1; i++) box(`${name} shutter slat`, wx + i * .29, 2.65, z - depth / 2 - .13, .22, 1.05, .055, paleWood, false);
      box(`${name} sandstone window ledge`, wx, 2.08, z - depth / 2 - .18, 1.15, .13, .3, stone, false);
    }
    if (!limewashed) {
      for (let i = 0; i < Math.floor(height / .32); i++) {
        smallDetail(box(`${name} horizontal teak board seam`, x, .7 + i * .32, z - depth / 2 - .015, width - .3, .026, .04, darkStone, false));
      }
    }
    shade(x, z, width * 1.6, depth * 1.6);
  };
  timberHouse('Market Walk family house', -22.8, -16, 5.3, 4.5, 3.5);
  timberHouse('Timber Passage workshop', 22.6, -16, 5.1, 4.5, 3.8, true);
  timberHouse('west merchant storehouse', -10.1, 15, 5.1, 4.4, 3.7, true);
  timberHouse('east weavers storehouse', 11.3, 17.1, 5, 4.5, 3.9);

  const marketStall = (name: string, x: number, z: number, width: number, alternate: boolean) => {
    box(`${name} timber counter`, x, .7, z, width, 1.4, 1.5, wood);
    box(`${name} sandstone counter lip`, x, 1.43, z, width + .12, .12, 1.65, paleWood, false);
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) box(`${name} awning upright`, x + side * (width / 2 - .08), 1.55, z + end * 1.3, .14, 3.1, .14, wood);
      box(`${name} awning cross rail`, x, 2.96, z + side * 1.3, width + .36, .12, .12, paleWood, false);
    }
    for (let i = 0; i < 5; i++) {
      const strip = box(`${name} woven canvas awning strip`, x + (i - 2) * (width + .6) / 5, 3.04, z, (width + .6) / 5 + .025, .045, 3.15, i % 2 ? (alternate ? teal : redFabric) : canopy, false);
      strip.rotation.x = .08;
      box(`${name} scalloped canvas valance`, strip.position.x, 2.79, z - 1.56, (width + .6) / 5 + .02, .27, .035, i % 2 ? (alternate ? teal : redFabric) : canopy, false);
    }
    box(`${name} merchant geometric counter band`, x, .94, z - .766, width - .2, .27, .025, motif, false);
    for (let i = 0; i < 4; i++) {
      const px = x - width * .33 + i * width * .21;
      smallDetail(cylinder(`${name} spice bowl`, px, 1.56, z, .18, .38, .52, i % 2 ? clay : paleWood, 10));
      smallDetail(cylinder(`${name} dry goods`, px, 1.66, z, .1, .42, .1, i % 2 ? orange : green, 10));
    }
    shade(x, z, width * 1.5, 4.6);
  };
  marketStall('western spice seller', -24, -7.5, 3.4, false);
  marketStall('northern basket seller', -24.4, 10.8, 3, false);
  marketStall('eastern cloth seller', 24.5, -6, 3.1, true);
  marketStall('timber yard tea seller', 24.5, 18.5, 3, true);

  // Cover breaks the spawn-to-spawn sightline behind the preserved centre target.
  // Both flanks stay open; it is a secular covered goods wagon, not a sacred object.
  box('courtyard storage wagon chassis', 0, .83, 16, 3.2, 1.3, 1.6, wood);
  box('courtyard storage wagon taut canvas cover', 0, 1.94, 16, 3.2, 1.2, 1.6, canopy);
  for (const z of [15.24, 16.76]) {
    box('courtyard wagon end framing', 0, 1.43, z, 3.24, .16, .12, paleWood, false);
    box('courtyard wagon lower framing', 0, .32, z, 3.24, .16, .12, paleWood, false);
    for (const x of [-1.45, 1.45]) box('courtyard wagon corner framing', x, 1.38, z, .13, 2.24, .13, paleWood, false);
  }
  for (const x of [-1.69, 1.69]) {
    for (const z of [15.46, 16.54]) {
      const wheel = cylinder('covered goods wagon solid timber wheel', x, .48, z, .16, .94, .94, wood, 16);
      wheel.rotation.z = Math.PI / 2;
      const hub = cylinder('wagon bronze wheel hub', x * 1.02, .48, z, .18, .25, .25, brass, 12);
      hub.rotation.z = Math.PI / 2;
    }
  }
  for (const x of [-1, 0, 1]) box('courtyard wagon canvas binding', x, 1.98, 15.18, .055, 1.08, .035, wood, false);
  shade(0, 16, 5.2, 3.5);

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
  sign('A', 'MARKET COURT', -13.3, -.59, '#e6bd79');
  sign('B', 'TIMBER YARD', 14.7, 2.39, '#8dc8bc');

  // Thin decorative paving rests on the existing continuous collision ground.
  const paving = (name: string, x: number, z: number, width: number, depth: number, mat: StandardMaterial) => {
    const mesh = track(MeshBuilder.CreateGround(name, { width, height: depth }, scene));
    mesh.position.set(x, .021, z); mesh.material = mat; mesh.isPickable = false;
    mesh.metadata = { decorative: true };
    return mesh;
  };
  paving('Central Courtyard worn sandstone paving', 0, 1.5, 12, 39, stone);
  paving('Market Court sandstone paving', -19, 4.5, 8, 7, stone);
  for (let i = 0; i < 28; i++) {
    box('Timber Passage worn boardwalk plank', 19.5, .027, -3.8 + i * .35, 7, .035, .325, i % 4 ? wood : paleWood, false);
  }
  for (let i = 0; i < 23; i++) {
    box('Timber Yard storage deck plank', 18.5, .028, 8.15 + i * .35, 7, .035, .328, i % 5 ? paleWood : wood, false);
  }
  for (let i = 0; i < 18; i++) {
    for (const side of [-1, 1]) smallDetail(box('courtyard paving border inlay', side * 5.85, .036, -16.5 + i * 2, .12, .012, .65, brass, false));
  }

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
    const chip = smallDetail(box('tumbled masonry chip', x, .06 + random() * .06, z, .12 + random() * .3, .12, .16 + random() * .3, i % 3 === 0 ? stone : clay, false));
    chip.rotation.y = random() * Math.PI;
  }

  for (const [x, z] of [[-24, 4], [-17, 3.5], [24, 10], [21.4, -9.5], [-15.5, 19]]) {
    const basket = cylinder('woven market basket solid body', x, .39, z, .78, .66, .86, paleWood, 12);
    basket.checkCollisions = true; basket.isPickable = true; basket.metadata = { solid: true };
    cylinder('basket dark open interior', x, .79, z, .025, .71, .71, darkStone, 12);
    for (let i = 0; i < 6; i++) smallDetail(cylinder('basket horizontal woven binding', x, .12 + i * .12, z, .026, .71 + i * .026, .71 + i * .026, wood, 12));
    shade(x, z, 1.3, 1.3);
  }
  const tree = (name: string, x: number, z: number, scale: number) => {
    const trunk = cylinder(`${name} solid trunk`, x, 1.65 * scale, z, 3.3 * scale, .44 * scale, .25 * scale, wood, 8);
    trunk.checkCollisions = true; trunk.isPickable = true; trunk.metadata = { solid: true };
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.4;
      const branch = cylinder(`${name} branch`, x + Math.cos(angle) * .35 * scale, (2.75 + i * .17) * scale,
        z + Math.sin(angle) * .35 * scale, 1.45 * scale, .16 * scale, .07 * scale, wood, 6);
      branch.rotation.z = Math.sin(angle) * .65; branch.rotation.x = Math.cos(angle) * .65;
      const crown = track(MeshBuilder.CreateSphere(`${name} stylized foliage cluster`, { diameter: 2.4 * scale, segments: 5 }, scene));
      crown.position.set(x + Math.cos(angle) * 1.05 * scale, (3.9 + (i % 2) * .5) * scale, z + Math.sin(angle) * 1.05 * scale);
      crown.scaling.y = .65; crown.material = i % 2 ? leavesLight : green; crown.isPickable = false;
      crown.metadata = { decorative: true };
    }
    shade(x, z, 5 * scale, 4 * scale);
  };
  tree('courtyard tamarind', -24, 21.6, 1.1);
  tree('eastern shade tree', 24.4, 10.4, .95);
  tree('attacker west shade tree', -16, -15.2, .85);
  tree('attacker east shade tree', 15.6, -15.2, .85);
  for (const [x, z] of [[-25, -.2], [-25, 13.8], [-16.3, 6.5], [25, -9], [25, 5], [14.2, 21], [-13, 21]]) {
    for (let i = 0; i < 5; i++) {
      const tuft = smallDetail(box('wind-worn roadside grasses', x + (random() - .5) * .5, .26, z + (random() - .5) * .5, .045, .55 + random() * .25, .12, i % 2 ? green : leavesLight, false));
      tuft.rotation.z = (random() - .5) * .7; tuft.rotation.y = random() * Math.PI;
    }
  }

  // The only heritage-inspired silhouettes are inaccessible, non-colliding scenery
  // beyond z=58. They are fictional, and never become combat/destruction targets.
  const skylineStart = assets.length;
  for (let i = 0; i < 20; i++) {
    const x = -94 + i * 10 + random() * 6;
    const z = 58 + random() * 36;
    const height = 4 + random() * 8;
    const radius = 2.2 + random() * 2.5;
    cylinder('distant sanctuary terrace', x, .5, z, 1, radius * 3.1, radius * 2.9, clay, 8);
    cylinder('distant sanctuary drum', x, 1.7, z, 2, radius * 2.7, radius * 2.2, clay, 12);
    cylinder('distant bell silhouette', x, 3 + height / 3, z, height * .65, radius * 2.3, radius * .9, clay, 24);
    for (let tier = 0; tier < 4; tier++) {
      const r = radius * .86 * Math.pow(.64, tier);
      cylinder('inaccessible heritage skyline stepped crown', x, height * .65 + 3 + tier * .66, z, .95, r * 2, r * 1.13, clay, 8);
    }
    cylinder('inaccessible heritage skyline slender crown', x, height * .65 + 6.1, z, 2.1, .32, .025, stone, 8);
  }
  for (const asset of assets.slice(skylineStart)) {
    if (asset instanceof Mesh) {
      asset.checkCollisions = false; asset.isPickable = false;
      asset.metadata = { decorative: true, skyline: true };
    }
  }
  // Gentle paving guides the central approach without copying any existing map.
  for (let i = 0; i < 15; i++) {
    const paver = box('worn merchant path slab', (i % 2 ? -.55 : .55), .034, -16 + i * 2.5, 2, .025, 1.4, i % 3 ? stone : stucco, false);
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

  // Batch by material, collision role and detail tier. The outside skyline stays
  // separate for culling and to preserve its explicitly non-interactive contract.
  const batches = new Map<string, { material: StandardMaterial; solid: boolean; smallDetail: boolean; skyline: boolean; meshes: Mesh[] }>();
  const animatedMeshes = new Set(animated.map(item => item.mesh));
  for (const asset of assets) {
    if (!(asset instanceof Mesh) || asset.parent || asset === ground || asset === sun || animatedMeshes.has(asset)) continue;
    if (!(asset.material instanceof StandardMaterial)) continue;
    const solid = asset.metadata?.solid === true;
    const smallDetail = !solid && asset.metadata?.smallDetail === true;
    const skyline = asset.metadata?.skyline === true;
    const key = `${asset.material.uniqueId}:${solid}:${smallDetail}:${skyline}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { material: asset.material, solid, smallDetail, skyline, meshes: [] };
      batches.set(key, batch);
    }
    batch.meshes.push(asset);
  }
  for (const batch of batches.values()) {
    if (batch.meshes.length < 2) continue;
    const merged = Mesh.MergeMeshes(batch.meshes, true, true, undefined, false, false);
    if (!merged) continue;
    track(merged);
    merged.name = `${batch.material.name} ${batch.skyline ? 'inaccessible skyline batch' : batch.solid ? 'old city collision batch' : 'static detail batch'}`;
    merged.material = batch.material;
    merged.checkCollisions = batch.solid;
    merged.isPickable = batch.solid;
    merged.metadata = batch.solid ? { solid: true } : { decorative: true, smallDetail: batch.smallDetail, skyline: batch.skyline };
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
  const optionalDetails = assets.filter((asset): asset is Mesh => asset instanceof Mesh && !asset.isDisposed() && asset.metadata?.smallDetail === true);
  let quality: 'low' | 'medium' | 'high' = coarsePointer ? 'medium' : 'high';
  const configureQuality = (next: 'low' | 'medium' | 'high') => {
    if (next === quality) return;
    quality = next;
    sunLight.shadowEnabled = next !== 'low';
    for (const mesh of optionalDetails) mesh.setEnabled(next !== 'low');
    if (next === 'low') return;
    const mapSize = next === 'high' ? 1024 : 512;
    if (shadows.mapSize !== mapSize) shadows.mapSize = mapSize;
    const map = shadows.getShadowMap();
    if (map) {
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      map.resetRefreshCounter();
    }
  };
  const surfaceAt = ({ x, z }: { x: number; z: number }): 'sand' | 'stone' | 'wood' => {
    if ((x >= 16 && x <= 23 && z >= -4 && z <= 6) || (x >= 15 && x <= 22 && z >= 8 && z <= 16)) return 'wood';
    if ((Math.abs(x) <= 6 && z >= -18 && z <= 21) || (x >= -23 && x <= -15 && z >= 1 && z <= 8)) return 'stone';
    return 'sand';
  };
  const locationAt = ({ x, z }: { x: number; z: number }) => {
    if (z < -10 && Math.abs(x) < 10) return 'ATTACKER SPAWN';
    if (z > 17 && Math.abs(x) < 7) return 'DEFENDER SPAWN';
    if (x < -14 && z >= 0 && z <= 8.5) return 'A · MARKET COURT';
    if (x > 14 && z >= 7.5 && z < 16.5) return 'B · TIMBER YARD';
    if (x < -13) return 'MARKET WALK';
    if (x > 13) return 'TIMBER PASSAGE';
    return 'CENTRAL COURTYARD';
  };
  return {
    spawn: new Vector3(0, 1.7, -12), targets, configureQuality, surfaceAt, locationAt,
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
