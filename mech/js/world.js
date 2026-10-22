import * as THREE from './three.js';
import { chamferBox, mesh, canvasTexture } from './atlas.js';
import { City } from './city.js';

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const _v = new V3();
const _n = new V3();

export const SUN_DIR = new V3(-0.5, 0.66, 0.42).normalize();

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#3a6aa8') },
      uHorizon: { value: new THREE.Color('#d9dde0') },
      uGround: { value: new THREE.Color('#8f9aa2') },
      uSunDir: { value: SUN_DIR.clone() },
      uSun: { value: new THREE.Color('#fff1d6') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.9999, p.w);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uGround, uSunDir, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.5));
        col = mix(col, uGround, smoothstep(0.0, -0.08, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 900.0) * 14.0 + pow(s, 40.0) * 0.5 + pow(s, 6.0) * 0.16);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  sky.scale.setScalar(6000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

/** The old test-site pad marking, now painted on the plaza where the mech starts */
function padTexture() {
  return canvasTexture(1024, (g, s) => {
    const c = s / 2;
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(242,182,50,0.9)';
    g.lineWidth = 26;
    g.beginPath(); g.arc(c, c, s * 0.44, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 8;
    g.beginPath(); g.arc(c, c, s * 0.38, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(30,30,30,0.85)';
    for (let i = 0; i < 24; i++) {
      g.save(); g.translate(c, c); g.rotate((i / 24) * Math.PI * 2);
      g.fillRect(s * 0.428, -10, 30, 20);
      g.restore();
    }
    g.fillStyle = 'rgba(240,236,228,0.85)';
    g.font = 'bold 300px "Chakra Petch", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('07', c, c - 20);
    g.font = 'bold 54px "Chakra Petch", sans-serif';
    g.fillText('MS TEST SITE', c, c + 170);
    g.fillStyle = 'rgba(216,50,43,0.85)';
    g.beginPath(); g.moveTo(c - 40, c - 230); g.lineTo(c + 40, c - 230); g.lineTo(c, c - 180); g.fill();
  });
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

let droneGeo;
function buildDrone(mats) {
  const g = new THREE.Group();
  if (!droneGeo) {
    droneGeo = {
      body: new THREE.SphereGeometry(1.1, 20, 14),
      ring: new THREE.TorusGeometry(1.55, 0.16, 8, 28),
      eye: new THREE.SphereGeometry(0.34, 12, 8),
      pod: new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10),
    };
  }
  const shell = new THREE.MeshStandardMaterial({ color: 0x8f949c, roughness: 0.35, metalness: 0.7, emissive: 0x000000 });
  const body = new THREE.Mesh(droneGeo.body, shell);
  body.castShadow = true;
  g.add(body);
  const ring = new THREE.Mesh(droneGeo.ring, mats.hazard);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  g.add(ring);
  const eye = new THREE.Mesh(droneGeo.eye, mats.redGlow);
  eye.position.z = 0.95;
  g.add(eye);
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(droneGeo.pod, shell);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 1.55, 0, 0);
    g.add(pod);
  }
  return { group: g, flashMats: [shell], radius: 1.9 };
}

function buildBoard(mats) {
  const g = new THREE.Group();
  const boardMat = mats.board.clone();
  const board = mesh(chamferBox(4.2, 4.2, 0.35, 0.5), boardMat);
  board.position.y = 5.2;
  g.add(board);
  const back = new THREE.MeshStandardMaterial({ color: 0x5c5f66, roughness: 0.5, metalness: 0.6, emissive: 0x000000 });
  for (const s of [-1, 1]) {
    const leg = mesh(new THREE.BoxGeometry(0.3, 5.2, 0.3), back);
    leg.position.set(s * 1.4, 2.6, -0.25);
    g.add(leg);
  }
  const base = mesh(chamferBox(4.4, 0.6, 1.8, 0.2), back);
  base.position.set(0, 0.3, -0.2);
  g.add(base);
  return { group: g, flashMats: [back, boardMat], radius: 2.8, center: new V3(0, 5.2, 0) };
}

class Target {
  constructor(world, type) {
    this.world = world;
    this.type = type;
    const built = type === 'drone' ? buildDrone(world.tmats) : buildBoard(world.tmats);
    this.group = built.group;
    this.radius = built.radius;
    this.flashMats = built.flashMats;
    this.offset = built.center || new V3();
    this.maxHp = type === 'drone' ? 45 : 70;
    this.hp = this.maxHp;
    this.alive = true;
    this.flash = 0;
    this.pos = new V3();
    this.vel = new V3();
    this._prev = new V3();
    this.t = Math.random() * 100;
    world.scene.add(this.group);
  }

  /** Drones patrol a stretch of open street between the towers */
  patrol(a, b, height) {
    this.a = a.clone(); this.b = b.clone();
    this.len = a.distanceTo(b);
    this.s = Math.random() * this.len;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.speed = rand(5, 11);
    this.height = height;
    this.update(0);
  }

  place(pos, face) {
    this.group.position.copy(pos);
    this.group.rotation.y = face;
    this.update(0);
  }

  update(dt) {
    this.t += dt;
    if (this.type === 'drone') {
      this.s += this.dir * this.speed * dt;
      if (this.s > this.len) { this.s = this.len; this.dir = -1; }
      if (this.s < 0) { this.s = 0; this.dir = 1; }
      const f = this.s / this.len;
      const sway = Math.sin(this.t * 0.7) * 3;
      _v.subVectors(this.b, this.a).normalize();
      this.group.position.set(
        this.a.x + (this.b.x - this.a.x) * f - _v.z * sway,
        this.height + Math.sin(this.t * 1.3) * 1.2,
        this.a.z + (this.b.z - this.a.z) * f + _v.x * sway,
      );
      this.group.rotation.y = Math.atan2(_v.x * this.dir, _v.z * this.dir);
      this.group.children[1].rotation.z += dt * 2;
    }
    this._prev.copy(this.pos);
    this.pos.copy(this.offset).applyQuaternion(this.group.quaternion).add(this.group.position);
    if (dt > 0) this.vel.subVectors(this.pos, this._prev).divideScalar(dt);
    else this.vel.set(0, 0, 0);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      for (const m of this.flashMats) m.emissive.setScalar(this.flash * 0.9);
    }
  }
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
  /** M: game units per meter, chosen so the mech is 40 ft tall */
  constructor(scene, mats, fx, sound, { M, cityTex }, callbacks = {}) {
    this.scene = scene;
    this.mats = mats;
    this.fx = fx;
    this.sound = sound;
    this.cb = callbacks;
    this.M = M;
    this.targets = [];
    this.respawns = [];

    scene.add(makeSky());
    scene.fog = new THREE.Fog(0xc4ccd2, 260, 2600);

    // Lights
    const hemi = new THREE.HemisphereLight(0xd6e2f0, 0x7d8088, 1.0);
    scene.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0dc, 3.1));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 1100;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);

    // The city
    this.city = new City({ scene, tex: cityTex, M, fx, sound });
    this.colliders = this.city.colliders;
    this.bounds = this.city.bounds;
    this.spawn = this.city.spawn;
    this.buildGrid();
    this.city.query = (x0, z0, x1, z1, fn) => this.query(x0, z0, x1, z1, fn);

    // Test-site pad marking on the starting plaza
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({
      map: padTexture(), transparent: true, roughness: 0.8, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.spawn.x, this.spawn.y + 0.05, this.spawn.z);
    pad.receiveShadow = true;
    pad.renderOrder = 2;
    scene.add(pad);

    // Target materials
    const boardTex = canvasTexture(256, (g, s) => {
      g.fillStyle = '#efe9dc'; g.fillRect(0, 0, s, s);
      const rings = ['#d8322b', '#efe9dc', '#d8322b', '#efe9dc', '#1f1f22'];
      rings.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(s / 2, s / 2, s * 0.45 * (1 - i * 0.19), 0, Math.PI * 2); g.fill(); });
      g.strokeStyle = '#1f1f22'; g.lineWidth = 6; g.strokeRect(3, 3, s - 6, s - 6);
    });
    this.tmats = {
      board: new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.7, emissive: 0x000000 }),
      hazard: new THREE.MeshStandardMaterial({ color: 0xf2b632, roughness: 0.5, metalness: 0.3 }),
      redGlow: new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }),
    };

    this.spawnTargets();
  }

  // ---- spatial grid ------------------------------------------------------------

  buildGrid() {
    const C = (this.cell = 24);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const c of this.colliders) { x0 = Math.min(x0, c.min.x); z0 = Math.min(z0, c.min.z); x1 = Math.max(x1, c.max.x); z1 = Math.max(z1, c.max.z); }
    this.gx0 = x0 - C; this.gz0 = z0 - C;
    this.gw = Math.ceil((x1 - x0) / C) + 3; this.gh = Math.ceil((z1 - z0) / C) + 3;
    this.grid = Array.from({ length: this.gw * this.gh }, () => []);
    this.stamp = 0;
    for (const c of this.colliders) {
      c.stamp = 0;
      const [a, b, e, f] = this.cellRange(c.min.x, c.min.z, c.max.x, c.max.z);
      for (let j = b; j <= f; j++) for (let i = a; i <= e; i++) this.grid[j * this.gw + i].push(c);
    }
  }

  cellRange(x0, z0, x1, z1) {
    const C = this.cell, cl = (v, n) => Math.max(0, Math.min(n - 1, v));
    return [cl(Math.floor((x0 - this.gx0) / C), this.gw), cl(Math.floor((z0 - this.gz0) / C), this.gh),
      cl(Math.floor((x1 - this.gx0) / C), this.gw), cl(Math.floor((z1 - this.gz0) / C), this.gh)];
  }

  /** Visit each collider overlapping an XZ rectangle once */
  query(x0, z0, x1, z1, fn) {
    const st = ++this.stamp;
    const [a, b, e, f] = this.cellRange(x0, z0, x1, z1);
    for (let j = b; j <= f; j++) {
      for (let i = a; i <= e; i++) {
        for (const c of this.grid[j * this.gw + i]) {
          if (c.stamp === st) continue;
          c.stamp = st;
          if (c.max.x < x0 || c.min.x > x1 || c.max.z < z0 || c.min.z > z1) continue;
          fn(c);
        }
      }
    }
  }

  // ---- targets -------------------------------------------------------------------

  spawnTargets() {
    for (let i = 0; i < 12; i++) {
      const t = new Target(this, 'drone');
      this.placeTarget(t, this.spawn, true);
      this.targets.push(t);
    }
    for (let i = 0; i < 12; i++) {
      const t = new Target(this, 'board');
      this.placeTarget(t, this.spawn, true);
      this.targets.push(t);
    }
  }

  placeTarget(t, around, first) {
    const city = this.city;
    if (t.type === 'drone') {
      // A stretch of street or avenue near the player, high enough to clear the traffic lights
      const lanes = city.lanes.filter((l) => {
        const d = _v.copy(around).sub(l.a).projectOnVector(_n.subVectors(l.b, l.a)).add(l.a).distanceTo(around);
        return d < 260;
      });
      const l = lanes.length ? lanes[Math.floor(Math.random() * lanes.length)] : city.lanes[0];
      const span = rand(60, 160), dir = _n.subVectors(l.b, l.a).normalize();
      const along = Math.max(0, Math.min(l.a.distanceTo(l.b) - span, _v.copy(around).sub(l.a).dot(dir) + rand(-140, 60)));
      const a = l.a.clone().addScaledVector(dir, along), b = a.clone().addScaledVector(dir, span);
      t.patrol(a, b, rand(11, 46));
    } else {
      const used = this.targets.filter((o) => o !== t && o.type === 'board').map((o) => o.group.position);
      const spots = city.spots.filter((s) => {
        const d = s.pos.distanceTo(around);
        return d > (first ? 20 : 45) && d < 300 && !used.some((p) => p.distanceTo(s.pos) < 6);
      });
      const s = spots.length ? spots[Math.floor(Math.random() * spots.length)] : city.spots[0];
      t.place(s.pos, Math.atan2(around.x - s.pos.x, around.z - s.pos.z));
    }
  }

  // ---- queries -------------------------------------------------------------------

  /** Height of the surface the mech can stand on at (x, z), given its current feet height y. */
  groundHeight(x, z, y, r = 1.0) {
    let h = 0;
    this.query(x - r, z - r, x + r, z + r, (c) => {
      if (c.walk) return;
      if (y >= c.max.y - 0.7) h = Math.max(h, c.max.y);
    });
    return h;
  }

  /** Push a vertical cylinder (feet at pos.y, given height) out of colliders in XZ. */
  resolve(pos, r, height) {
    let hit = false;
    this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (c) => {
      if (c.walk || pos.y >= c.max.y - 0.7 || pos.y + height <= c.min.y) return;
      const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          const ox = Math.min(pos.x - c.min.x, c.max.x - pos.x), oz = Math.min(pos.z - c.min.z, c.max.z - pos.z);
          if (ox < oz) pos.x = pos.x - c.min.x < c.max.x - pos.x ? c.min.x - r : c.max.x + r;
          else pos.z = pos.z - c.min.z < c.max.z - pos.z ? c.min.z - r : c.max.z + r;
        }
      }
    });
    const B = this.bounds;
    if (pos.x < B.minX) { pos.x = B.minX; hit = true; }
    if (pos.x > B.maxX) { pos.x = B.maxX; hit = true; }
    if (pos.z < B.minZ) { pos.z = B.minZ; hit = true; }
    if (pos.z > B.maxZ) { pos.z = B.maxZ; hit = true; }
    return hit;
  }

  /**
   * Ray against targets (spheres), colliders (AABBs, walked through a grid with a
   * 2D DDA) and the ground or water. Returns { dist, point, normal, target } or null.
   */
  raycast(o, d, maxDist, { targets = true, pad = 0 } = {}) {
    let best = maxDist, normal = null, target = null;
    if (targets) {
      for (const t of this.targets) {
        if (!t.alive) continue;
        const r = t.radius + pad;
        const ox = o.x - t.pos.x, oy = o.y - t.pos.y, oz = o.z - t.pos.z;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const c = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - c;
        if (disc < 0) continue;
        let tt = -b - Math.sqrt(disc);
        if (tt < 0) tt = c < 0 ? 0 : -1;
        if (tt >= 0 && tt < best) {
          best = tt; target = t;
          normal = _n.set(o.x + d.x * tt - t.pos.x, o.y + d.y * tt - t.pos.y, o.z + d.z * tt - t.pos.z).normalize().clone();
        }
      }
    }
    // Grid traversal
    const C = this.cell, st = ++this.stamp;
    let i = Math.floor((o.x - this.gx0) / C), j = Math.floor((o.z - this.gz0) / C);
    const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(d.x) > 1e-9 ? C / Math.abs(d.x) : Infinity, tdz = Math.abs(d.z) > 1e-9 ? C / Math.abs(d.z) : Infinity;
    let tmx = Math.abs(d.x) > 1e-9 ? ((this.gx0 + (i + (sx > 0 ? 1 : 0)) * C) - o.x) / d.x : Infinity;
    let tmz = Math.abs(d.z) > 1e-9 ? ((this.gz0 + (j + (sz > 0 ? 1 : 0)) * C) - o.z) / d.z : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 4000; guard++) {
      if (i >= 0 && j >= 0 && i < this.gw && j < this.gh) {
        for (const c of this.grid[j * this.gw + i]) {
          if (c.stamp === st) continue;
          c.stamp = st;
          const hit = this.rayBox(o, d, c, best);
          if (hit) {
            best = hit.t;
            target = c.ref && c.ref.alive ? c.ref : null;
            normal = hit.n;
          }
        }
      } else if ((sx > 0 && i >= this.gw) || (sx < 0 && i < 0) || (sz > 0 && j >= this.gh) || (sz < 0 && j < 0)) break;
      tCell = Math.min(tmx, tmz);
      if (tCell > best) break;
      if (tmx < tmz) { tmx += tdx; i += sx; } else { tmz += tdz; j += sz; }
    }
    // Ground inside the city, water outside it
    if (d.y < -1e-6) {
      const B = this.bounds;
      let tg = -o.y / d.y;
      const px = o.x + d.x * tg, pz = o.z + d.z * tg;
      if (px < B.minX - 30 || px > B.maxX + 30 || pz > B.maxZ + 30) tg = (this.city.L.water - o.y) / d.y;
      if (tg >= 0 && tg < best) { best = tg; target = null; normal = new V3(0, 1, 0); }
    }
    if (!normal) return null;
    return { dist: best, point: new V3().copy(o).addScaledVector(d, best), normal, target };
  }

  rayBox(o, d, c, best) {
    let tmin = 0, tmax = best, axis = -1, sign = 0;
    for (let a = 0; a < 3; a++) {
      const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const mn = a === 0 ? c.min.x : a === 1 ? c.min.y : c.min.z;
      const mx = a === 0 ? c.max.x : a === 1 ? c.max.y : c.max.z;
      if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) return null; continue; }
      let t1 = (mn - oa) / da, t2 = (mx - oa) / da, s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (axis < 0 || tmin >= best) return null;
    const n = new V3(); n.setComponent(axis, sign);
    return { t: tmin, n };
  }

  damage(t, amount, point) {
    if (!t || !t.alive) return false;
    if (t.kind === 'car') return this.city.damageCar(t, amount, point);
    t.hp -= amount;
    t.flash = 1;
    this.cb.onHit && this.cb.onHit(t, point);
    if (t.hp <= 0) {
      t.alive = false;
      t.group.visible = false;
      this.fx.explosion(t.pos, t.type === 'drone' ? 1.3 : 1.6);
      this.sound.explosion(t.pos, 1.4);
      this.respawns.push({ t, time: rand(6, 10) });
      this.cb.onKill && this.cb.onKill(t);
      return true;
    }
    return false;
  }

  damageRadius(point, radius, amount) {
    for (const t of this.targets) {
      if (!t.alive) continue;
      const d = t.pos.distanceTo(point) - t.radius;
      if (d < radius) this.damage(t, amount * (1 - Math.max(0, d) / radius) * 0.85 + amount * 0.15, t.pos);
    }
    if (point.y > 6) return;
    this.query(point.x - radius, point.z - radius, point.x + radius, point.z + radius, (c) => {
      if (!c.ref || !c.ref.alive) return;
      const d = Math.max(0, c.ref.pos.distanceTo(point) - 2);
      if (d < radius) this.city.damageCar(c.ref, amount * (1 - d / radius) + 8, point);
    });
  }

  update(dt, player, ctx) {
    for (const t of this.targets) if (t.alive) t.update(dt);
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      r.time -= dt;
      if (r.time <= 0) {
        this.respawns.splice(i, 1);
        const t = r.t;
        t.hp = t.maxHp;
        t.alive = true;
        t.group.visible = true;
        this.placeTarget(t, player, false);
        this.fx.flash(t.pos, 6, 0x9fd0ff, 0.3);
      }
    }
    this.city.update(dt, Object.assign({ player }, ctx));
    // Keep the shadow frustum centered on the player, far enough back to catch the tall towers
    this.sun.position.copy(player).addScaledVector(SUN_DIR, 700);
    this.sun.target.position.copy(player);
  }
}
