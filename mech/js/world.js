import * as THREE from './three.js';
import { B, BODY_SHEET, chamferBox, frontPrism, mesh, canvasTexture } from './atlas.js';

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const _v = new V3();
const _n = new V3();

export const SUN_DIR = new V3(-0.55, 0.62, -0.45).normalize();
export const ARENA_RADIUS = 420;

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
      uTop: { value: new THREE.Color('#2f62a8') },
      uHorizon: { value: new THREE.Color('#e9d6b6') },
      uGround: { value: new THREE.Color('#b7a58a') },
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
        vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
        col = mix(col, uGround, smoothstep(0.0, -0.08, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 900.0) * 14.0 + pow(s, 40.0) * 0.5 + pow(s, 6.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  sky.scale.setScalar(3000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

function concreteTexture() {
  const t = canvasTexture(1024, (g, s) => {
    g.fillStyle = '#a39883';
    g.fillRect(0, 0, s, s);
    const img = g.getImageData(0, 0, s, s), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 22;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    // stains
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = rand(10, 90);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = Math.random() < 0.7;
      gr.addColorStop(0, dark ? 'rgba(60,52,40,0.18)' : 'rgba(220,210,190,0.14)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // slab seams (4×4 slabs)
    const n = 4, step = s / n;
    for (let i = 0; i <= n; i++) {
      for (const [w, a] of [[6, 0.25], [2, 0.55]]) {
        g.strokeStyle = `rgba(40,34,26,${a})`;
        g.lineWidth = w;
        g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, s); g.stroke();
        g.beginPath(); g.moveTo(0, i * step); g.lineTo(s, i * step); g.stroke();
      }
    }
    // tie-down studs at slab corners
    g.fillStyle = 'rgba(50,45,38,0.6)';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.beginPath(); g.arc(i * step + step / 2, j * step + step / 2, 5, 0, Math.PI * 2); g.fill();
    }
    // cracks
    g.strokeStyle = 'rgba(40,34,26,0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) {
      let x = Math.random() * s, y = Math.random() * s;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += rand(-30, 30); y += rand(-30, 30); g.lineTo(x, y); }
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function padTexture() {
  return canvasTexture(1024, (g, s) => {
    const c = s / 2;
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(242,182,50,0.9)';
    g.lineWidth = 26;
    g.beginPath(); g.arc(c, c, s * 0.44, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 8;
    g.beginPath(); g.arc(c, c, s * 0.38, 0, Math.PI * 2); g.stroke();
    // chevrons on the ring
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

function groundMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0, color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGW;
        float gh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
        float gfbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * gn(p); p *= 2.03; a *= 0.5; } return s; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float big = gfbm(vGW.xz * 0.006);
        float mid = gfbm(vGW.xz * 0.04 + 7.0);
        vec3 sand = vec3(0.78, 0.66, 0.48);
        float dist = length(vGW.xz);
        float sandMix = smoothstep(0.45, 0.75, big) * 0.65 + smoothstep(260.0, 520.0, dist) * 0.8;
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.82 + 0.3 * mid), sand * (0.85 + 0.3 * mid), clamp(sandMix, 0.0, 1.0));`);
  };
  return mat;
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
  constructor(world, type, pos) {
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
    this.anchor = pos.clone();
    this.t = Math.random() * 100;
    this.orbit = rand(10, 26);
    this.orbitSpeed = rand(0.12, 0.3) * (Math.random() < 0.5 ? -1 : 1);
    this.height = rand(9, 26);
    if (type === 'board') {
      this.group.rotation.y = rand(-Math.PI, Math.PI);
      this.group.position.copy(pos);
    }
    world.scene.add(this.group);
    this.update(0);
  }

  update(dt) {
    this.t += dt;
    if (this.type === 'drone') {
      const a = this.t * this.orbitSpeed;
      this.group.position.set(
        this.anchor.x + Math.cos(a) * this.orbit,
        this.height + Math.sin(this.t * 1.3) * 1.2,
        this.anchor.z + Math.sin(a) * this.orbit,
      );
      this.group.rotation.y = -a + (this.orbitSpeed > 0 ? 0 : Math.PI);
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
  constructor(scene, mats, fx, sound, callbacks = {}) {
    this.scene = scene;
    this.mats = mats;
    this.fx = fx;
    this.sound = sound;
    this.cb = callbacks;
    this.colliders = [];
    this.targets = [];
    this.respawns = [];

    scene.add(makeSky());
    scene.fog = new THREE.Fog(0xdccbaa, 160, 1100);

    // Lights
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x9a8466, 0.9);
    scene.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0dc, 3.0));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    // Ground
    const tex = concreteTexture();
    tex.repeat.set(2400 / 36, 2400 / 36);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 1, 1), groundMaterial(tex));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const pad = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({
      map: padTexture(), transparent: true, roughness: 0.8, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.02;
    pad.receiveShadow = true;
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

    this.buildProps();
    this.spawnTargets();
  }

  addBox(cx, cy, cz, w, h, d, mat, faces, ry = 0) {
    const m = mesh(chamferBox(w, h, d, Math.min(w, h) * 0.04, 0.06), mat, BODY_SHEET, faces);
    m.position.set(cx, cy + h / 2, cz);
    m.rotation.y = ry;
    this.scene.add(m);
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const hw = (swap ? d : w) / 2, hd = (swap ? w : d) / 2;
    this.colliders.push({ min: new V3(cx - hw, cy, cz - hd), max: new V3(cx + hw, cy + h, cz + hd) });
    return m;
  }

  buildProps() {
    const body = this.mats.armor.map;
    const cmat = (color, metal = 0.25) => new THREE.MeshStandardMaterial({
      map: body, bumpMap: body, bumpScale: 2, color, roughness: 0.6, metalness: metal,
    });
    const containerMats = ['#d86a2c', '#3c6aa8', '#8a8f96', '#5d7346', '#c7b48a', '#b8312b'].map((c) => cmat(c));
    const containerFaces = [
      { x: B.longVent, z: B.ventDark, y: B.greyPlate },
      { x: B.caution, z: B.danger, y: B.greyPlate },
      { x: B.redWhite, z: B.fuel, y: B.greyPlate },
      { x: B.longSlash, z: B.ventFrame, y: B.greyPlate },
    ];
    const container = (x, z, ry, level = 0) => {
      const mat = containerMats[Math.floor(Math.random() * containerMats.length)];
      const faces = containerFaces[Math.floor(Math.random() * containerFaces.length)];
      return this.addBox(x, level * 2.9, z, 7.2, 2.9, 2.9, mat, faces, ry);
    };

    // Container yards
    const yards = [[40, 35], [-55, 20], [25, -70], [-30, -90], [95, -20], [-110, -40], [70, 110], [-80, 120], [150, 70], [-160, 90], [130, -130], [-140, -150]];
    for (const [yx, yz] of yards) {
      const ry = Math.random() < 0.5 ? 0 : Math.PI / 2;
      const rows = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < rows; i++) {
        const along = ry === 0 ? [0, i * 3.1] : [i * 3.1, 0];
        const x = yx + along[0], z = yz + along[1];
        container(x, z, ry, 0);
        if (Math.random() < 0.45) container(x, z, ry, 1);
      }
    }

    // Hangars / service buildings
    const hangarMat = cmat('#c9c4ba', 0.3);
    const roofMat = cmat('#6d7178', 0.5);
    const hangars = [[0, 170, 0], [-190, -10, Math.PI / 2], [200, -40, Math.PI / 2], [10, -200, 0]];
    for (const [x, z, ry] of hangars) {
      this.addBox(x, 0, z, 46, 18, 30, hangarMat, { z: B.ventDark, x: B.longVent, y: B.greyPlate }, ry);
      const roof = mesh(chamferBox(48, 2.4, 32, 1.2, 0.2), roofMat, BODY_SHEET, { all: B.greyPlate });
      roof.position.set(x, 19.2, z);
      roof.rotation.y = ry;
      this.scene.add(roof);
      // big number decal on the hangar door
      const door = mesh(new THREE.PlaneGeometry(18, 14), cmat('#f0ece4'), BODY_SHEET, { all: B.panel07 });
      const off = new V3(0, 7.5, 15.05).applyAxisAngle(new V3(0, 1, 0), ry);
      door.position.set(x + off.x, off.y, z + off.z);
      door.rotation.y = ry;
      this.scene.add(door);
    }

    // Light towers
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.4, metalness: 0.8 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4d8, toneMapped: false });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3, r = 115;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const pole = mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 8), poleMat);
      pole.position.set(x, 15, z);
      this.scene.add(pole);
      const head = mesh(chamferBox(4, 1.6, 1.4, 0.3), poleMat);
      head.position.set(x, 30.5, z);
      head.lookAt(0, 30.5, 0);
      this.scene.add(head);
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.0), lampMat);
      lamp.position.copy(head.position).add(new V3(-x, 0, -z).normalize().multiplyScalar(0.72));
      lamp.lookAt(0, 30.5, 0);
      this.scene.add(lamp);
      this.colliders.push({ min: new V3(x - 0.7, 0, z - 0.7), max: new V3(x + 0.7, 30, z + 0.7) });
    }

    // Concrete barriers
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0xb9b1a2, roughness: 0.9 });
    const barrierGeo = frontPrism([[-0.9, 0], [0.9, 0], [0.35, 0.5], [0.25, 1.6], [-0.25, 1.6], [-0.35, 0.5]], 4, 0.05);
    for (let k = 0; k < 6; k++) {
      const a = rand(0, Math.PI * 2), r = rand(50, 200);
      const ry = Math.random() < 0.5 ? 0 : Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const d = (i - 2) * 4.15;
        const x = Math.cos(a) * r + (ry === 0 ? 0 : d), z = Math.sin(a) * r + (ry === 0 ? d : 0);
        const m = mesh(barrierGeo, barrierMat);
        m.position.set(x, 0, z);
        m.rotation.y = ry;
        this.scene.add(m);
        const hw = ry === 0 ? 0.9 : 2, hd = ry === 0 ? 2 : 0.9;
        this.colliders.push({ min: new V3(x - hw, 0, z - hd), max: new V3(x + hw, 1.6, z + hd) });
      }
    }

    // Distant mesas
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xb98b5f, roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rand(-0.1, 0.1), r = rand(650, 980);
      const geo = new THREE.CylinderGeometry(rand(40, 90), rand(80, 150), rand(50, 140), 7, 3);
      const pos = geo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        _v.fromBufferAttribute(pos, j);
        const k = 1 + (Math.random() - 0.5) * 0.25;
        pos.setXYZ(j, _v.x * k, _v.y + (Math.random() - 0.5) * 6, _v.z * k);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, rockMat);
      geo.computeBoundingBox();
      m.position.set(Math.cos(a) * r, -geo.boundingBox.min.y - 4, Math.sin(a) * r);
      m.rotation.y = rand(0, 6);
      this.scene.add(m);
    }
  }

  freeSpot(minR, maxR, around = new V3()) {
    for (let tries = 0; tries < 40; tries++) {
      const a = rand(0, Math.PI * 2), r = rand(minR, maxR);
      const x = around.x + Math.cos(a) * r, z = around.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > ARENA_RADIUS - 40) continue;
      if (this.colliders.some((c) => x > c.min.x - 6 && x < c.max.x + 6 && z > c.min.z - 6 && z < c.max.z + 6)) continue;
      return new V3(x, 0, z);
    }
    return new V3(around.x + minR, 0, around.z);
  }

  spawnTargets() {
    for (let i = 0; i < 10; i++) this.targets.push(new Target(this, 'drone', this.freeSpot(50, 220)));
    for (let i = 0; i < 9; i++) this.targets.push(new Target(this, 'board', this.freeSpot(35, 200)));
  }

  // ---- queries -------------------------------------------------------------

  /** Height of the surface the mech can stand on at (x, z), given its current feet height y. */
  groundHeight(x, z, y, r = 1.0) {
    let h = 0;
    for (const c of this.colliders) {
      if (x > c.min.x - r && x < c.max.x + r && z > c.min.z - r && z < c.max.z + r && y >= c.max.y - 0.7) {
        h = Math.max(h, c.max.y);
      }
    }
    return h;
  }

  /** Push a vertical cylinder (feet at pos.y, given height) out of colliders in XZ. */
  resolve(pos, r, height) {
    let hit = false;
    for (const c of this.colliders) {
      if (pos.y >= c.max.y - 0.7 || pos.y + height <= c.min.y) continue;
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
          // Center inside the box: push out along the shallowest axis
          const ox = Math.min(pos.x - c.min.x, c.max.x - pos.x), oz = Math.min(pos.z - c.min.z, c.max.z - pos.z);
          if (ox < oz) pos.x = pos.x - c.min.x < c.max.x - pos.x ? c.min.x - r : c.max.x + r;
          else pos.z = pos.z - c.min.z < c.max.z - pos.z ? c.min.z - r : c.max.z + r;
        }
      }
    }
    const rr = Math.hypot(pos.x, pos.z);
    if (rr > ARENA_RADIUS) { pos.x *= ARENA_RADIUS / rr; pos.z *= ARENA_RADIUS / rr; hit = true; }
    return hit;
  }

  /**
   * Ray against targets (spheres), colliders (AABBs) and the ground plane.
   * Returns { dist, point, normal, target } or null.
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
    for (const c of this.colliders) {
      let tmin = 0, tmax = best, axis = -1, sign = 0;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
        const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
        const mn = a === 0 ? c.min.x : a === 1 ? c.min.y : c.min.z;
        const mx = a === 0 ? c.max.x : a === 1 ? c.max.y : c.max.z;
        if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) { ok = false; break; } continue; }
        let t1 = (mn - oa) / da, t2 = (mx - oa) / da, s = -1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
      if (ok && axis >= 0 && tmin < best) {
        best = tmin; target = null;
        normal = new V3(); normal.setComponent(axis, sign);
      }
    }
    if (d.y < -1e-6) {
      const tg = -o.y / d.y;
      if (tg >= 0 && tg < best) { best = tg; target = null; normal = new V3(0, 1, 0); }
    }
    if (!normal) return null;
    return { dist: best, point: new V3().copy(o).addScaledVector(d, best), normal, target };
  }

  damage(t, amount, point) {
    if (!t || !t.alive) return false;
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
  }

  update(dt, player) {
    for (const t of this.targets) if (t.alive) t.update(dt);
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      r.time -= dt;
      if (r.time <= 0) {
        this.respawns.splice(i, 1);
        const t = r.t;
        const spot = this.freeSpot(70, 220, player);
        t.hp = t.maxHp;
        t.alive = true;
        t.group.visible = true;
        t.anchor.copy(spot);
        if (t.type === 'board') t.group.position.copy(spot);
        t.update(0);
        this.fx.flash(t.pos, 6, 0x9fd0ff, 0.3);
      }
    }
    // Keep the shadow frustum centered on the player
    this.sun.position.copy(player).addScaledVector(SUN_DIR, 120);
    this.sun.target.position.copy(player);
  }
}

