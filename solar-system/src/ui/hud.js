// =============================================================================
// hud.js — everything drawn over the 3D view.
//
// * Left: the navigation compass — every planet (and the moons of the system
//   you're in or targeting) with a live arrow showing which way to turn, and
//   the distance. Click a row to make it the autopilot target.
// * 3D markers on bodies, the selected target highlighted; an arrow at the
//   screen edge points to an off-screen target.
// * Flight data, ship/suit gauges, environment, warnings, toasts, prompts,
//   the scanner panel (facts + survivability) and a heading tape near ground.
// =============================================================================
import * as THREE from 'three';
import { formatDistance, formatSpeed, formatDuration, formatPressure, formatTemp, KELVIN, G0, C_LIGHT, AU } from '../constants.js';
import { formatDose } from '../sim/hazards.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const _qi = new THREE.Quaternion();

const RATING_CLASS = { Lethal: 'lethal', Hostile: 'hostile', 'Suit required': 'suit', Habitable: 'habitable' };

export class Hud {
  constructor(eph, onSelect, navOrder) {
    this.eph = eph;
    this.navOrder = navOrder;
    this.onSelect = onSelect;
    this.root = $('hud');
    this.navList = $('nav-list');
    this.markersEl = $('markers');
    this.rows = new Map();
    this.markers = new Map();
    this.lastText = 0;
    this.toastQueue = [];
    this.expanded = new Set();
    this.buildNav();
    this.buildMarkers();
    this.cache = {};
  }

  show(v) { this.root.hidden = !v; this.markersEl.hidden = !v; }

  // ---- Navigation compass -------------------------------------------------------------
  buildNav() {
    for (const id of this.navOrder) {
      const b = this.eph.byId[id];
      this.addRow(b, false);
      if (b.kind === 'star') continue; // the Sun's "children" are the planets themselves
      for (const m of [...b.children].sort((p, q) => p.def.ephem.a - q.def.ephem.a)) this.addRow(m, true);
    }
  }

  addRow(body, isMoon) {
    const li = document.createElement('li');
    li.className = isMoon ? 'moon' : 'planet';
    li.innerHTML = `<span class="dir"><i></i></span><span class="name"></span><span class="dist"></span>`;
    li.querySelector('.name').textContent = body.name;
    li.title = `Select ${body.name} as target`;
    li.addEventListener('click', () => this.onSelect(body));
    this.navList.appendChild(li);
    this.rows.set(body.id, { li, arrow: li.querySelector('.dir i'), dir: li.querySelector('.dir'), dist: li.querySelector('.dist'), body, isMoon });
  }

  buildMarkers() {
    for (const b of this.eph.bodies) {
      const el = document.createElement('div');
      el.className = `marker ${b.kind === 'moon' ? 'moon' : ''}`;
      el.innerHTML = '<span class="box"></span><span class="tag"></span>';
      el.style.display = 'none';
      this.markersEl.appendChild(el);
      this.markers.set(b.id, { el, tag: el.querySelector('.tag'), body: b, lastText: '' });
    }
  }

  /** Camera-space direction of a world point (camera at origin). */
  toCamera(worldRel, camQuat, out) {
    _qi.copy(camQuat).invert();
    return out.copy(worldRel).applyQuaternion(_qi);
  }

  /**
   * ctx: { origin, camQuat, camera, target, current (BodyState), ship, systems,
   *        suit, onFoot, telemetry, env, landmarks, now, playerPos }
   */
  update(ctx) {
    const W = window.innerWidth, H = window.innerHeight;
    const f = (H / 2) / Math.tan((ctx.camera.fov * Math.PI) / 360);
    const textTick = ctx.now - this.lastText > 0.1;
    if (textTick) this.lastText = ctx.now;
    const system = ctx.current.kind === 'moon' ? ctx.current.parent : ctx.current;
    const targetSystem = ctx.target ? (ctx.target.kind === 'moon' ? ctx.target.parent : ctx.target) : null;
    const camRel = new THREE.Vector3();

    // ---- Compass rows ----
    for (const row of this.rows.values()) {
      const b = row.body;
      const visibleRow = !row.isMoon || b.parent === system || b.parent === targetSystem;
      row.li.hidden = !visibleRow;
      row.li.classList.toggle('selected', ctx.target === b);
      row.li.classList.toggle('current', ctx.current === b);
      if (!visibleRow) continue;
      camRel.subVectors(b.pos, ctx.playerPos);
      const dist = camRel.length() - b.radius;
      this.toCamera(camRel, ctx.camQuat, _v);
      const ang = Math.atan2(_v.x, _v.y);
      const offNose = Math.acos(Math.max(-1, Math.min(1, -_v.z / _v.length())));
      row.arrow.style.transform = `translate(-50%, -60%) rotate(${ang}rad)`;
      row.dir.classList.toggle('behind', _v.z > 0);
      row.dir.classList.toggle('ahead', offNose < 0.08);
      if (textTick) row.dist.textContent = formatDistance(Math.max(dist, 0));
    }

    // ---- 3D markers ----
    for (const m of this.markers.values()) {
      const b = m.body;
      const show = b === ctx.target || b === ctx.current || b.kind !== 'moon' || b.parent === system;
      if (!show || (ctx.onFoot && b === ctx.current)) { m.el.style.display = 'none'; continue; }
      camRel.subVectors(b.pos, ctx.origin);
      this.toCamera(camRel, ctx.camQuat, _v);
      if (_v.z >= 0) { m.el.style.display = 'none'; continue; }
      const sx = W / 2 + (_v.x / -_v.z) * f;
      const sy = H / 2 - (_v.y / -_v.z) * f;
      const apparent = (b.radius / camRel.length()) * f;
      // Hide the marker on a body that fills the view (you're right there).
      if (apparent > H * 0.35 || sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) { m.el.style.display = 'none'; continue; }
      m.el.style.display = '';
      m.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      m.el.classList.toggle('target', b === ctx.target);
      if (textTick) {
        const text = `${b.name}<small>${formatDistance(Math.max(0, camRel.length() - b.radius))}</small>`;
        if (text !== m.lastText) { m.tag.innerHTML = text; m.lastText = text; }
      }
    }
    this.updateLandmarks(ctx, W, H, f);

    // ---- Off-screen target arrow ----
    const arrow = $('target-arrow');
    if (ctx.target) {
      camRel.subVectors(ctx.target.pos, ctx.origin);
      this.toCamera(camRel, ctx.camQuat, _v);
      const onScreen = _v.z < 0 && Math.abs(_v.x / -_v.z) * f < W / 2 - 30 && Math.abs(_v.y / -_v.z) * f < H / 2 - 30;
      arrow.hidden = onScreen;
      if (!onScreen) {
        const ang = Math.atan2(_v.x, _v.y);
        const r = Math.min(W, H) * 0.42;
        arrow.style.left = `${W / 2 + Math.sin(ang) * r}px`;
        arrow.style.top = `${H / 2 - Math.cos(ang) * r}px`;
        arrow.style.transform = `rotate(${ang}rad)`;
      }
    } else arrow.hidden = true;

    // ---- Prograde / retrograde markers (velocity relative to the local surface) ----
    this.updateVelocityMarkers(ctx, W, H, f);
    this.updateHeading(ctx);

    if (textTick) this.updateText(ctx);
    this.updateToasts(ctx.now);
  }

  updateLandmarks(ctx, W, H, f) {
    const list = ctx.landmarks || [];
    if (!this.landmarkEls) this.landmarkEls = [];
    while (this.landmarkEls.length < list.length) {
      const el = document.createElement('div');
      el.className = 'marker landmark';
      el.innerHTML = '<span class="box"></span><span class="tag"></span>';
      this.markersEl.appendChild(el);
      this.landmarkEls.push(el);
    }
    this.landmarkEls.forEach((el, i) => {
      const lm = list[i];
      if (!lm) { el.style.display = 'none'; return; }
      const rel = lm.world.clone().sub(ctx.origin);
      this.toCamera(rel, ctx.camQuat, _v);
      if (_v.z >= 0 || lm.distance > 600e3) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.transform = `translate(${(W / 2 + (_v.x / -_v.z) * f).toFixed(1)}px, ${(H / 2 - (_v.y / -_v.z) * f).toFixed(1)}px)`;
      el.querySelector('.tag').innerHTML = `${lm.name}<small>${formatDistance(lm.distance)}</small>`;
    });
  }

  updateVelocityMarkers(ctx, W, H, f) {
    const pro = $('prograde'), retro = $('retrograde');
    const t = ctx.telemetry;
    if (ctx.onFoot || !ctx.relVel || ctx.relVel.length() < 2 || ctx.mode === 'pulse' || ctx.mode === 'landed') {
      pro.hidden = retro.hidden = true;
      return;
    }
    for (const [el, sign] of [[pro, 1], [retro, -1]]) {
      this.toCamera(ctx.relVel.clone().multiplyScalar(sign), ctx.camQuat, _v);
      if (_v.z >= -1e-6) { el.hidden = true; continue; }
      const sx = W / 2 + (_v.x / -_v.z) * f, sy = H / 2 - (_v.y / -_v.z) * f;
      el.hidden = sx < 0 || sx > W || sy < 0 || sy > H;
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
    }
  }

  updateHeading(ctx) {
    const tape = $('heading-tape');
    const near = ctx.surface && ctx.surface.altitude < 200e3;
    tape.hidden = !near;
    if (!near) return;
    const strip = $('heading-strip');
    if (!strip.dataset.built) {
      let html = '';
      for (let d = -360; d <= 720; d += 15) {
        const dd = ((d % 360) + 360) % 360;
        const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd];
        html += `<span style="left:${(d + 360) * 4}px" class="${card ? 'card' : ''}">${card || (dd % 45 === 0 ? dd : '·')}</span>`;
      }
      strip.innerHTML = html;
      strip.dataset.built = '1';
    }
    const half = tape.clientWidth / 2;
    strip.style.transform = `translateX(${half - (ctx.surface.heading + 360) * 4}px)`;
  }

  updateText(ctx) {
    const t = ctx.telemetry;
    const set = (id, text) => { if (this.cache[id] !== text) { this.cache[id] = text; $(id).textContent = text; } };
    $('nav-frame').textContent = `in ${ctx.current.name}’s gravity`;
    // Flight.
    if (ctx.onFoot) {
      set('r-speed', formatSpeed(ctx.walkerSpeed || 0));
      set('r-mode', ctx.walkerAir ? 'ON FOOT · JETPACK' : 'ON FOOT');
    } else {
      set('r-speed', ctx.mode === 'pulse' ? `${formatSpeed(t.speed)}` : formatSpeed(ctx.surfaceSpeed ?? t.speed));
      set('r-mode', { flight: ctx.autopilot ? `AUTOPILOT · ${ctx.autopilot}` : t.speedLimited ? 'CRUISE · PLANET LIMIT' : t.cruise > 20 ? 'CRUISE ENGINES' : 'THRUSTERS', pulse: ctx.autopilot ? 'PULSE · AUTOPILOT' : 'PULSE DRIVE', landed: 'LANDED', destroyed: 'DESTROYED' }[ctx.mode] || ctx.mode.toUpperCase());
    }
    const alt = ctx.surface ? ctx.surface.ground : t.altitude;
    set('r-alt', alt === Infinity ? '—' : formatDistance(alt));
    set('r-vs', ctx.onFoot ? '—' : `${t.vSpeed >= 0 ? '+' : ''}${formatSpeed(t.vSpeed)}`);
    set('r-g', `${(t.gravity / G0).toFixed(t.gravity < 0.1 ? 4 : 2)} g`);
    set('r-body', t.nearest ? `${t.nearest.name} · ${formatDistance(Math.max(0, t.nearestDist))}` : '—');
    const fa = $('r-fa');
    const faText = ctx.onFoot ? (ctx.walkerAir ? 'JETPACK' : 'WALKING') : ctx.flightAssist ? 'FLIGHT ASSIST ON' : 'FLIGHT ASSIST OFF · NEWTONIAN';
    set('r-fa', faText);
    fa.parentElement.classList.toggle('off', !ctx.flightAssist && !ctx.onFoot);

    // Status gauges.
    const sys = ctx.systems;
    this.gauge('g-hull', sys.hull, `${Math.ceil(sys.hull)}%`);
    const heatFrac = Math.min(1, Math.max(0, (sys.hullTemp - 250) / (2300 - 250)));
    this.gauge('g-heat', heatFrac * 100, `${Math.round(sys.hullTemp - KELVIN).toLocaleString('en-US')} °C`, sys.hullTemp > 1300 ? 'crit' : sys.hullTemp > 1050 ? 'warn' : '', true);
    for (const id of ['g-health', 'g-life', 'g-hazard', 'g-jet']) $(id).hidden = !ctx.onFoot;
    if (ctx.onFoot) {
      const s = ctx.suit;
      this.gauge('g-health', s.health, `${Math.ceil(s.health)}%`);
      this.gauge('g-life', s.lifeSupport, `${Math.ceil(s.lifeSupport)}%`);
      this.gauge('g-hazard', s.hazard, `${Math.ceil(s.hazard)}%`);
      this.gauge('g-jet', s.jetpack, `${Math.ceil(s.jetpack)}%`);
    }
    // Environment.
    const e = ctx.env;
    set('e-temp', e.temp ? formatTemp(e.temp) : 'space');
    set('e-press', formatPressure(e.pressure || 0));
    set('e-rad', formatDose(e.radiation || 0));
    set('e-sun', `${(e.solarFlux / 1361).toFixed(e.solarFlux < 136 ? 3 : 2)}× Earth`);

    // Target.
    if (ctx.target) {
      const tg = ctx.target;
      const d = tg.pos.distanceTo(ctx.playerPos) - tg.radius;
      set('t-name', tg.name);
      set('t-dist', formatDistance(Math.max(0, d)));
      const closing = ctx.closingSpeed;
      const eta = closing > 1 && d > 2000 ? d / closing : Infinity;
      set('t-eta', ctx.mode === 'pulse' && ctx.autopilot ? 'Pulse autopilot engaged' : eta < 86400 * 2 ? `ETA ${formatDuration(eta)} at ${formatSpeed(closing)}` : light(tg.pos.distanceTo(ctx.playerPos)));
      const r = tg.def.survivability?.rating || '';
      const ratingEl = $('t-rating');
      ratingEl.textContent = r;
      ratingEl.className = `rating ${RATING_CLASS[r] || ''}`;
    }
    // Warnings (most severe first).
    const warns = ctx.warnings || [];
    const wEl = $('warning');
    if (warns.length) {
      const top = warns.find((w) => w.level === 'danger') || warns[0];
      wEl.hidden = false;
      if (wEl.textContent !== top.text) wEl.textContent = top.text;
      wEl.classList.toggle('caution', top.level !== 'danger');
    } else wEl.hidden = true;
    // Prompt.
    const p = $('prompt');
    p.hidden = !ctx.prompt;
    if (ctx.prompt && p.innerHTML !== ctx.prompt) p.innerHTML = ctx.prompt;
    // FPS.
    const fpsEl = $('fps');
    fpsEl.hidden = !ctx.showFps;
    if (ctx.showFps) fpsEl.textContent = `${ctx.fps.toFixed(0)} fps · ${ctx.qualityName}`;
  }

  gauge(id, pct, text, cls, raw) {
    const el = $(id);
    const bar = el.querySelector('i');
    const w = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    if (bar.style.width !== w) bar.style.width = w;
    const val = el.querySelector('.val');
    if (val.textContent !== text) val.textContent = text;
    const state = cls ?? (pct < 25 ? 'crit' : pct < 50 ? 'warn' : '');
    el.classList.toggle('warn', state === 'warn');
    el.classList.toggle('crit', state === 'crit');
  }

  // ---- Toasts ---------------------------------------------------------------------------
  toast(title, body, kind = '', seconds = 5) {
    this.toastQueue.push({ title, body, kind, seconds });
  }

  updateToasts(now) {
    const box = $('toasts');
    while (this.toastQueue.length && box.children.length < 2) {
      const t = this.toastQueue.shift();
      const el = document.createElement('div');
      el.className = `toast ${t.kind}`;
      el.innerHTML = `<b></b><span></span>`;
      el.querySelector('b').textContent = t.title;
      el.querySelector('span').textContent = t.body;
      el.dataset.until = String(now + t.seconds);
      box.appendChild(el);
    }
    for (const el of [...box.children]) if (Number(el.dataset.until) < now) el.remove();
  }

  // ---- Scanner / info panel ------------------------------------------------------------------
  showInfo(body, playerPos) {
    const d = body.def;
    const card = $('info-card');
    const R = body.radius;
    const g = body.GM / (R * R);
    const esc = Math.sqrt((2 * body.GM) / R);
    const dist = body.pos.distanceTo(playerPos) - R;
    const sunDist = body.pos.length();
    const s = d.stats || {};
    const atm = d.atmosphere;
    const surv = d.survivability || {};
    const rows = [
      ['Type', s.type],
      ['Radius', `${(R / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`],
      ['Surface gravity', `${g.toFixed(g < 1 ? 3 : 2)} m/s² (${(g / G0).toFixed(g / G0 < 0.1 ? 3 : 2)} g)`],
      ['Escape velocity', formatSpeed(esc)],
      ['Day length', s.day],
      [body.kind === 'moon' ? 'Orbit' : 'Year', body.kind === 'moon' ? s.orbit || s.year : s.year],
      ['Distance from Sun', body.id === 'sun' ? '—' : `${(sunDist / AU).toFixed(3)} AU`],
      ['Temperature', s.temp],
      ['Atmosphere', atm ? `${atm.composition} · ${formatPressure(atm.pressure)}` : 'None (vacuum)'],
      ['Moons', s.moons ?? (body.children.length || '—')],
      ['Distance from you', formatDistance(Math.max(0, dist))],
      ['Light from here', light(body.pos.distanceTo(playerPos))],
    ].filter((r) => r[1] !== undefined && r[1] !== '');
    const cls = RATING_CLASS[surv.rating] || '';
    card.innerHTML = `
      <span class="kind">${escapeHtml(s.type || d.kind)}</span>
      <h2>${escapeHtml(d.name)}</h2>
      <dl class="stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('')}</dl>
      <section class="surv ${cls}">
        <h3>Survivability · ${escapeHtml(surv.rating || '—')}</h3>
        <p>${escapeHtml(surv.summary || '')}</p>
        ${surv.hazards ? `<ul>${surv.hazards.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>` : ''}
      </section>
      <ul class="facts">${(d.facts || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <footer><span class="small">Data: NASA/JPL fact sheets · positions computed for today</span>
      <button type="button" class="btn" data-close="info">Close <kbd>I</kbd></button></footer>`;
    $('info').hidden = false;
  }
}

function light(d) {
  const s = d / C_LIGHT;
  return s < 1 ? '' : `Light takes ${formatDuration(s)}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
