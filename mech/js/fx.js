import * as THREE from './three.js';
import { glowTexture, smokeTexture, canvasTexture } from './atlas.js';

// ---------------------------------------------------------------------------
// GPU-billboarded particle system. One draw call per system; CPU simulation
// writes straight into instanced attribute arrays.
// ---------------------------------------------------------------------------

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec2 iSR;
attribute vec3 iVel;
uniform float uStretch;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = uv;
  vCol = iCol;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 c = position.xy;
  float s = iSR.x;
  if (uStretch > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = vv.xy;
    float L = length(d);
    vec2 ax = L > 1e-4 ? d / L : vec2(1.0, 0.0);
    vec2 ay = vec2(-ax.y, ax.x);
    mv.xy += ax * c.x * (s + L * uStretch) + ay * c.y * s;
  } else {
    float cs = cos(iSR.y), sn = sin(iSR.y);
    mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * s;
  }
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vCol.a;
  if (a < 0.003) discard;
  if (uAdditive > 0.5) gl_FragColor = vec4(vCol.rgb * t.rgb * a, 1.0);
  else gl_FragColor = vec4(vCol.rgb * t.rgb, a);
}`;

// Floats per particle in the simulation buffer.
const STRIDE = 22;
// layout: 0-2 pos, 3-5 vel, 6 life, 7 maxLife, 8 size0, 9 size1,
//         10-13 col0 rgba, 14-17 col1 rgba, 18 rot, 19 spin, 20 drag, 21 grav

export class Particles {
  constructor(scene, { capacity, texture, additive, stretch = 0, fadeIn = 0 }) {
    this.cap = capacity;
    this.count = 0;
    this.fadeIn = fadeIn;
    this.sim = new Float32Array(capacity * STRIDE);
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.aPos, this.aCol, this.aSR, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iSR', this.aSR);
    geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { map: { value: texture }, uStretch: { value: stretch }, uAdditive: { value: additive ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    if (additive) {
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
  }

  // Positional args keep the hot path allocation-free.
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, r1, g1, b1, a1, drag = 0, grav = 0, spin = 0) {
    if (this.count >= this.cap) return;
    const o = this.count++ * STRIDE, d = this.sim;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = 0; d[o + 7] = life;
    d[o + 8] = s0; d[o + 9] = s1;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = r1; d[o + 15] = g1; d[o + 16] = b1; d[o + 17] = a1;
    d[o + 18] = Math.random() * 6.283; d[o + 19] = spin;
    d[o + 20] = drag; d[o + 21] = grav;
  }

  update(dt) {
    const d = this.sim, P = this.aPos.array, C = this.aCol.array, S = this.aSR.array, V = this.aVel.array;
    const fadeIn = this.fadeIn;
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      d[o + 6] += dt;
      if (d[o + 6] >= d[o + 7]) {
        // swap-remove
        const last = --this.count * STRIDE;
        if (last !== o) d.copyWithin(o, last, last + STRIDE);
        continue;
      }
      const t = d[o + 6] / d[o + 7];
      const drag = Math.max(0, 1 - d[o + 20] * dt);
      d[o + 3] *= drag; d[o + 4] = d[o + 4] * drag + d[o + 21] * dt; d[o + 5] *= drag;
      d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
      d[o + 18] += d[o + 19] * dt;
      P[i * 3] = d[o]; P[i * 3 + 1] = d[o + 1]; P[i * 3 + 2] = d[o + 2];
      V[i * 3] = d[o + 3]; V[i * 3 + 1] = d[o + 4]; V[i * 3 + 2] = d[o + 5];
      const it = 1 - t;
      let a = d[o + 13] * it + d[o + 17] * t;
      if (fadeIn > 0 && t < fadeIn) a *= t / fadeIn;
      C[i * 4] = d[o + 10] * it + d[o + 14] * t;
      C[i * 4 + 1] = d[o + 11] * it + d[o + 15] * t;
      C[i * 4 + 2] = d[o + 12] * it + d[o + 16] * t;
      C[i * 4 + 3] = a;
      S[i * 2] = d[o + 8] * it + d[o + 9] * t;
      S[i * 2 + 1] = d[o + 18];
      i++;
    }
    this.geo.instanceCount = this.count;
    for (const a of [this.aPos, this.aCol, this.aSR, this.aVel]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  clear() { this.count = 0; }
}

// ---------------------------------------------------------------------------
// Effects facade
// ---------------------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class FX {
  constructor(scene, { onShake, sound } = {}) {
    this.scene = scene;
    this.onShake = onShake || (() => {});
    this.sound = sound;
    this.time = 0;
    const glow = glowTexture();
    const smoke = smokeTexture();
    this.glowTex = glow;
    this.smoke = new Particles(scene, { capacity: 14000, texture: smoke, additive: false, fadeIn: 0.08 });
    this.fire = new Particles(scene, { capacity: 4000, texture: glow, additive: true });
    this.sparks = new Particles(scene, { capacity: 2500, texture: glow, additive: true, stretch: 0.045 });

    // Point light pool. Fixed count so shaders never recompile.
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 30, 1.6);
      l.userData = { life: 0, max: 1, peak: 0 };
      scene.add(l);
      this.lights.push(l);
    }
    this.lightIdx = 0;

    // Shockwave rings
    const ringTex = canvasTexture(128, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,0)');
      r.addColorStop(0.75, 'rgba(255,255,255,0.9)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    }, false);
    this.ringGeo = new THREE.PlaneGeometry(1, 1);
    this.ringMat = new THREE.MeshBasicMaterial({
      map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      color: 0xffd8a0, toneMapped: false, side: THREE.DoubleSide,
    });
    this.rings = [];

    // Scorch decals on the ground
    const scorchTex = canvasTexture(128, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(10,8,6,0.85)');
      r.addColorStop(0.5, 'rgba(20,16,12,0.55)');
      r.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    });
    this.scorchMat = new THREE.MeshBasicMaterial({
      map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.scorches = [];

    // Flash sprites (big instantaneous glare)
    this.flashMat = new THREE.SpriteMaterial({
      map: glow, color: 0xffe0b0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
    });
    this.flashes = [];

    // Beams (sustained mega-beam and short rifle bolts are handled by weapons.js)
  }

  light(pos, color, intensity, life, range = 40) {
    const l = this.lights[this.lightIdx];
    this.lightIdx = (this.lightIdx + 1) % this.lights.length;
    l.position.copy(pos);
    l.color.set(color);
    l.distance = range;
    l.userData.life = life; l.userData.max = life; l.userData.peak = intensity;
    l.intensity = intensity;
  }

  flash(pos, size, color = 0xffe0b0, life = 0.12) {
    let f = this.flashes.find((s) => !s.visible);
    if (!f) {
      f = new THREE.Sprite(this.flashMat.clone());
      f.renderOrder = 4;
      this.scene.add(f);
      this.flashes.push(f);
    }
    f.visible = true;
    f.position.copy(pos);
    f.material.color.set(color);
    f.userData = { life, max: life, size };
    f.scale.setScalar(size);
  }

  ring(pos, radius, life = 0.6, normal = UP, color = 0xffd8a0) {
    let r = this.rings.find((m) => !m.visible);
    if (!r) {
      r = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
      r.renderOrder = 3;
      this.scene.add(r);
      this.rings.push(r);
    }
    r.visible = true;
    r.position.copy(pos);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    r.material.color.set(color);
    r.userData = { life, max: life, radius };
    r.scale.setScalar(0.01);
  }

  scorch(x, z, size, y = 0.03) {
    let s;
    if (this.scorches.length < 60) {
      s = new THREE.Mesh(this.ringGeo, this.scorchMat.clone());
      s.rotation.x = -Math.PI / 2;
      s.renderOrder = 1;
      this.scene.add(s);
      this.scorches.push(s);
    } else {
      s = this.scorches.shift();
      this.scorches.push(s);
    }
    s.position.set(x, y, z);
    s.rotation.z = Math.random() * 6.28;
    s.scale.setScalar(size);
    s.material.opacity = 1;
    s.userData.age = 0;
  }

  // ---- composite effects --------------------------------------------------

  muzzle(pos, dir, color, scale = 1) {
    const c = new THREE.Color(color);
    this.flash(pos, 2.4 * scale, color, 0.07);
    for (let i = 0; i < 6; i++) {
      const s = rand(4, 14) * scale;
      this.fire.emit(pos.x, pos.y, pos.z,
        dir.x * s + rand(-2, 2), dir.y * s + rand(-2, 2), dir.z * s + rand(-2, 2),
        rand(0.06, 0.14), 0.9 * scale, 0.2 * scale, c.r * 2, c.g * 2, c.b * 2, 1, c.r, c.g, c.b, 0, 4);
    }
    this.light(pos, color, 25 * scale, 0.08, 25);
  }

  sparksBurst(pos, normal, count, color = 0xffc070, speed = 30) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().addScaledVector(normal, 1.2).normalize();
      const s = speed * rand(0.3, 1);
      this.sparks.emit(pos.x, pos.y, pos.z, _v.x * s, _v.y * s, _v.z * s,
        rand(0.25, 0.7), rand(0.1, 0.22), 0.04, c.r * 3, c.g * 3, c.b * 3, 1, c.r, c.g * 0.5, c.b * 0.2, 0.6, 1.5, -30);
    }
  }

  beamHit(pos, normal, color) {
    const c = new THREE.Color(color);
    this.flash(pos, 4, color, 0.12);
    this.sparksBurst(pos, normal, 18, color, 35);
    for (let i = 0; i < 6; i++) {
      this.fire.emit(pos.x, pos.y, pos.z, rand(-4, 4), rand(0, 5), rand(-4, 4), rand(0.15, 0.3),
        1.2, 2.4, c.r * 2, c.g * 2, c.b * 2, 0.9, c.r, c.g, c.b, 0, 3);
    }
    for (let i = 0; i < 3; i++) {
      this.smoke.emit(pos.x, pos.y, pos.z, rand(-1, 1), rand(1, 3), rand(-1, 1), rand(1, 2),
        1, 3.5, 0.5, 0.5, 0.5, 0.35, 0.6, 0.6, 0.6, 0, 1, 0.5, rand(-1, 1));
    }
    this.light(pos, color, 30, 0.15, 25);
  }

  explosion(pos, scale = 1, opts = {}) {
    const s = scale;
    // Explosions on any upward-facing surface (street, sidewalk, rooftop) leave a ring and a scorch
    const flatHit = opts.normal && opts.normal.y > 0.9;
    const ground = flatHit || pos.y < 1.5 * s;
    opts.groundY = flatHit ? pos.y : (opts.groundY ?? 0);
    this.flash(pos, 14 * s, 0xffe6c0, 0.18);
    this.light(pos, 0xff9a40, 120 * s, 0.45, 60 * s);
    // Fireball
    const nFire = Math.round(26 * s) + 6;
    for (let i = 0; i < nFire; i++) {
      _v.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize();
      const sp = rand(3, 14) * s;
      this.fire.emit(pos.x + _v.x * s * 0.6, pos.y + _v.y * s * 0.6, pos.z + _v.z * s * 0.6,
        _v.x * sp, _v.y * sp + 3, _v.z * sp, rand(0.35, 0.8), rand(2, 3.5) * s, rand(4, 7) * s,
        3.2, 2.0, 0.9, 1, 1.0, 0.18, 0.02, 0, 3.5, 2);
    }
    // Hot core
    for (let i = 0; i < 5; i++) {
      this.fire.emit(pos.x, pos.y, pos.z, rand(-2, 2), rand(0, 3), rand(-2, 2), rand(0.15, 0.3),
        5 * s, 9 * s, 4, 3.6, 3, 1, 2, 0.8, 0.2, 0, 2);
    }
    // Smoke column
    const nSmoke = Math.round(18 * s) + 4;
    for (let i = 0; i < nSmoke; i++) {
      _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize();
      const sp = rand(1, 7) * s;
      const g = rand(0.12, 0.22);
      this.smoke.emit(pos.x + _v.x * s, pos.y + _v.y * s, pos.z + _v.z * s,
        _v.x * sp, _v.y * sp + rand(1, 4), _v.z * sp, rand(2.5, 5.5), rand(2.5, 4) * s, rand(8, 13) * s,
        g, g * 0.95, g * 0.9, 0.85, g + 0.25, g + 0.25, g + 0.25, 0, 1.2, 0.6, rand(-0.6, 0.6));
    }
    // Debris sparks
    this.sparksBurst(pos, UP, Math.round(30 * s) + 8, 0xffb060, 45 * Math.sqrt(s));
    // Shockwave
    if (ground) {
      const gy = opts.groundY ?? 0;
      this.ring(_v.set(pos.x, gy + 0.15, pos.z), 18 * s, 0.55, UP);
      this.scorch(pos.x, pos.z, rand(6, 9) * s, gy + 0.03);
      this.dust(pos, 1.6 * s, 14);
    } else {
      this.ring(pos, 14 * s, 0.45, _v.copy(opts.normal || UP));
    }
    this.onShake(pos, 0.9 * s);
  }

  dust(pos, scale = 1, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
      const sp = rand(5, 11) * scale;
      const g = rand(0.42, 0.52);
      this.smoke.emit(pos.x + Math.cos(a) * 0.6, pos.y + 0.4, pos.z + Math.sin(a) * 0.6,
        Math.cos(a) * sp, rand(0.5, 2), Math.sin(a) * sp, rand(1.2, 2.2), 1.2 * scale, 4.5 * scale,
        g, g * 0.94, g * 0.86, 0.55, g, g * 0.95, g * 0.88, 0, 2.6, 0.3, rand(-1, 1));
    }
  }

  // Trail puff along a segment (missiles/rockets)
  trail(from, to, spacing, size, life, shade = 0.8, alpha = 0.42) {
    const dist = from.distanceTo(to);
    const n = Math.min(10, Math.max(1, Math.floor(dist / spacing)));
    for (let i = 0; i < n; i++) {
      const t = (i + Math.random()) / n;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
      const g = shade * rand(0.88, 1);
      this.smoke.emit(x, y, z, rand(-0.5, 0.5), rand(0.3, 1.1), rand(-0.5, 0.5), life * rand(0.75, 1.25),
        size * 0.45, size * rand(2.4, 3.4), g, g, g * 0.98, alpha, g * 0.92, g * 0.92, g * 0.92, 0, 0.9, 0.35, rand(-0.8, 0.8));
    }
  }

  update(dt) {
    this.time += dt;
    this.smoke.update(dt);
    this.fire.update(dt);
    this.sparks.update(dt);
    for (const l of this.lights) {
      if (l.userData.life > 0) {
        l.userData.life -= dt;
        const k = Math.max(0, l.userData.life / l.userData.max);
        l.intensity = l.userData.peak * k * k;
      } else l.intensity = 0;
    }
    for (const f of this.flashes) {
      if (!f.visible) continue;
      f.userData.life -= dt;
      if (f.userData.life <= 0) { f.visible = false; continue; }
      const k = f.userData.life / f.userData.max;
      f.material.opacity = k;
      f.scale.setScalar(f.userData.size * (1.3 - 0.3 * k));
    }
    for (const r of this.rings) {
      if (!r.visible) continue;
      r.userData.life -= dt;
      if (r.userData.life <= 0) { r.visible = false; continue; }
      const t = 1 - r.userData.life / r.userData.max;
      const e = 1 - Math.pow(1 - t, 3);
      r.scale.setScalar(Math.max(0.01, r.userData.radius * 2 * e));
      r.material.opacity = (1 - t) * 0.9;
    }
    for (const s of this.scorches) {
      s.userData.age += dt;
      if (s.userData.age > 25) s.material.opacity = Math.max(0, 1 - (s.userData.age - 25) / 10);
    }
  }
}

