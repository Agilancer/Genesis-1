import * as THREE from './three.js';
import { BODY_SHEET, WEAPON_SHEET } from './regions.js';
import { PIECES } from './pieces.js';
import { ATLASES } from './cityTiles.js';

export { B, W, BODY_SHEET, WEAPON_SHEET } from './regions.js';

// ---------------------------------------------------------------------------
// Texture loading
// ---------------------------------------------------------------------------

export async function loadTextures(renderer, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress && onProgress(loaded / total);
  const loader = new THREE.TextureLoader(manager);
  const cityKeys = Object.keys(ATLASES);
  const [body, weapons, ...cityList] = await Promise.all([
    loader.loadAsync('textures/body.jpg'),
    loader.loadAsync('textures/weapons.jpg'),
    ...cityKeys.map((k) => loader.loadAsync(ATLASES[k].url)),
  ]);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of [body, weapons, ...cityList]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  body.userData.sheet = BODY_SHEET;
  weapons.userData.sheet = WEAPON_SHEET;
  const city = {};
  cityKeys.forEach((k, i) => { city[k] = cityList[i]; });
  return { body, weapons, city };
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

/**
 * Tapered armor block lofted along Y through octagonal sections.
 * secs: [{ y, w, d, c?, x?, z? }] from top to bottom (any order works).
 * Each section is a w×d rectangle with corners chamfered by c, offset by x/z.
 */
export function loft(secs) {
  const ring = (s) => {
    const hw = s.w / 2, hd = s.d / 2, c = Math.min(s.c ?? Math.min(s.w, s.d) * 0.2, hw * 0.95, hd * 0.95);
    const x = s.x || 0, z = s.z || 0;
    return [
      [hw - c, hd], [hw, hd - c], [hw, -hd + c], [hw - c, -hd],
      [-hw + c, -hd], [-hw, -hd + c], [-hw, hd - c], [-hw + c, hd],
    ].map(([px, pz]) => new THREE.Vector3(px + x, s.y, pz + z));
  };
  const rings = secs.map(ring);
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  // Orient so faces point outward regardless of section order
  const down = secs[0].y > secs[secs.length - 1].y;
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], Bn = rings[r + 1];
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      if (down) { tri(A[i], Bn[i], Bn[j]); tri(A[i], Bn[j], A[j]); }
      else { tri(A[i], A[j], Bn[j]); tri(A[i], Bn[j], Bn[i]); }
    }
  }
  const capTop = down ? rings[0] : rings[rings.length - 1];
  const capBot = down ? rings[rings.length - 1] : rings[0];
  for (let i = 1; i < 7; i++) {
    tri(capTop[0], capTop[i], capTop[i + 1]);
    tri(capBot[0], capBot[i + 1], capBot[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A plate cut to the outline of one of the armor pieces on the body sheet, with
 * that piece's art mapped 1:1 onto its face. The plate is centered, faces +Z,
 * and is `width` units wide; its height follows the piece's proportions.
 */
const _pieceCache = new Map();
export function pieceGeo(name, width, depth = 0.06) {
  const key = `${name}|${width}|${depth}`;
  if (_pieceCache.has(key)) return _pieceCache.get(key);
  const poly = PIECES[name];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, k = width / (maxX - minX);
  const shape = shapeFrom(poly.map(([x, y]) => [(x - cx) * k, -(y - cy) * k]));
  const S = BODY_SHEET;
  const uv = (x, y) => new THREE.Vector2(((x / k) + cx) / S.w, 1 - ((-y / k) + cy) / S.h);
  // Edges take a flat steel tone from a plain gray panel on the sheet
  const edge = new THREE.Vector2(1018 / S.w, 1 - 1219 / S.h);
  const b = Math.min(0.025, depth * 0.3);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1,
    UVGenerator: {
      generateTopUV(_g, v, a, bb, c) { return [uv(v[a * 3], v[a * 3 + 1]), uv(v[bb * 3], v[bb * 3 + 1]), uv(v[c * 3], v[c * 3 + 1])]; },
      generateSideWallUV() { return [edge, edge, edge, edge]; },
    },
  });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  g.userData.height = (maxY - minY) * k;
  _pieceCache.set(key, g);
  return g;
}

/**
 * Ink outlines: an inflated back-face shell behind every opaque armor mesh,
 * for a drawn, anime-style silhouette. Returns the outline meshes.
 */
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0b0d12, side: THREE.BackSide });
export function addOutline(root, t = 0.026) {
  const targets = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || o.userData.noOutline) return;
    const m = o.material;
    if (!m || !m.isMeshStandardMaterial || m.side !== THREE.FrontSide || m.transparent) return;
    targets.push(o);
  });
  const out = [];
  const size = new THREE.Vector3(), c = new THREE.Vector3();
  for (const m of targets) {
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    g.boundingBox.getSize(size);
    g.boundingBox.getCenter(c);
    const o = new THREE.Mesh(g, outlineMat);
    const sx = 1 + (2 * t) / Math.max(size.x, 0.03), sy = 1 + (2 * t) / Math.max(size.y, 0.03), sz = 1 + (2 * t) / Math.max(size.z, 0.03);
    o.scale.set(sx, sy, sz);
    o.position.set(c.x * (1 - sx), c.y * (1 - sy), c.z * (1 - sz));
    o.userData.isOutline = true;
    o.raycast = () => {};
    m.add(o);
    out.push(o);
  }
  return out;
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
  { id: 'lynx', name: 'Lynx Navy', armor: '#3f5888', second: '#463e37', frame: '#6a645c', trim: '#d39a45', eye: '#8ff0ff' },
  { id: 'unsung', name: 'Unsung Black', armor: '#454c5c', second: '#2a2c32', frame: '#55585f', trim: '#c08455', eye: '#ff4a3a' },
  { id: 'steel', name: 'Shrieker Steel', armor: '#a4a9b0', second: '#4a4d54', frame: '#62666d', trim: '#e2e4e8', eye: '#ffd27a' },
  { id: 'glint', name: 'Glint White', armor: '#f2f3f5', second: '#5a6680', frame: '#7d8594', trim: '#4fa8ff', eye: '#7fd8ff' },
  { id: 'desert', name: 'Desert Ops', armor: '#c2ad85', second: '#51473b', frame: '#6a6156', trim: '#e2782c', eye: '#9dff8a' },
  { id: 'crimson', name: 'Crimson', armor: '#9a3633', second: '#322d2c', frame: '#56504c', trim: '#d39a45', eye: '#ffe08a' },
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
  { id: 'bronze', name: 'Bronze', tint: '#b4823f', stripe: '#1f1f22' },
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
    trim: std({ color: 0xd39a45, roughness: 0.32, metalness: 0.75 }),
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
  mats.accent.color.set(paint.armor);
  mats.frame.color.set(paint.frame);
  mats.vent.color.set(paint.trim);
  mats.trim.color.set(paint.trim);
  mats.eye.color.set(paint.eye);
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
