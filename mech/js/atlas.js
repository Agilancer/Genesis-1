import * as THREE from './three.js';
import { BODY_SHEET, WEAPON_SHEET } from './regions.js';

export { B, W, BODY_SHEET, WEAPON_SHEET } from './regions.js';

// ---------------------------------------------------------------------------
// Texture loading
// ---------------------------------------------------------------------------

export async function loadTextures(renderer, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress && onProgress(loaded / total);
  const loader = new THREE.TextureLoader(manager);
  const [body, weapons] = await Promise.all([
    loader.loadAsync('textures/body.jpg'),
    loader.loadAsync('textures/weapons.jpg'),
  ]);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of [body, weapons]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  body.userData.sheet = BODY_SHEET;
  weapons.userData.sheet = WEAPON_SHEET;
  return { body, weapons };
}

// ---------------------------------------------------------------------------
// Box-projected atlas UVs
//
// Every triangle is assigned to one of six directions by its face normal and
// gets planar UVs into the region chosen for that direction. Regions are
// center-cropped to the face's aspect ratio so panels never stretch.
//
// faces: { px, nx, py, ny, pz, nz, x, y, z, all } → region arrays
// ---------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const AX = ['x', 'y', 'z'];

function fitRegion(r, faceW, faceH, inset) {
  const rot = r[4] === 1;
  let [x, y, w, h] = r;
  x += inset; y += inset; w -= inset * 2; h -= inset * 2;
  // Effective aspect of the region as it will appear on the face.
  const regionAspect = rot ? h / w : w / h;
  const faceAspect = faceW / Math.max(1e-6, faceH);
  if (faceAspect > regionAspect) {
    // Face is wider: crop the region's "face-vertical" extent.
    if (rot) { const nw = h / faceAspect; x += (w - nw) / 2; w = nw; }
    else { const nh = w / faceAspect; y += (h - nh) / 2; h = nh; }
  } else {
    if (rot) { const nh = w * faceAspect; y += (h - nh) / 2; h = nh; }
    else { const nw = h * faceAspect; x += (w - nw) / 2; w = nw; }
  }
  return [x, y, w, h, rot];
}

export function mapUV(geo, sheet, faces, opts = {}) {
  if (geo.index) geo = geo.toNonIndexed();
  const stretch = !!opts.stretch;
  const inset = opts.inset ?? 1.5;
  geo.computeBoundingBox();
  const mn = geo.boundingBox.min;
  const sz = geo.boundingBox.getSize(new THREE.Vector3());
  sz.x = Math.max(sz.x, 1e-4); sz.y = Math.max(sz.y, 1e-4); sz.z = Math.max(sz.z, 1e-4);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const cache = new Map();
  const verts = [_a, _b, _c];

  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i);
    _b.fromBufferAttribute(pos, i + 1);
    _c.fromBufferAttribute(pos, i + 2);
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    _e1.cross(_e2);
    const ax = Math.abs(_e1.x), ay = Math.abs(_e1.y), az = Math.abs(_e1.z);
    let key, group, ui, vi, flipU = false, flipV = false;
    if (ax >= ay && ax >= az) {
      group = 'x'; key = _e1.x > 0 ? 'px' : 'nx'; ui = 2; vi = 1; flipU = _e1.x > 0;
    } else if (ay >= az) {
      group = 'y'; key = _e1.y > 0 ? 'py' : 'ny'; ui = 0; vi = 2; flipV = _e1.y > 0;
    } else {
      group = 'z'; key = _e1.z > 0 ? 'pz' : 'nz'; ui = 0; vi = 1; flipU = _e1.z < 0;
    }
    const region = faces[key] || faces[group] || faces.all;
    if (!region) continue;
    let fr = cache.get(key);
    if (!fr) {
      const fw = sz[AX[ui]], fh = sz[AX[vi]];
      fr = stretch
        ? [region[0] + inset, region[1] + inset, region[2] - inset * 2, region[3] - inset * 2, region[4] === 1]
        : fitRegion(region, fw, fh, inset);
      cache.set(key, fr);
    }
    const [rx, ry, rw, rh, rot] = fr;
    for (let k = 0; k < 3; k++) {
      const v = verts[k];
      let u = (v.getComponent(ui) - mn.getComponent(ui)) / sz.getComponent(ui);
      let w = (v.getComponent(vi) - mn.getComponent(vi)) / sz.getComponent(vi);
      if (flipU) u = 1 - u;
      if (flipV) w = 1 - w;
      let px, py;
      if (rot) { px = rx + w * rw; py = ry + u * rh; }
      else { px = rx + u * rw; py = ry + (1 - w) * rh; }
      uv[(i + k) * 2] = px / sheet.w;
      uv[(i + k) * 2 + 1] = 1 - py / sheet.h;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

function extrude(pts, depth, bevel = 0.04) {
  const b = Math.max(0, Math.min(bevel, depth * 0.3));
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts), {
    depth: Math.max(0.002, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 1,
    curveSegments: 4,
  });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  return g;
}

/** Profile in the XY plane (front view), extruded along Z. */
export function frontPrism(pts, depth, bevel) {
  return extrude(pts, depth, bevel);
}

/** Profile given as [z, y] pairs (side view), extruded along X. */
export function sidePrism(pts, width, bevel) {
  const g = extrude(pts, width, bevel);
  g.rotateY(-Math.PI / 2);
  return g;
}

/** Profile given as [x, z] pairs (top view), extruded along Y. */
export function topPrism(pts, height, bevel) {
  const g = extrude(pts, height, bevel);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Box with chamfered vertical edges and beveled front/back edges. */
export function chamferBox(w, h, d, c = Math.min(w, h) * 0.18, bevel = 0.035) {
  const x = w / 2, y = h / 2;
  c = Math.min(c, x * 0.9, y * 0.9);
  return frontPrism([
    [-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c],
    [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c],
  ], d, bevel);
}

/** Cylinder whose axis runs along Z. */
export function cylZ(rTop, rBot, len, seg = 16, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Cylinder whose axis runs along X. */
export function cylX(r, len, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}

export function mesh(geo, mat, sheet, faces, opts) {
  if (faces) geo = mapUV(geo, sheet, faces, opts);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Add a mesh to a parent at a position (and optional rotation). */
export function place(parent, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const PAINTS = [
  { id: 'federation', name: 'Federation', armor: '#f3f1ec', second: '#2c4fae', accent: '#ffffff', trim: '#f2b632' },
  { id: 'comet', name: 'Crimson Comet', armor: '#e88f8c', second: '#a51f2a', accent: '#8a1a20', trim: '#f2b632' },
  { id: 'ground', name: 'Ground Type', armor: '#aab48a', second: '#5a6741', accent: '#ffffff', trim: '#d8c49a' },
  { id: 'nightops', name: 'Night Ops', armor: '#5a5d66', second: '#2a2c33', accent: '#ffffff', trim: '#d8322b' },
  { id: 'desert', name: 'Desert Storm', armor: '#dccaa0', second: '#94784c', accent: '#ffffff', trim: '#5b4a33' },
  { id: 'arctic', name: 'Arctic', armor: '#ffffff', second: '#e7822e', accent: '#ffb27a', trim: '#2b2d33' },
];

export const SKINS = [
  { id: 'white', name: 'U.N. White', tint: '#ffffff', stripe: '#d8322b' },
  { id: 'gunmetal', name: 'Gunmetal', tint: '#5a5d64', stripe: '#a7adb6' },
  { id: 'olive', name: 'Olive Drab', tint: '#7f8c5a', stripe: '#d8c49a' },
  { id: 'desert', name: 'Desert', tint: '#dcc79b', stripe: '#8f6a3a' },
  { id: 'navy', name: 'Federation Blue', tint: '#4d72d6', stripe: '#ffffff' },
  { id: 'crimson', name: 'Crimson', tint: '#c73b35', stripe: '#1c1c1c' },
  { id: 'hazard', name: 'Hazard', tint: '#3c3d42', stripe: '#f2b632' },
  { id: 'arctic', name: 'Arctic Orange', tint: '#f6f6f6', stripe: '#ee7a22' },
];

export function makeMaterials(tex) {
  const std = (p) => new THREE.MeshStandardMaterial(p);
  const body = tex.body;
  const m = {
    armor: std({ map: body, bumpMap: body, bumpScale: 2.5, roughness: 0.55, metalness: 0.15 }),
    second: std({ map: body, bumpMap: body, bumpScale: 2.5, roughness: 0.5, metalness: 0.2 }),
    accent: std({ map: body, bumpMap: body, bumpScale: 2.5, roughness: 0.5, metalness: 0.15 }),
    vent: std({ map: body, bumpMap: body, bumpScale: 3, roughness: 0.45, metalness: 0.35 }),
    frame: std({ map: body, bumpMap: body, bumpScale: 3, roughness: 0.42, metalness: 0.6, color: 0xb4b8c0 }),
    joint: std({ color: 0x2a2d33, roughness: 0.38, metalness: 0.8 }),
    trim: std({ color: 0xf2b632, roughness: 0.38, metalness: 0.35 }),
    red: std({ color: 0xc8262a, roughness: 0.45, metalness: 0.2 }),
    nozzle: std({ color: 0x55575c, roughness: 0.3, metalness: 0.9 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x7dffb6, toneMapped: false }),
    sensor: new THREE.MeshBasicMaterial({ color: 0xff3048, toneMapped: false }),
    lens: std({ color: 0x0c1a22, roughness: 0.05, metalness: 0.9, emissive: 0x0a5a7a, emissiveIntensity: 0.6 }),
  };
  m.weapon = new Map();
  m.weaponFor = (skin) => {
    let wm = m.weapon.get(skin.id);
    if (!wm) {
      const w = tex.weapons;
      wm = {
        body: std({ map: w, bumpMap: w, bumpScale: 2, roughness: 0.5, metalness: 0.3, color: new THREE.Color(skin.tint) }),
        raw: std({ map: w, bumpMap: w, bumpScale: 2, roughness: 0.45, metalness: 0.45 }),
        stripe: std({ color: new THREE.Color(skin.stripe), roughness: 0.4, metalness: 0.25 }),
        metal: std({ color: 0x34363c, roughness: 0.35, metalness: 0.85 }),
        bore: std({ color: 0x08090b, roughness: 0.9, metalness: 0.2 }),
      };
      m.weapon.set(skin.id, wm);
    }
    return wm;
  };
  return m;
}

export function applyPaint(mats, paint) {
  mats.armor.color.set(paint.armor);
  mats.second.color.set(paint.second);
  mats.accent.color.set(paint.accent);
  mats.vent.color.set(paint.trim);
  mats.trim.color.set(paint.trim);
}

// ---------------------------------------------------------------------------
// Small procedural canvas textures (particles, decals)
// ---------------------------------------------------------------------------

export function canvasTexture(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTexture() {
  return canvasTexture(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.25)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  }, false);
}

export function smokeTexture() {
  return canvasTexture(128, (g, s) => {
    // A soft puff built from overlapping blobs, so it reads as smoke and not a dot.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * s * 0.2;
      const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
      const rad = s * (0.12 + rnd() * 0.18);
      const r = g.createRadialGradient(x, y, 0, x, y, rad);
      const v = 200 + Math.floor(rnd() * 55);
      r.addColorStop(0, `rgba(${v},${v},${v},0.32)`);
      r.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }
  }, false);
}
