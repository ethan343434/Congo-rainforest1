// =============================================================================
// ui.js — HUD bars, menus, toasts, damage flash, fades and cutscene captions.
// All the DOM lives in index.html; this module only toggles and fills it.
// =============================================================================

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.screens = {
      start: $('start-screen'),
      pause: $('pause-screen'),
      win: $('win-screen'),
      death: $('death-screen'),
    };
    this.hud = $('hud');
    this.bars = {
      health: $('bar-health'),
      sprint: $('bar-sprint'),
      battery: $('bar-battery'),
    };
    this.sprintLabel = $('sprint-label');
    this.batteryLabel = $('battery-label');
    this.clock = $('clock');
    this.deaths = $('deaths');
    this.prompt = $('prompt');
    this.toastEl = $('toast');
    this.damage = $('damage-vignette');
    this.fadeEl = $('fade');
    this.captionEl = $('caption');
    this.help = $('help');
    this.toastTimer = 0;
    this.damageLevel = 0;
    this.lastPrompt = null;
  }

  show(name) {
    this.screens[name]?.classList.add('visible');
  }
  hide(name) {
    this.screens[name]?.classList.remove('visible');
  }
  setHud(visible) {
    this.hud.classList.toggle('visible', visible);
  }
  toggleHelp() {
    this.help.classList.toggle('visible');
  }

  update(dt, s) {
    this.bars.health.style.width = `${s.health}%`;
    this.bars.health.parentElement.classList.toggle('low', s.health < 30);
    this.bars.sprint.style.width = `${s.sprint * 100}%`;
    this.bars.sprint.parentElement.classList.toggle('locked', s.sprintLocked);
    this.sprintLabel.textContent = s.sprintLocked ? 'SPRINT · RECHARGING' : s.sprinting ? 'SPRINT · RUNNING' : 'SPRINT';
    this.bars.battery.style.width = `${s.battery}%`;
    this.bars.battery.parentElement.classList.toggle('low', s.battery < 15);
    this.batteryLabel.textContent = s.flashlightOn ? `FLASHLIGHT · ${Math.ceil(s.battery)}%` : 'FLASHLIGHT · OFF';
    this.clock.textContent = s.clock;
    this.deaths.textContent = s.deaths ? `Deaths: ${s.deaths}` : '';

    if (s.prompt !== this.lastPrompt) {
      this.lastPrompt = s.prompt;
      this.prompt.textContent = s.prompt || '';
      this.prompt.classList.toggle('visible', !!s.prompt);
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('visible');
    }
    this.damageLevel = Math.max(0, this.damageLevel - dt * 1.6);
    const lowHealth = s.health < 30 ? 0.25 + Math.sin(performance.now() / 250) * 0.08 : 0;
    this.damage.style.opacity = Math.min(1, this.damageLevel + lowHealth).toFixed(3);
  }

  toast(message, seconds = 4) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');
    this.toastTimer = seconds;
  }

  damageFlash(amount) {
    this.damageLevel = Math.min(1, this.damageLevel + 0.15 + amount / 40);
  }

  /** Fade the screen to `opacity` (0 = clear, 1 = black) over `seconds`. */
  fade(opacity, seconds) {
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    this.fadeEl.style.opacity = String(opacity);
  }

  caption(text) {
    this.captionEl.classList.remove('visible');
    if (!text) return;
    setTimeout(() => {
      this.captionEl.textContent = text;
      this.captionEl.classList.add('visible');
    }, 350);
  }

  letterbox(on) {
    document.body.classList.toggle('letterbox', on);
  }

  showDeath(killer) {
    $('death-cause').textContent = `You were killed by ${killer}.`;
    this.show('death');
  }

  showWin(stats) {
    $('win-stats').innerHTML = `
      <div><span>Time in the jungle</span><b>${stats.time}</b></div>
      <div><span>Days survived</span><b>${stats.days}</b></div>
      <div><span>Deaths</span><b>${stats.deaths}</b></div>
      <div><span>Batteries &amp; medkits found</span><b>${stats.pickups}</b></div>`;
    this.show('win');
  }

  setLoading(loading, message) {
    const btn = $('begin-btn');
    btn.disabled = loading;
    btn.textContent = loading ? message || 'Growing the jungle…' : 'Begin';
  }
}
