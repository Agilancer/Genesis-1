import * as THREE from './three.js';
import { PAINTS, SKINS } from './atlas.js';
import { WEAPONS, SLOTS, PRESETS, allowedFor } from './weapons.js';

const $ = (s) => document.querySelector(s);
const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = {
      score: $('#score'), boostBar: $('#boost-bar'), boostTxt: $('#boost-txt'), gauge: $('.gauge'),
      spd: $('#spd'), alt: $('#alt'), lockct: $('#lockct'), mslct: $('#mslct'),
      weapons: $('#weapons'), toast: $('#toast'), hit: $('#hitmark'), locks: $('#locks'), zone: $('#lock-zone'),
      hint: $('#help-hint'), hard: $('#hardlock'), hardInfo: $('#hardlock span'), hardHp: $('#hardlock .hp b'), arrow: $('#lock-arrow'),
    };
    this.last = {};
    this.lockEls = new Map();
    this.rows = [];
    this.toastT = 0;
    this.hitT = 0;
    this.score = 0;
    setTimeout(() => { if (this.el.hint) this.el.hint.style.opacity = '0'; }, 14000);
  }

  set(key, el, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  toast(msg, time = 1.4) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('on');
    this.toastT = time;
  }

  hit(kill) {
    const h = this.el.hit;
    h.classList.toggle('kill', !!kill);
    h.classList.add('on');
    this.hitT = kill ? 0.35 : 0.12;
  }

  addKill() {
    this.score++;
    this.el.score.textContent = this.score;
  }

  buildWeapons(status) {
    const root = this.el.weapons;
    root.innerHTML = '';
    this.rows = status.map((s) => {
      const row = document.createElement('div');
      row.className = 'wrow';
      const short = { rightHand: 'R', leftHand: 'L', shoulderL: 'SH-L', shoulderR: 'SH-R', legL: 'LG-L', legR: 'LG-R' }[s.slot.id];
      row.innerHTML = `<span class="slot">${short}</span><span class="wname"></span><span class="ammo"></span><div class="meter"><i></i></div>`;
      root.appendChild(row);
      return { row, name: row.querySelector('.wname'), ammo: row.querySelector('.ammo'), bar: row.querySelector('.meter i'), key: '' };
    });
  }

  update(dt, d) {
    const e = this.el;
    // Boost
    const b = Math.round(d.boost);
    this.set('boost', e.boostTxt, String(b));
    e.boostBar.style.width = `${Math.max(0, d.boost)}%`;
    e.gauge.classList.toggle('hot', d.overheat);
    this.set('spd', e.spd, String(Math.round(d.speed)));
    this.set('alt', e.alt, String(Math.round(d.alt)));
    this.set('lock', e.lockct, String(d.locks.length));
    this.set('msl', e.mslct, `/${d.missiles} MSL`);
    e.zone.classList.toggle('active', d.missileCap > 0);
    e.zone.style.display = d.missileCap > 0 ? '' : 'none';

    // Weapons
    if (this.rows.length !== d.weapons.length) this.buildWeapons(d.weapons);
    d.weapons.forEach((s, i) => {
      const r = this.rows[i];
      if (s.empty) {
        if (r.key !== 'empty') { r.key = 'empty'; r.row.className = 'wrow empty-slot'; r.name.textContent = '—'; r.ammo.textContent = ''; r.bar.style.width = '0'; }
        return;
      }
      let cls = 'wrow';
      if (s.kind === 'missile') cls += ' missile';
      if (s.reload != null) cls += ' reloading';
      let ammo = s.kind === 'shield' ? 'RMB' : `${s.ammo}/${s.max}`;
      let frac = s.kind === 'shield' ? 1 : s.ammo / s.max;
      if (s.reload != null) { ammo = 'RELOAD'; frac = s.reload; }
      if (s.charge != null) { ammo = s.charge >= 1 ? 'FIRING' : 'CHARGE'; frac = Math.min(1, s.charge); }
      const key = `${cls}|${s.name}|${ammo}|${Math.round(frac * 40)}`;
      if (key === r.key) return;
      r.key = key;
      r.row.className = cls;
      r.name.textContent = s.name;
      r.ammo.textContent = ammo;
      r.bar.style.width = `${Math.round(frac * 100)}%`;
    });

    // Lock markers
    const seen = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    for (const l of d.locks) {
      seen.add(l);
      let el = this.lockEls.get(l);
      if (!el) {
        el = document.createElement('div');
        el.className = 'lock new';
        el.innerHTML = '<b></b>';
        e.locks.appendChild(el);
        this.lockEls.set(l, el);
      }
      _v.copy(l.target.pos).project(d.camera);
      if (_v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = `${(_v.x * 0.5 + 0.5) * W}px`;
      el.style.top = `${(-_v.y * 0.5 + 0.5) * H}px`;
      const dist = Math.round(l.target.pos.distanceTo(d.camera.position) * d.meters);
      el.firstChild.textContent = `${dist}m`;
    }
    for (const [l, el] of this.lockEls) {
      if (!seen.has(l)) { el.remove(); this.lockEls.delete(l); }
    }

    // Lock-on bracket, or an edge arrow when the target is off-screen
    if (d.hard) {
      _v.copy(d.hard.pos).project(d.camera);
      const behind = _v.z > 1;
      let x = _v.x, y = _v.y;
      if (behind) { x = -x; y = -y; }
      const off = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.95;
      if (!off) {
        e.hard.hidden = false;
        e.arrow.hidden = true;
        e.hard.style.left = `${(x * 0.5 + 0.5) * W}px`;
        e.hard.style.top = `${(-y * 0.5 + 0.5) * H}px`;
        const dist = Math.round(d.hard.pos.distanceTo(d.camera.position) * d.meters);
        this.set('hardInfo', e.hardInfo, `LOCK ${dist}m`);
        e.hardHp.style.width = `${Math.max(0, d.hard.hp / d.hard.maxHp) * 100}%`;
      } else {
        e.hard.hidden = true;
        e.arrow.hidden = false;
        const a = Math.atan2(y, x);
        const k = 0.9 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        e.arrow.style.left = `${(Math.cos(a) * k * 0.5 + 0.5) * W}px`;
        e.arrow.style.top = `${(-Math.sin(a) * k * 0.5 + 0.5) * H}px`;
        e.arrow.style.transform = `translate(-50%, -50%) rotate(${-a}rad)`;
      }
    } else {
      e.hard.hidden = true;
      e.arrow.hidden = true;
    }

    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.classList.remove('on'); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) e.hit.classList.remove('on'); }
  }
}

// ---------------------------------------------------------------------------
// Hangar (loadout menu)
// ---------------------------------------------------------------------------

export class Hangar {
  constructor({ loadout, settings, onChange, onSettings, sound }) {
    this.loadout = loadout;
    this.settings = settings;
    this.onChange = onChange;
    this.onSettings = onSettings;
    this.sound = sound;
    this.body = $('#hangar-body');
    this.render();
  }

  click() { this.sound && this.sound.click(); }

  render() {
    const L = this.loadout, b = this.body;
    b.innerHTML = '';

    // Presets
    const pre = section('Presets', 'Quick loadouts');
    const pc = div('chips');
    for (const p of PRESETS) {
      pc.appendChild(chip(p.name, false, () => {
        L.paint = p.paint;
        for (const k in p.slots) L.slots[k] = [...p.slots[k]];
        this.click();
        this.onChange();
        this.render();
      }));
    }
    pre.appendChild(pc);
    b.appendChild(pre);

    // Paint
    const paint = section('Frame paint', PAINTS.find((p) => p.id === L.paint)?.name || '');
    const sw = div('swatches');
    for (const p of PAINTS) {
      const s = swatch(p.name, p.armor, p.second, L.paint === p.id, () => {
        L.paint = p.id;
        this.click();
        this.onChange();
        this.render();
      });
      sw.appendChild(s);
    }
    paint.appendChild(sw);
    b.appendChild(paint);

    // Slots
    for (const slot of SLOTS) {
      const [wid, skinId] = L.slots[slot.id] || [null, 'white'];
      const card = div(`slot-card${wid ? ' filled' : ''}`);
      const head = div('hsec-title');
      head.innerHTML = `<h3>${slot.label}</h3><span class="hint">${slot.key}</span>`;
      card.appendChild(head);
      const chips = div('chips');
      chips.appendChild(chip('None', !wid, () => this.setSlot(slot.id, null, skinId)));
      for (const id of allowedFor(slot)) {
        chips.appendChild(chip(WEAPONS[id].short.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), wid === id,
          () => this.setSlot(slot.id, id, skinId)));
      }
      card.appendChild(chips);
      if (wid) {
        const desc = div('slot-desc');
        desc.textContent = `${WEAPONS[wid].name}. ${WEAPONS[wid].desc}`;
        card.appendChild(desc);
        const skins = div('swatches');
        for (const s of SKINS) {
          skins.appendChild(swatch(s.name, s.tint, s.stripe, skinId === s.id, () => this.setSlot(slot.id, wid, s.id)));
        }
        card.appendChild(skins);
      }
      b.appendChild(card);
    }

    // Settings
    const set = section('Settings', '');
    const S = this.settings;
    set.appendChild(toggleRow('Sound', S.sound, (v) => { S.sound = v; this.onSettings(); }));
    set.appendChild(toggleRow('Shadows', S.shadows, (v) => { S.shadows = v; this.onSettings(); }));
    set.appendChild(toggleRow('Ink outlines', S.outlines, (v) => { S.outlines = v; this.onSettings(); }));
    set.appendChild(toggleRow('Invert look', S.invert, (v) => { S.invert = v; this.onSettings(); }));
    set.appendChild(toggleRow('High resolution', S.hires, (v) => { S.hires = v; this.onSettings(); }));
    const sens = div('settings-row');
    sens.innerHTML = '<label for="sens">Look sensitivity</label>';
    const r = document.createElement('input');
    r.type = 'range'; r.id = 'sens'; r.min = '0.3'; r.max = '2.5'; r.step = '0.05'; r.value = String(S.sens);
    r.addEventListener('input', () => { S.sens = parseFloat(r.value); this.onSettings(); });
    sens.appendChild(r);
    set.appendChild(sens);
    b.appendChild(set);
  }

  setSlot(id, wid, skin) {
    this.loadout.slots[id] = [wid, skin];
    this.click();
    this.onChange();
    const scroll = this.body.scrollTop;
    this.render();
    this.body.scrollTop = scroll;
  }
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
function section(title, hint) {
  const s = div('hsec');
  const h = div('hsec-title');
  h.innerHTML = `<h3>${title}</h3><span class="hint">${hint}</span>`;
  s.appendChild(h);
  return s;
}
function chip(text, on, fn) {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'chip';
  c.textContent = text;
  c.setAttribute('aria-pressed', on ? 'true' : 'false');
  c.addEventListener('click', fn);
  return c;
}
function swatch(name, color, accent, on, fn) {
  const s = document.createElement('button');
  s.type = 'button';
  s.className = 'swatch';
  s.title = name;
  s.setAttribute('aria-label', name);
  s.setAttribute('aria-pressed', on ? 'true' : 'false');
  s.style.background = color;
  s.innerHTML = `<i style="background:${accent}"></i>`;
  s.addEventListener('click', fn);
  return s;
}
function toggleRow(label, value, fn) {
  const row = div('settings-row');
  row.innerHTML = `<span>${label}</span>`;
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'toggle';
  const sync = (v) => { t.textContent = v ? 'On' : 'Off'; t.setAttribute('aria-pressed', v ? 'true' : 'false'); };
  sync(value);
  t.addEventListener('click', () => { value = !value; sync(value); fn(value); });
  row.appendChild(t);
  return row;
}
