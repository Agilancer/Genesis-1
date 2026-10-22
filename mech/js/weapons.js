import * as THREE from './three.js';
import { W, WEAPON_SHEET, SKINS, chamferBox, frontPrism, cylZ, cylX, mesh, place, canvasTexture, addOutline } from './atlas.js';

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const WP = (geo, mat, faces) => mesh(geo, mat, WEAPON_SHEET, faces);
const UP = new V3(0, 1, 0);
const FWD = new V3(0, 0, 1);
const _p = new V3();
const _d = new V3();
const _t = new V3();
const _q = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const WEAPONS = {
  beamRifle: { name: 'BR-07 Beam Rifle', short: 'BEAM RIFLE', slots: ['hand'], kind: 'beam', ammo: 16, reload: 2.6, rate: 0.3, dmg: 30, speed: 330, color: 0xff4fc8, desc: 'Fast mega-particle bolts. Precise and reliable.' },
  bazooka: { name: 'HB-90 Hyper Bazooka', short: 'BAZOOKA', slots: ['hand'], kind: 'rocket', ammo: 5, reload: 3.4, rate: 0.95, dmg: 90, splash: 9, speed: 120, desc: 'Heavy unguided rockets with a wide blast.' },
  machineGun: { name: 'MG-79 Machine Gun', short: 'MACHINE GUN', slots: ['hand'], kind: 'bullet', ammo: 90, reload: 2.4, rate: 0.075, dmg: 6, speed: 400, spread: 0.012, desc: 'Rotary 90 mm. Sustained suppressing fire.' },
  shotgun: { name: 'SC-12 Shotgun Cannon', short: 'SHOTGUN', slots: ['hand'], kind: 'pellet', ammo: 6, reload: 2.8, rate: 0.75, dmg: 9, pellets: 10, spread: 0.055, speed: 320, desc: 'Ten-pellet spread. Devastating up close.' },
  grenade: { name: 'GL-6 Grenade Launcher', short: 'GRENADES', slots: ['hand'], kind: 'grenade', ammo: 8, reload: 3, rate: 0.42, dmg: 55, splash: 7, speed: 80, desc: 'Rotary drum of arcing high-explosive shells.' },
  beamCannon: { name: 'MBC-2 Mega Beam Cannon', short: 'BEAM CANNON', slots: ['hand', 'shoulder'], kind: 'mega', ammo: 3, reload: 4.5, rate: 2.2, charge: 0.6, duration: 1.4, dps: 150, color: 0xffb84a, desc: 'Charged sustained beam that cuts through everything.' },
  vulcanPod: { name: 'VP-4 Vulcan Pod', short: 'VULCAN', slots: ['shoulder'], kind: 'bullet', ammo: 200, reload: 3, rate: 0.05, dmg: 4, speed: 420, spread: 0.022, desc: 'Shoulder gatling. Fires with the cannon trigger.' },
  missilePod: { name: 'MP-6 Missile Pod', short: 'MISSILES', slots: ['shoulder', 'leg'], kind: 'missile', missiles: 6, cols: 3, rows: 2, dmg: 34, splash: 5, mscale: 1, interval: 0.09, reloadTime: 6, speed: 95, desc: 'Six homing missiles behind an armored hatch.' },
  heavyPod: { name: 'HMP-8 Heavy Missile Pod', short: 'HEAVY MSL', slots: ['shoulder'], kind: 'missile', missiles: 8, cols: 4, rows: 2, dmg: 60, splash: 8, mscale: 1.5, interval: 0.14, reloadTime: 9, speed: 80, desc: 'Eight large warheads. Slow, huge blasts.' },
  microPod: { name: 'μMP-24 Micro Missile Pod', short: 'MICRO MSL', slots: ['shoulder', 'leg'], kind: 'missile', missiles: 24, cols: 6, rows: 4, dmg: 12, splash: 3.5, mscale: 0.6, interval: 0.035, reloadTime: 8, speed: 105, wobble: 1.7, desc: 'Twenty-four swarming micro missiles.' },
  shield: { name: 'RX-S Shield', short: 'SHIELD', slots: ['leftHand'], kind: 'shield', desc: 'Forearm shield. Hold the left trigger to raise it.' },
};

export const SLOTS = [
  { id: 'rightHand', label: 'Right hand', type: 'hand', key: 'LMB' },
  { id: 'leftHand', label: 'Left hand', type: 'hand', key: 'RMB' },
  { id: 'shoulderL', label: 'Left shoulder', type: 'shoulder', key: 'F' },
  { id: 'shoulderR', label: 'Right shoulder', type: 'shoulder', key: 'F' },
  { id: 'legL', label: 'Left leg', type: 'leg', key: 'Q/E' },
  { id: 'legR', label: 'Right leg', type: 'leg', key: 'Q/E' },
];

export function allowedFor(slot) {
  return Object.keys(WEAPONS).filter((id) => {
    const d = WEAPONS[id];
    return d.slots.includes(slot.type) || d.slots.includes(slot.id);
  });
}

export const PRESETS = [
  { name: 'Vanguard', paint: 'lynx', slots: { rightHand: ['beamRifle', 'bronze'], leftHand: ['shield', 'gunmetal'], shoulderL: ['missilePod', 'gunmetal'], shoulderR: ['microPod', 'gunmetal'], legL: ['missilePod', 'gunmetal'], legR: ['missilePod', 'gunmetal'] } },
  { name: 'Full Armor', paint: 'desert', slots: { rightHand: ['machineGun', 'olive'], leftHand: ['shield', 'olive'], shoulderL: ['heavyPod', 'olive'], shoulderR: ['heavyPod', 'olive'], legL: ['microPod', 'olive'], legR: ['microPod', 'olive'] } },
  { name: 'Artillery', paint: 'steel', slots: { rightHand: ['bazooka', 'gunmetal'], leftHand: ['grenade', 'gunmetal'], shoulderL: ['beamCannon', 'gunmetal'], shoulderR: ['missilePod', 'gunmetal'], legL: ['missilePod', 'gunmetal'], legR: ['missilePod', 'gunmetal'] } },
  { name: 'Beam Striker', paint: 'glint', slots: { rightHand: ['beamRifle', 'white'], leftHand: ['beamCannon', 'white'], shoulderL: ['vulcanPod', 'white'], shoulderR: ['vulcanPod', 'white'], legL: [null, 'white'], legR: [null, 'white'] } },
  { name: 'Breacher', paint: 'unsung', slots: { rightHand: ['shotgun', 'hazard'], leftHand: ['machineGun', 'hazard'], shoulderL: ['microPod', 'hazard'], shoulderR: ['microPod', 'hazard'], legL: ['missilePod', 'hazard'], legR: ['missilePod', 'hazard'] } },
];

// ---------------------------------------------------------------------------
// Weapon models. All are built along +Z (muzzle forward). Hand weapons have
// the grip at the origin; mounted weapons have their base at the origin.
// ---------------------------------------------------------------------------

function muzzleAt(g, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  g.add(o);
  return o;
}

const LENS = new THREE.MeshStandardMaterial({ color: 0x0b1a24, roughness: 0.05, metalness: 0.9, emissive: 0x1aa0ff, emissiveIntensity: 0.6 });

function buildBeamRifle(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.36, 0.52, 1.7, 0.08), m.body, { x: W.rifleB, all: W.rifleA }), 0, 0.2, 0.45);
  place(g, WP(chamferBox(0.22, 0.24, 1.5, 0.06), m.body, { all: W.rifleA }), 0, 0.27, 1.95);
  place(g, WP(cylZ(0.15, 0.15, 0.5, 14), m.metal), 0, 0.27, 2.9);
  place(g, WP(cylZ(0.19, 0.15, 0.2, 14), m.metal), 0, 0.27, 3.2);
  place(g, WP(cylZ(0.1, 0.1, 0.02, 12), m.bore), 0, 0.27, 3.31);
  place(g, WP(chamferBox(0.18, 0.22, 0.66, 0.04), m.raw, { all: W.rifleDark }), 0, 0.58, 0.35);
  place(g, new THREE.Mesh(cylZ(0.075, 0.075, 0.04, 12), LENS), 0, 0.58, 0.69);
  place(g, WP(chamferBox(0.28, 0.4, 0.8, 0.1), m.body, { x: W.rifleB, all: W.rifleA }), 0, 0.12, -0.75);
  place(g, WP(chamferBox(0.16, 0.42, 0.22, 0.05), m.metal), 0, -0.15, 0);
  place(g, WP(chamferBox(0.24, 0.42, 0.38, 0.05), m.raw, { all: W.rifleDark }), 0, -0.18, 0.72);
  place(g, WP(chamferBox(0.37, 0.07, 0.6, 0.02), m.stripe), 0, 0.42, 0.95);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.27, 3.35)] };
}

function buildBazooka(m) {
  const g = new THREE.Group();
  place(g, WP(cylZ(0.3, 0.3, 4.2, 18), m.body, { x: W.bazWhite, y: W.bazWhite2, z: W.bazDark }), 0, 0.42, 0.7);
  const bell = new THREE.LatheGeometry([[0.3, 0], [0.42, 0.25], [0.4, 0.3], [0.27, 0.05]].map(([x, y]) => new THREE.Vector2(x, y)), 18);
  bell.rotateX(Math.PI / 2);
  place(g, WP(bell, m.metal), 0, 0.42, 2.8);
  const rear = bell.clone();
  rear.rotateY(Math.PI);
  place(g, WP(rear, m.metal), 0, 0.42, -1.4);
  place(g, WP(cylZ(0.24, 0.24, 0.05, 16), m.bore), 0, 0.42, 2.82);
  place(g, WP(cylZ(0.315, 0.315, 0.3, 18), m.stripe), 0, 0.42, 2.3);
  place(g, WP(chamferBox(0.42, 0.52, 0.8, 0.08), m.raw, { all: W.bazDark }), 0, 0.92, -0.4);
  place(g, WP(chamferBox(0.16, 0.24, 0.6, 0.04), m.metal), -0.36, 0.62, 0.6);
  place(g, new THREE.Mesh(cylZ(0.07, 0.07, 0.04, 10), LENS), -0.36, 0.62, 0.92);
  place(g, WP(chamferBox(0.16, 0.42, 0.22, 0.05), m.metal), 0, -0.05, 0);
  place(g, WP(chamferBox(0.14, 0.36, 0.2, 0.05), m.metal), 0, 0.0, 1.0);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.42, 3.15)], rear: muzzleAt(g, 0, 0.42, -1.6) };
}

function gatling(m, barrels, r, len, br) {
  const spin = new THREE.Group();
  for (let i = 0; i < barrels; i++) {
    const a = (i / barrels) * Math.PI * 2;
    place(spin, WP(cylZ(br, br, len, 8), m.metal), Math.cos(a) * r, Math.sin(a) * r, len / 2);
  }
  place(spin, WP(cylZ(r + br * 1.6, r + br * 1.6, 0.18, 14), m.metal), 0, 0, 0.12);
  place(spin, WP(cylZ(r + br * 1.4, r + br * 1.4, 0.12, 14), m.metal), 0, 0, len - 0.1);
  place(spin, WP(cylZ(r * 0.5, r * 0.5, len, 8), m.raw, { all: W.mgDark }), 0, 0, len / 2);
  return spin;
}

function buildMachineGun(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.38, 0.5, 1.4, 0.08), m.body, { x: W.mgWhite, all: W.mgWhite }), 0, 0.2, 0.4);
  place(g, WP(cylX(0.34, 0.3, 18), m.raw, { all: W.mgDark }), 0, -0.25, 0.6);
  place(g, WP(chamferBox(0.26, 0.36, 0.7, 0.08), m.body, { all: W.mgWhite }), 0, 0.12, -0.6);
  place(g, WP(chamferBox(0.16, 0.42, 0.22, 0.05), m.metal), 0, -0.15, 0);
  place(g, WP(chamferBox(0.39, 0.06, 0.4, 0.02), m.stripe), 0, 0.42, 0.7);
  const spin = gatling(m, 6, 0.13, 1.35, 0.05);
  spin.position.set(0, 0.22, 1.08);
  g.add(spin);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.22, 2.5)], spin };
}

function buildShotgun(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.44, 0.56, 1.5, 0.1), m.body, { x: W.sgWhite, all: W.sgWhite }), 0, 0.2, 0.35);
  place(g, WP(chamferBox(0.54, 0.36, 1.05, 0.1), m.body, { x: W.sgLabel, all: W.sgWhite }), 0, 0.32, 1.55);
  for (const s of [-1, 1]) {
    place(g, WP(cylZ(0.13, 0.13, 0.6, 12), m.metal), s * 0.12, 0.32, 2.2);
    place(g, WP(cylZ(0.09, 0.09, 0.02, 12), m.bore), s * 0.12, 0.32, 2.51);
  }
  place(g, WP(chamferBox(0.32, 0.2, 0.55, 0.05), m.metal), 0, 0.06, 1.35);
  place(g, WP(chamferBox(0.28, 0.42, 0.7, 0.1), m.body, { all: W.sgWhite }), 0, 0.12, -0.7);
  place(g, WP(chamferBox(0.16, 0.42, 0.22, 0.05), m.metal), 0, -0.15, 0);
  place(g, WP(chamferBox(0.45, 0.07, 0.5, 0.02), m.stripe), 0, 0.5, 0.6);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.32, 2.55)] };
}

function buildGrenade(m) {
  const g = new THREE.Group();
  place(g, WP(cylZ(0.44, 0.44, 0.75, 16), m.body, { x: W.glWhite, y: W.glWhite, z: W.glDrums }), 0, 0.3, 0.55);
  place(g, WP(chamferBox(0.36, 0.38, 1.4, 0.08), m.body, { all: W.glWhite }), 0, -0.02, 0.2);
  place(g, WP(chamferBox(0.3, 0.38, 0.6, 0.08), m.raw, { all: W.glLabel }), 0, 0.12, -0.75);
  place(g, WP(chamferBox(0.16, 0.42, 0.22, 0.05), m.metal), 0, -0.25, 0);
  place(g, WP(cylZ(0.45, 0.45, 0.08, 16), m.stripe), 0, 0.3, 0.95);
  const spin = new THREE.Group();
  spin.position.set(0, 0.3, 0.95);
  g.add(spin);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    place(spin, WP(cylZ(0.13, 0.13, 0.85, 10), m.metal), Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.42);
    place(spin, WP(cylZ(0.09, 0.09, 0.02, 10), m.bore), Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.86);
  }
  return { group: g, muzzles: [muzzleAt(g, 0, 0.3, 1.9)], spin, spinStep: Math.PI / 2 };
}

function buildBeamCannon(m, mounted) {
  const g = new THREE.Group();
  const root = new THREE.Group();
  g.add(root);
  if (mounted) {
    root.position.set(0, 0.45, 0.2);
    place(g, WP(chamferBox(0.5, 0.5, 0.6, 0.1), m.metal), 0, 0.2, -0.1);
  }
  place(root, WP(chamferBox(0.44, 0.52, 2.0, 0.1), m.body, { x: W.bcWhite, all: W.bcWhite2 }), 0, 0.25, 0.4);
  place(root, WP(chamferBox(0.32, 0.32, 1.6, 0.06), m.body, { all: W.bcWhite2 }), 0, 0.3, 2.2);
  for (let i = 0; i < 4; i++) place(root, WP(chamferBox(0.46, 0.46, 0.08, 0.1), m.metal), 0, 0.3, 1.7 + i * 0.22);
  place(root, WP(cylZ(0.27, 0.22, 0.34, 16), m.metal), 0, 0.3, 3.1);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ color: 0xffb84a, toneMapped: false, transparent: true, opacity: 0.25 }));
  lens.position.set(0, 0.3, 3.28);
  root.add(lens);
  place(root, WP(chamferBox(0.2, 0.3, 1.2, 0.05), m.raw, { all: W.bcDark }), 0, 0.62, 0.3);
  place(root, WP(chamferBox(0.46, 0.08, 0.5, 0.02), m.stripe), 0, 0.53, 1.05);
  place(root, WP(cylZ(0.07, 0.07, 1.6, 8), m.metal), 0.2, 0.0, 0.6);
  if (!mounted) place(root, WP(chamferBox(0.16, 0.42, 0.22, 0.05), m.metal), 0, -0.15, 0);
  return { group: g, muzzles: [muzzleAt(root, 0, 0.3, 3.35)], lens };
}

function buildVulcanPod(m) {
  const g = new THREE.Group();
  place(g, WP(chamferBox(0.62, 0.56, 1.1, 0.12), m.body, { x: W.mgWhite, nz: W.mgDark, all: W.mgWhite }), 0, 0.32, 0.1);
  place(g, WP(chamferBox(0.64, 0.08, 0.3, 0.02), m.stripe), 0, 0.62, 0.3);
  const spin = gatling(m, 4, 0.1, 0.9, 0.05);
  spin.position.set(0, 0.32, 0.62);
  g.add(spin);
  return { group: g, muzzles: [muzzleAt(g, 0, 0.32, 1.6)], spin };
}

function buildPod(def, m) {
  const g = new THREE.Group();
  const big = def.missiles === 8, micro = def.missiles === 24;
  const pitch = big ? 0.38 : micro ? 0.17 : 0.32;
  const w = def.cols * pitch + 0.22, h = def.rows * pitch + 0.2, d = big ? 1.6 : micro ? 0.95 : 1.25;
  const front = big ? W.podTubes8 : micro ? W.microGrid : W.podTubes6;
  place(g, WP(chamferBox(w, h, d, 0.08), m.body, { pz: front, x: big ? W.podWhite2 : W.podFace, py: W.podWhite, ny: W.podDark, nz: W.podDark }), 0, h / 2, 0);
  place(g, WP(chamferBox(w + 0.02, 0.08, 0.3, 0.02), m.stripe), 0, h * 0.78, -d * 0.2);
  // Armored hatch hinged at the top front edge
  const hinge = new THREE.Group();
  hinge.position.set(0, h - 0.02, d / 2 + 0.04);
  g.add(hinge);
  place(hinge, WP(chamferBox(w * 0.97, h * 0.94, 0.07, 0.06), m.body, { pz: micro ? W.podFace : W.podWhite, all: W.podWhite }), 0, -h * 0.47, 0);
  const tubes = [];
  for (let r = 0; r < def.rows; r++) {
    for (let c = 0; c < def.cols; c++) {
      const x = (c - (def.cols - 1) / 2) * pitch;
      const y = h / 2 + ((def.rows - 1) / 2 - r) * pitch;
      tubes.push(muzzleAt(g, x, y, d / 2 + 0.05));
    }
  }
  return { group: g, muzzles: tubes, tubes, hatch: hinge };
}

function buildShield(m) {
  const g = new THREE.Group();
  // Angular kite shield with a raised spine and a diagonal band
  const pts = [[-0.6, 1.5], [0.6, 1.5], [0.8, 1.06], [0.7, -0.9], [0, -1.9], [-0.7, -0.9], [-0.8, 1.06]];
  place(g, WP(frontPrism(pts.map(([x, y]) => [x * 1.06, y * 1.04]), 0.1, 0.03), m.metal), 0, 0, -0.02);
  place(g, WP(frontPrism(pts, 0.18, 0.05), m.body, { pz: W.podWhite2, all: W.podWhite }), 0, 0, 0.06);
  place(g, WP(frontPrism([[-0.09, 1.36], [0.09, 1.36], [0.11, -1.4], [0, -1.62], [-0.11, -1.4]], 0.08, 0.02), m.metal), 0, 0, 0.17);
  const band = place(g, WP(chamferBox(1.3, 0.1, 0.05, 0.02), m.stripe), 0, 0.9, 0.16);
  band.rotation.z = -0.32;
  return { group: g, muzzles: [] };
}

export function buildWeaponModel(id, skin, mats) {
  const def = WEAPONS[id];
  const m = mats.weaponFor(skin);
  let model;
  switch (id) {
    case 'beamRifle': model = buildBeamRifle(m); break;
    case 'bazooka': model = buildBazooka(m); break;
    case 'machineGun': model = buildMachineGun(m); break;
    case 'shotgun': model = buildShotgun(m); break;
    case 'grenade': model = buildGrenade(m); break;
    case 'beamCannon': model = buildBeamCannon(m, false); break;
    case 'vulcanPod': model = buildVulcanPod(m); break;
    case 'shield': model = buildShield(m); break;
    default: model = buildPod(def, m);
  }
  model.def = def;
  return model;
}

// ---------------------------------------------------------------------------
// Projectile visuals
// ---------------------------------------------------------------------------

// Beams are ribbons that run along local +Y (0..1) and turn about that axis
// to face the camera, so they read as solid light from any angle.
const BEAM_VERT = /* glsl */`
uniform float uWidth;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 base = (modelMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz;
  vec3 axis = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 side = cross(axis, cameraPosition - base);
  float L = length(side);
  side = L > 1e-5 ? side / L : vec3(1.0, 0.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(base + side * position.x * uWidth, 1.0);
}`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uCore;
varying vec2 vUv;
void main() {
  float d = abs(vUv.x - 0.5) * 2.0;
  float glow = pow(1.0 - d, 2.2);
  float core = smoothstep(0.32, 0.0, d) * uCore;
  float ripple = 0.85 + 0.15 * sin(vUv.y * 160.0 - uTime * 90.0);
  vec3 col = uColor * glow * 1.4 + vec3(1.0) * core;
  gl_FragColor = vec4(col * ripple * uAlpha, 1.0);
}`;

function beamMaterial(color, core = 1, width = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 1 }, uCore: { value: core }, uWidth: { value: width } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

// Ribbon from y=0 to y=1, oriented later with a quaternion
const BEAM_GEO = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
const TRACER_GEO = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);

function missileTexture() {
  return canvasTexture(64, (g, s) => {
    g.fillStyle = '#ecebe6'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#3a3c42'; g.fillRect(0, s * 0.82, s, s * 0.18);
    g.fillStyle = '#d8322b'; g.fillRect(0, s * 0.12, s, s * 0.12);
    g.fillStyle = '#f2b632'; g.fillRect(0, s * 0.62, s, s * 0.04);
  });
}

let missileAssets;
function getMissileAssets() {
  if (missileAssets) return missileAssets;
  const body = new THREE.LatheGeometry([[0, -0.5], [0.075, -0.5], [0.075, 0.22], [0.06, 0.36], [0.025, 0.47], [0, 0.5]]
    .map(([x, y]) => new THREE.Vector2(x, y)), 10);
  body.rotateX(Math.PI / 2);
  const fins = new THREE.BoxGeometry(0.3, 0.018, 0.16).translate(0, 0, -0.4);
  const fins2 = new THREE.BoxGeometry(0.018, 0.3, 0.16).translate(0, 0, -0.4);
  missileAssets = {
    body, fins, fins2,
    mat: new THREE.MeshStandardMaterial({ map: missileTexture(), roughness: 0.5, metalness: 0.2 }),
    finMat: new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.5, metalness: 0.5 }),
  };
  return missileAssets;
}

// ---------------------------------------------------------------------------
// Weapon system: runtime state for equipped weapons and all projectiles
// ---------------------------------------------------------------------------

export class WeaponSystem {
  constructor({ scene, fx, sound, world, mech, mats }) {
    this.scene = scene;
    this.fx = fx;
    this.sound = sound;
    this.world = world;
    this.mech = mech;
    this.mats = mats;
    this.slots = {};
    this.time = 0;
    this.bolts = [];
    this.tracers = [];
    this.rockets = [];
    this.missiles = [];
    this.megas = [];
    this.queue = [];
    this.pool = { bolt: [], tracer: [], missile: [] };
    this.hand = [{ aim: 0, recoil: 0, reload: false, lastUse: -9 }, { aim: 0, recoil: 0, reload: false, lastUse: -9 }];
    this.shieldUp = false;
    this.lock = new LockOn(sound);
    this.hardTarget = null; // target held by the lock-on button
    this.missileCycle = 0;
    this.onShake = () => {};
  }

  equip(loadout) {
    // Clear existing models
    for (const id in this.slots) {
      const s = this.slots[id];
      if (s.beam) this.endMega(s);
    }
    for (const m of Object.keys(this.mech.mounts)) this.mech.attach(m, null);
    this.queue.length = 0;
    this.slots = {};
    for (const slot of SLOTS) {
      const [wid, skinId] = loadout.slots[slot.id] || [null, 'white'];
      if (!wid) continue;
      const skin = SKINS.find((s) => s.id === skinId) || SKINS[0];
      const def = WEAPONS[wid];
      const mounted = slot.type === 'shoulder' && wid === 'beamCannon';
      const model = mounted ? Object.assign(buildBeamCannon(this.mats.weaponFor(skin), true), { def }) : buildWeaponModel(wid, skin, this.mats);
      let mount = slot.id;
      if (wid === 'shield') mount = 'leftShield';
      if (slot.type === 'leg') model.group.scale.setScalar(0.66);
      if (slot.type === 'shoulder' && def.kind === 'missile') model.group.scale.setScalar(0.76);
      for (const o of addOutline(model.group, 0.022)) o.visible = this.outlines !== false;
      this.mech.attach(mount, model.group);
      this.slots[slot.id] = {
        slot, def, id: wid, model, mount,
        ammo: def.ammo || 0, cool: 0, reloadT: 0,
        loaded: def.missiles || 0, hatch: 0, hatchOpenUntil: 0, lastLaunch: -99, reloadAcc: 0,
        spinSpeed: 0, spinAngle: 0, spinTarget: 0, recoil: 0, muzzleIdx: 0,
        charge: 0, beamT: 0, beam: null,
      };
    }
  }

  get missileCapacity() {
    let n = 0;
    for (const id in this.slots) if (this.slots[id].def.kind === 'missile') n += this.slots[id].def.missiles;
    return n;
  }
  get missilesLoaded() {
    let n = 0;
    for (const id in this.slots) if (this.slots[id].def.kind === 'missile') n += this.slots[id].loaded;
    return n;
  }

  reloadAll() {
    for (const id in this.slots) {
      const s = this.slots[id];
      if (s.def.ammo && s.ammo < s.def.ammo && s.reloadT <= 0 && s.beamT <= 0 && s.charge <= 0) {
        s.reloadT = s.def.reload;
        this.sound.reload();
      }
    }
  }

  // --- input-driven update ------------------------------------------------

  update(dt, ctrl, aim, camera) {
    this.time += dt;
    const T = this.time;

    // Lock-on
    this.lock.update(dt, camera, this.world.targets, this.missileCapacity > 0, Math.min(16, Math.max(4, this.missileCapacity)));

    // Hands
    const handSlots = ['rightHand', 'leftHand'];
    const held = [ctrl.fireR, ctrl.fireL];
    this.shieldUp = false;
    for (let i = 0; i < 2; i++) {
      const s = this.slots[handSlots[i]], H = this.hand[i];
      H.reload = false;
      if (!s) { H.aim = 0; continue; }
      if (s.def.kind === 'shield') { this.shieldUp = held[i]; H.aim = 0; continue; }
      if (held[i]) H.lastUse = T;
      H.aim = T - H.lastUse < 1.4 ? 1 : 0;
      if (s.reloadT > 0) { H.reload = true; H.aim = 0; }
      const ready = this.mech.w.aim[i] > 0.8;
      this.tickWeapon(dt, s, held[i] && ready, aim);
      H.recoil = s.recoil;
    }
    // Shoulder weapons fire with the cannon trigger
    for (const id of ['shoulderL', 'shoulderR']) {
      const s = this.slots[id];
      if (s && s.def.kind !== 'missile') this.tickWeapon(dt, s, ctrl.fireS, aim);
    }

    // Missiles
    if (ctrl.missile) this.fireSingleMissile(aim);
    if (ctrl.salvo) this.fireSalvo(aim);
    for (const id in this.slots) {
      const s = this.slots[id];
      if (s.def.kind !== 'missile') continue;
      const open = T < s.hatchOpenUntil ? 1 : 0;
      s.hatch += (open - s.hatch) * (1 - Math.exp(-dt * 14));
      s.model.hatch.rotation.x = -1.95 * s.hatch;
      // Trickle reload once the pod has been quiet for a moment
      if (s.loaded < s.def.missiles && T - s.lastLaunch > 2.5) {
        s.reloadAcc += dt;
        const per = s.def.reloadTime / s.def.missiles;
        while (s.reloadAcc >= per && s.loaded < s.def.missiles) { s.reloadAcc -= per; s.loaded++; }
      } else s.reloadAcc = 0;
    }
    // Launch queue
    this.queue.sort((a, b) => a.t - b.t);
    while (this.queue.length && this.queue[0].t <= T) {
      const q = this.queue.shift();
      this.launchMissile(q.slot, q.tube, q.target, q.point);
    }

    this.updateProjectiles(dt, aim);
  }

  tickWeapon(dt, s, trigger, aim) {
    const def = s.def;
    s.cool -= dt;
    s.recoil *= Math.exp(-dt * 9);
    if (s.model.spin) {
      if (s.model.spinStep) {
        s.spinAngle += (s.spinTarget - s.spinAngle) * (1 - Math.exp(-dt * 18));
        s.model.spin.rotation.z = s.spinAngle;
      } else {
        s.spinSpeed += ((trigger && s.ammo > 0 && s.reloadT <= 0 ? 32 : 0) - s.spinSpeed) * (1 - Math.exp(-dt * 4));
        s.model.spin.rotation.z += s.spinSpeed * dt;
      }
    }
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) { s.ammo = def.ammo; s.reloadT = 0; }
      return;
    }
    if (def.kind === 'mega') { this.tickMega(dt, s, trigger, aim); return; }
    if (!trigger || s.cool > 0) return;
    if (s.ammo <= 0) { s.reloadT = def.reload; this.sound.reload(); return; }
    this.shoot(s, aim);
    s.ammo--;
    s.cool = def.rate;
    if (s.ammo <= 0) { s.reloadT = def.reload; this.sound.reload(); }
  }

  muzzleRay(s, aim, spread = 0) {
    const muz = s.model.muzzles[s.muzzleIdx++ % s.model.muzzles.length];
    muz.getWorldPosition(_p);
    _d.subVectors(aim.point, _p);
    const fwd = _t.copy(FWD).applyQuaternion(muz.getWorldQuaternion(_q));
    if (_d.lengthSq() < 4 || _d.normalize().dot(fwd) < 0.3) _d.copy(fwd);
    if (spread) _d.x += rand(-spread, spread), _d.y += rand(-spread, spread), _d.z += rand(-spread, spread);
    return { pos: _p.clone(), dir: _d.normalize().clone() };
  }

  shoot(s, aim) {
    const def = s.def;
    switch (def.kind) {
      case 'beam': {
        const { pos, dir } = this.muzzleRay(s, aim);
        this.spawnBolt(pos, dir, def);
        this.fx.muzzle(pos, dir, def.color, 1.1);
        this.sound.beam(pos);
        s.recoil = 1;
        break;
      }
      case 'bullet': {
        const { pos, dir } = this.muzzleRay(s, aim, def.spread);
        this.spawnTracer(pos, dir, def, 0xffc46a, 3.5, 2.5);
        this.fx.muzzle(pos, dir, 0xffa040, 0.55);
        this.sound.gun(pos);
        // brass
        this.fx.sparks.emit(pos.x, pos.y - 0.3, pos.z, rand(-3, 3), rand(3, 6), rand(-3, 3), 0.7, 0.12, 0.1, 1, 0.75, 0.3, 1, 0.6, 0.4, 0.2, 1, 0.5, -30);
        s.recoil = 0.35;
        break;
      }
      case 'pellet': {
        let pos;
        for (let i = 0; i < def.pellets; i++) {
          const r = this.muzzleRay(s, aim, def.spread);
          pos = r.pos;
          this.spawnTracer(r.pos, r.dir, def, 0xffd890, 2.5, 0.55 + Math.random() * 0.2);
        }
        _d.subVectors(aim.point, pos).normalize();
        this.fx.muzzle(pos, _d, 0xffa040, 1.6);
        for (let i = 0; i < 6; i++) this.fx.smoke.emit(pos.x, pos.y, pos.z, _d.x * rand(4, 10), _d.y * rand(4, 10) + 1, _d.z * rand(4, 10), 1.2, 0.8, 3, 0.7, 0.7, 0.7, 0.4, 0.75, 0.75, 0.75, 0, 2.5, 0.5);
        this.sound.shotgun(pos);
        this.onShake(pos, 0.25);
        s.recoil = 1.3;
        break;
      }
      case 'rocket': {
        const { pos, dir } = this.muzzleRay(s, aim);
        this.spawnRocket(pos, dir, def, 'rocket');
        this.fx.muzzle(pos, dir, 0xffa040, 1.5);
        if (s.model.rear) {
          s.model.rear.getWorldPosition(_t);
          for (let i = 0; i < 10; i++) this.fx.smoke.emit(_t.x, _t.y, _t.z, -dir.x * rand(6, 16) + rand(-2, 2), -dir.y * rand(6, 16) + rand(0, 2), -dir.z * rand(6, 16) + rand(-2, 2), rand(1.2, 2), 1, 4, 0.75, 0.72, 0.68, 0.55, 0.8, 0.78, 0.75, 0, 2, 0.5);
        }
        this.sound.rocket(pos);
        this.onShake(pos, 0.35);
        s.recoil = 1.4;
        break;
      }
      case 'grenade': {
        const { pos, dir } = this.muzzleRay(s, aim);
        dir.y += 0.12;
        dir.normalize();
        this.spawnRocket(pos, dir, def, 'grenade');
        this.fx.muzzle(pos, dir, 0xffa040, 0.9);
        this.sound.thump(pos);
        s.spinTarget += s.model.spinStep;
        s.recoil = 0.8;
        break;
      }
    }
  }

  // --- mega beam -------------------------------------------------------------

  tickMega(dt, s, trigger, aim) {
    const def = s.def;
    if (s.beamT > 0) {
      s.beamT -= dt;
      this.updateMegaBeam(dt, s, aim);
      s.recoil = 0.6 + Math.random() * 0.2;
      if (s.beamT <= 0) this.endMega(s);
      return;
    }
    if (s.charge > 0) {
      s.charge += dt;
      const k = s.charge / def.charge;
      s.model.lens.material.opacity = 0.25 + k * 0.75;
      s.model.lens.scale.setScalar(1 + k * 1.5);
      s.model.muzzles[0].getWorldPosition(_p);
      // Particles drawn into the muzzle
      for (let i = 0; i < 3; i++) {
        _t.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 3));
        this.fx.fire.emit(_p.x + _t.x, _p.y + _t.y, _p.z + _t.z, -_t.x * 5, -_t.y * 5, -_t.z * 5, 0.2, 0.35, 0.05, 2, 1.4, 0.5, 1, 1, 0.6, 0.2, 0);
      }
      if (s.charge >= def.charge) {
        s.charge = 0;
        s.beamT = def.duration;
        this.startMega(s);
      }
      return;
    }
    if (!trigger || s.cool > 0) return;
    if (s.ammo <= 0) { s.reloadT = def.reload; this.sound.reload(); return; }
    s.charge = 0.0001;
    s.model.muzzles[0].getWorldPosition(_p);
    this.sound.charge(_p, def.charge);
  }

  startMega(s) {
    const core = new THREE.Mesh(BEAM_GEO, beamMaterial(s.def.color, 1.2));
    const outer = new THREE.Mesh(BEAM_GEO, beamMaterial(s.def.color, 0.0));
    core.renderOrder = outer.renderOrder = 6;
    core.frustumCulled = outer.frustumCulled = false;
    this.scene.add(core, outer);
    s.beam = { core, outer, age: 0 };
    s.model.muzzles[0].getWorldPosition(_p);
    this.fx.flash(_p, 9, s.def.color, 0.25);
    this.fx.light(_p, s.def.color, 80, 0.3, 50);
    this.onShake(_p, 0.6);
    this.megas.push(s);
  }

  updateMegaBeam(dt, s, aim) {
    const b = s.beam, def = s.def;
    b.age += dt;
    const { pos, dir } = this.muzzleRay(s, aim);
    const hit = this.world.raycast(pos, dir, 600);
    const len = hit ? hit.dist : 600;
    const fadeIn = Math.min(1, b.age / 0.08), fadeOut = Math.min(1, s.beamT / 0.25);
    const k = fadeIn * fadeOut;
    _q.setFromUnitVectors(UP, dir);
    const wob = 1 + Math.sin(b.age * 70) * 0.08;
    for (const [m, r] of [[b.core, 1.3], [b.outer, 4.2]]) {
      m.position.copy(pos);
      m.quaternion.copy(_q);
      m.scale.set(1, len, 1);
      m.material.uniforms.uWidth.value = r * k * wob;
      m.material.uniforms.uTime.value = this.time;
      m.material.uniforms.uAlpha.value = k;
    }
    this.sound.setBeam(k);
    if (Math.random() < 0.6) this.fx.light(pos, def.color, 40 * k, 0.06, 30);
    // Spiral sparks along the beam near the muzzle
    for (let i = 0; i < 2; i++) {
      const t = rand(0, Math.min(len, 30));
      _t.copy(pos).addScaledVector(dir, t);
      this.fx.fire.emit(_t.x, _t.y, _t.z, rand(-3, 3), rand(-3, 3), rand(-3, 3), 0.25, 1.2, 0.2, 1.6, 1.0, 0.4, 0.8, 1, 0.4, 0.1, 0);
    }
    if (hit) {
      const p = hit.point;
      for (let i = 0; i < 4; i++) {
        this.fx.fire.emit(p.x, p.y, p.z, rand(-8, 8), rand(2, 12), rand(-8, 8), rand(0.3, 0.6), 2.5, 5, 3, 2, 0.8, 1, 1, 0.2, 0.05, 0, 2, 3);
      }
      if (Math.random() < 0.5) this.fx.smoke.emit(p.x, p.y, p.z, rand(-2, 2), rand(3, 7), rand(-2, 2), rand(2, 3.5), 2, 9, 0.25, 0.24, 0.22, 0.6, 0.45, 0.45, 0.45, 0, 0.8, 0.5);
      if (Math.random() < 0.4) this.fx.sparksBurst(p, hit.normal, 4, 0xffc070, 40);
      if (hit.target) this.world.damage(hit.target, def.dps * dt, p);
      if (hit.normal.y > 0.9 && !hit.target && Math.random() < 0.15) this.fx.scorch(p.x, p.z, rand(3, 5), p.y + 0.03);
      this.fx.light(p, 0xffa040, 60 * k, 0.08, 35);
    }
    this.onShake(pos, 0.08);
  }

  endMega(s) {
    s.beamT = 0;
    if (s.beam) {
      this.scene.remove(s.beam.core, s.beam.outer);
      s.beam.core.material.dispose();
      s.beam.outer.material.dispose();
      s.beam = null;
    }
    s.model.lens.material.opacity = 0.25;
    s.model.lens.scale.setScalar(1);
    this.megas = this.megas.filter((m) => m !== s);
    if (!this.megas.length) this.sound.setBeam(0);
    s.ammo--;
    s.cool = s.def.rate;
    if (s.ammo <= 0) { s.reloadT = s.def.reload; this.sound.reload(); }
  }

  // --- missiles --------------------------------------------------------------

  pods() {
    return Object.values(this.slots).filter((s) => s.def.kind === 'missile');
  }

  fireSingleMissile(aim) {
    const pods = this.pods().filter((s) => s.loaded > 0).sort((a, b) => b.loaded / b.def.missiles - a.loaded / a.def.missiles);
    if (!pods.length) { if (this.pods().length) this.sound.empty(); return; }
    const s = pods[0];
    const locks = this.lock.locks;
    const target = this.hardTarget && this.hardTarget.alive ? this.hardTarget
      : locks.length ? locks[this.missileCycle++ % locks.length].target : null;
    const tubeIndex = s.def.missiles - s.loaded;
    s.loaded--;
    s.lastLaunch = this.time;
    s.hatchOpenUntil = this.time + 0.9;
    if (s.hatch < 0.5) this.sound.hatch(s.model.group.getWorldPosition(_t));
    this.queue.push({ t: this.time + (s.hatch > 0.6 ? 0 : 0.16), slot: s, tube: tubeIndex, target, point: aim.point.clone() });
  }

  fireSalvo(aim) {
    const pods = this.pods().filter((s) => s.loaded > 0);
    if (!pods.length) { if (this.pods().length) this.sound.empty(); return; }
    const locks = this.lock.locks.map((l) => l.target);
    let k = 0;
    pods.forEach((s, pi) => {
      const n = s.loaded;
      const start = s.def.missiles - n;
      this.sound.hatch(s.model.group.getWorldPosition(_t));
      for (let i = 0; i < n; i++) {
        const target = locks.length ? locks[k++ % locks.length] : null;
        const point = aim.point.clone();
        if (!target) point.add(_t.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(6 + n * 0.3));
        this.queue.push({ t: this.time + 0.22 + pi * 0.05 + i * s.def.interval, slot: s, tube: start + i, target, point });
      }
      s.loaded = 0;
      s.lastLaunch = this.time + 0.22 + n * s.def.interval;
      s.hatchOpenUntil = s.lastLaunch + 0.5;
    });
  }

  launchMissile(s, tubeIndex, target, point) {
    const tube = s.model.tubes[tubeIndex % s.model.tubes.length];
    tube.getWorldPosition(_p);
    const dir = _d.copy(FWD).applyQuaternion(tube.getWorldQuaternion(_q)).normalize();
    const A = getMissileAssets();
    let mObj = this.pool.missile.pop();
    if (!mObj) {
      mObj = new THREE.Group();
      const b = new THREE.Mesh(A.body, A.mat);
      const f1 = new THREE.Mesh(A.fins, A.finMat), f2 = new THREE.Mesh(A.fins2, A.finMat);
      b.castShadow = true;
      mObj.add(b, f1, f2);
    }
    const sc = s.def.mscale * (s.slot.type === 'leg' ? 0.8 : 1);
    mObj.scale.setScalar(sc * 1.5);
    mObj.position.copy(_p);
    mObj.visible = true;
    this.scene.add(mObj);
    // Eject with a random scatter so the swarm fans out before homing in
    const vel = dir.clone().multiplyScalar(16 + Math.random() * 6);
    vel.y += 5 + Math.random() * 5;
    vel.x += rand(-7, 7); vel.z += rand(-7, 7);
    this.missiles.push({
      obj: mObj, pos: _p.clone(), prev: _p.clone(), vel, dir: vel.clone().normalize(), speed: vel.length(),
      target, point: point.clone(), age: 0, def: s.def, scale: sc, seed: Math.random() * 100,
      f1: rand(2.5, 5), f2: rand(2.5, 5), ignited: false,
    });
    this.fx.flash(_p, 1.6 * sc, 0xffd8a0, 0.06);
    for (let i = 0; i < 3; i++) this.fx.smoke.emit(_p.x, _p.y, _p.z, dir.x * 3 + rand(-1, 1), dir.y * 3 + rand(0, 2), dir.z * 3 + rand(-1, 1), 1.4, 0.6 * sc, 2.8 * sc, 0.85, 0.85, 0.85, 0.6, 0.85, 0.85, 0.85, 0, 2, 0.4);
    this.sound.missile(_p);
  }

  // --- spawns ------------------------------------------------------------------

  spawnBolt(pos, dir, def) {
    let b = this.pool.bolt.pop();
    if (!b) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(BEAM_GEO, beamMaterial(def.color, 1.2, 0.5));
      const glow = new THREE.Mesh(BEAM_GEO, beamMaterial(def.color, 0.0, 1.8));
      core.frustumCulled = glow.frustumCulled = false;
      core.renderOrder = glow.renderOrder = 6;
      g.add(core, glow);
      b = { obj: g, core, glow };
    }
    for (const m of [b.core, b.glow]) m.material.uniforms.uColor.value.set(def.color);
    b.pos = pos.clone(); b.dir = dir.clone(); b.def = def; b.age = 0; b.len = 0;
    b.obj.quaternion.setFromUnitVectors(UP, dir);
    b.obj.position.copy(pos);
    b.obj.scale.set(1, 0.01, 1);
    this.scene.add(b.obj);
    this.bolts.push(b);
  }

  spawnTracer(pos, dir, def, color, len, life) {
    let t = this.pool.tracer.pop();
    if (!t) {
      const m = new THREE.Mesh(TRACER_GEO, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      m.frustumCulled = false;
      t = { obj: m };
    }
    t.obj.material.color.set(color).multiplyScalar(2.5);
    t.obj.scale.set(0.09, 0.09, len);
    t.pos = pos.clone(); t.dir = dir.clone(); t.def = def; t.age = 0; t.life = life;
    t.obj.position.copy(pos);
    t.obj.quaternion.setFromUnitVectors(FWD, dir);
    this.scene.add(t.obj);
    this.tracers.push(t);
  }

  spawnRocket(pos, dir, def, type) {
    const A = getMissileAssets();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(A.body, A.mat), new THREE.Mesh(A.fins, A.finMat), new THREE.Mesh(A.fins2, A.finMat));
    g.scale.setScalar(type === 'rocket' ? 3.4 : 2.2);
    g.position.copy(pos);
    this.scene.add(g);
    this.rockets.push({ obj: g, pos: pos.clone(), vel: dir.clone().multiplyScalar(def.speed), def, type, age: 0 });
  }

  // --- simulation ----------------------------------------------------------------

  explode(pos, def, scale, normal) {
    this.fx.explosion(pos, scale, { normal });
    this.sound.explosion(pos, scale);
    this.world.damageRadius(pos, def.splash || 4, def.dmg);
  }

  updateProjectiles(dt, aim) {
    const W_ = this.world, fx = this.fx;

    // Beam bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      const step = b.def.speed * dt;
      const hit = W_.raycast(b.pos, b.dir, step);
      b.len = Math.min(9, b.len + step);
      const done = hit || b.age > 1.6;
      if (hit) {
        b.pos.copy(hit.point);
        fx.beamHit(hit.point, hit.normal, b.def.color);
        this.sound.impact(hit.point);
        if (hit.target) W_.damage(hit.target, b.def.dmg, hit.point);
        else if (hit.normal.y > 0.9) fx.scorch(hit.point.x, hit.point.z, 2.2, hit.point.y + 0.03);
      } else b.pos.addScaledVector(b.dir, step);
      if (done) {
        this.scene.remove(b.obj);
        this.pool.bolt.push(b);
        this.bolts.splice(i, 1);
        continue;
      }
      b.obj.position.copy(b.pos).addScaledVector(b.dir, -b.len);
      b.obj.scale.set(1, b.len, 1);
      b.core.material.uniforms.uTime.value = this.time;
      b.glow.material.uniforms.uTime.value = this.time;
    }

    // Tracers (bullets, pellets)
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.age += dt;
      const step = t.def.speed * dt;
      const hit = W_.raycast(t.pos, t.dir, step);
      if (hit) {
        fx.sparksBurst(hit.point, hit.normal, 6, 0xffb060, 25);
        if (Math.random() < 0.4) fx.smoke.emit(hit.point.x, hit.point.y, hit.point.z, rand(-1, 1), rand(1, 3), rand(-1, 1), 1, 0.6, 2.2, 0.55, 0.52, 0.48, 0.5, 0.6, 0.58, 0.55, 0, 1.5, 0.3);
        if (hit.target) W_.damage(hit.target, t.def.dmg, hit.point);
      } else t.pos.addScaledVector(t.dir, step);
      if (hit || t.age > t.life) {
        this.scene.remove(t.obj);
        this.pool.tracer.push(t);
        this.tracers.splice(i, 1);
        continue;
      }
      t.obj.position.copy(t.pos);
    }

    // Rockets and grenades
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      const prev = r.pos.clone();
      if (r.type === 'rocket') {
        const sp = r.vel.length();
        r.vel.multiplyScalar(Math.min(190, sp + 140 * dt) / sp);
        r.vel.y -= 2 * dt;
      } else r.vel.y -= 32 * dt;
      const step = r.vel.length() * dt;
      _d.copy(r.vel).normalize();
      const hit = W_.raycast(r.pos, _d, step + 0.3, { pad: 0.6 });
      r.pos.addScaledVector(r.vel, dt);
      r.obj.position.copy(r.pos);
      r.obj.quaternion.setFromUnitVectors(FWD, _d);
      if (r.type === 'rocket') {
        fx.trail(prev, r.pos, 0.9, 1.4, 2.6, 0.82);
        fx.fire.emit(r.pos.x - _d.x * 1.6, r.pos.y - _d.y * 1.6, r.pos.z - _d.z * 1.6, -_d.x * 8, -_d.y * 8, -_d.z * 8, 0.08, 1.8, 0.6, 3, 2, 0.9, 1, 1, 0.3, 0.1, 0);
      } else if (Math.random() < 0.6) {
        fx.trail(prev, r.pos, 1.5, 0.6, 1.2, 0.7);
      }
      if (hit || r.age > 6) {
        const p = hit ? hit.point : r.pos;
        this.explode(p, r.def, r.type === 'rocket' ? 1.5 : 1.15, hit && hit.normal);
        if (hit && hit.target) W_.damage(hit.target, r.def.dmg * 0.4, p);
        this.scene.remove(r.obj);
        this.rockets.splice(i, 1);
      }
    }

    // Homing missiles
    const right = new V3(), up = new V3();
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      m.prev.copy(m.pos);
      const def = m.def;
      if (m.age < 0.16) {
        m.vel.y -= 9 * dt;
        m.pos.addScaledVector(m.vel, dt);
        m.dir.copy(m.vel).normalize();
      } else {
        if (!m.ignited) {
          m.ignited = true;
          fx.flash(m.pos, 2.2 * m.scale, 0xffe0b0, 0.08);
        }
        const tgt = m.target && m.target.alive ? m.target.pos : m.point;
        _t.subVectors(tgt, m.pos);
        const dist = _t.length();
        // Swirl around the line of flight, fading out on approach (Itano circus)
        right.crossVectors(_t, UP);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        right.normalize();
        up.crossVectors(right, _t).normalize();
        const wob = (def.wobble || 1) * Math.min(1, (m.age - 0.16) * 2) * Math.min(dist * 0.4, 18) * Math.min(1, dist / 30);
        _t.addScaledVector(right, Math.sin(m.age * m.f1 + m.seed) * wob);
        _t.addScaledVector(up, Math.cos(m.age * m.f2 + m.seed * 1.7) * wob * 0.8);
        _t.normalize();
        const turn = Math.min(1, (1.1 + m.age * 3.2) * dt);
        m.dir.lerp(_t, turn).normalize();
        m.speed = Math.min(def.speed * 1.6, m.speed + def.speed * 1.4 * dt);
        m.vel.copy(m.dir).multiplyScalar(m.speed);
        m.pos.addScaledVector(m.vel, dt);
        // smoke and exhaust
        fx.trail(m.prev, m.pos, 0.45 * m.scale + 0.3, 0.6 * m.scale + 0.15, 1.5 + m.scale * 0.6, 0.86, 0.38);
        const tx = m.pos.x - m.dir.x * 0.9 * m.scale, ty = m.pos.y - m.dir.y * 0.9 * m.scale, tz = m.pos.z - m.dir.z * 0.9 * m.scale;
        fx.fire.emit(tx, ty, tz, -m.dir.x * 6, -m.dir.y * 6, -m.dir.z * 6, 0.05, 0.8 * m.scale, 0.2, 2.6, 2.0, 1.1, 1, 1, 0.35, 0.1, 0);
      }
      m.obj.position.copy(m.pos);
      m.obj.quaternion.setFromUnitVectors(FWD, m.dir);
      const step = m.prev.distanceTo(m.pos);
      _d.subVectors(m.pos, m.prev).normalize();
      const hit = m.age > 0.1 ? W_.raycast(m.prev, _d, step + 0.4, { pad: 0.8 }) : null;
      const near = m.target && m.target.alive && m.pos.distanceTo(m.target.pos) < m.target.radius + 1.2;
      if (hit || near || m.age > 7.5) {
        const p = hit ? hit.point : m.pos;
        this.explode(p, def, 0.55 + m.scale * 0.55, hit && hit.normal);
        if (near) W_.damage(m.target, def.dmg * 0.5, p);
        this.scene.remove(m.obj);
        this.pool.missile.push(m.obj);
        this.missiles.splice(i, 1);
      }
    }
  }

  // HUD summary
  status() {
    return SLOTS.map((slot) => {
      const s = this.slots[slot.id];
      if (!s) return { slot, empty: true };
      const def = s.def;
      if (def.kind === 'shield') return { slot, name: def.short, kind: 'shield' };
      if (def.kind === 'missile') return { slot, name: def.short, kind: 'missile', ammo: s.loaded, max: def.missiles };
      return {
        slot, name: def.short, kind: def.kind, ammo: s.ammo, max: def.ammo,
        reload: s.reloadT > 0 ? 1 - s.reloadT / def.reload : null,
        charge: s.charge > 0 ? s.charge / def.charge : s.beamT > 0 ? 1 : null,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Lock-on: targets inside the lock circle get locked one at a time
// ---------------------------------------------------------------------------

export class LockOn {
  constructor(sound) {
    this.sound = sound;
    this.locks = [];
    this.timer = 0;
    this.radius = 0.36; // in NDC-height units
    this.range = 360;
  }

  screen(camera, p, out) {
    out.copy(p).project(camera);
    return out;
  }

  update(dt, camera, targets, enabled, max) {
    if (!enabled) { this.locks.length = 0; return; }
    const aspect = camera.aspect;
    const inZone = (t, grace) => {
      if (!t.alive) return false;
      const d = t.pos.distanceTo(camera.position);
      if (d > this.range) return false;
      const v = this.screen(camera, t.pos, _t);
      if (v.z > 1) return false;
      const r = Math.hypot(v.x * aspect, v.y);
      return r < this.radius * grace ? r : false;
    };
    this.locks = this.locks.filter((l) => {
      const r = inZone(l.target, 1.35);
      if (r === false) { l.lost = (l.lost || 0) + dt; return l.lost < 0.4; }
      l.lost = 0;
      l.age += dt;
      return true;
    });
    this.timer -= dt;
    if (this.timer <= 0 && this.locks.length < max) {
      let best = null, bestR = Infinity;
      for (const t of targets) {
        if (this.locks.some((l) => l.target === t)) continue;
        const r = inZone(t, 1);
        if (r !== false && r < bestR) { best = t; bestR = r; }
      }
      if (best) {
        this.locks.push({ target: best, age: 0 });
        this.timer = 0.09;
        if (this.locks.length >= Math.min(max, targets.filter((t) => t.alive).length)) this.sound.lockFull();
        else this.sound.lock();
      }
    }
  }
}
