import { $, state, servoNames, servoKeys, servoIcons, INTERVALO } from './state.js';
import { addLog } from './logger.js';
import { saveHistory } from './api.js';
import { hasPermission } from './auth.js';
import { publish } from './mqtt.js';

export function buildCards() {
  const grid = $('servo-grid');
  if (!grid || grid.children.length) return;
  const arcLen = (Math.PI * 58).toFixed(1);
  const arcHalf = (Math.PI * 29).toFixed(1);

  for (let i = 1; i <= 4; i++) {
    grid.insertAdjacentHTML('beforeend', `
      <div class="servo-card" id="card${i}">
        <div class="servo-header">
          <div class="servo-title"><i class="ti ${servoIcons[i - 1]}"></i>Servo ${i} · ${servoNames[i - 1]}</div>
          <div class="servo-angle"><span class="num" id="num${i}">90</span><span class="deg">°</span></div>
        </div>
        <div class="arc-wrap">
          <svg width="140" height="82" viewBox="0 0 140 82" role="img" aria-label="Ángulo servo ${i}">
            <path class="arc-bg-s" d="M 12,70 A 58,58 0 0,1 128,70"/>
            <path class="arc-fill-s" id="arc${i}" d="M 12,70 A 58,58 0 0,1 128,70" stroke-dasharray="${arcLen}" stroke-dashoffset="${arcHalf}"/>
            <line id="needle${i}" x1="70" y1="70" x2="70" y2="16" stroke="#b666ff" stroke-width="2" stroke-linecap="round" class="needle-s"/>
            <circle cx="70" cy="70" r="4" fill="#8A2BE2"/>
            <text x="10" y="80" font-size="9" fill="#4a3f6b">0°</text>
            <text x="62" y="12" font-size="9" fill="#4a3f6b">90°</text>
            <text x="118" y="80" font-size="9" fill="#4a3f6b" text-anchor="end">180°</text>
          </svg>
        </div>
        <input type="range" min="0" max="180" value="90" step="1" id="slider${i}" data-servo="${i}"/>
        <div class="slider-ticks"><span>0°</span><span>90°</span><span>180°</span></div>
        <div class="presets">
          <button class="preset" data-servo="${i}" data-angle="0">0°</button>
          <button class="preset" data-servo="${i}" data-angle="45">45°</button>
          <button class="preset" data-servo="${i}" data-angle="90">90°</button>
          <button class="preset" data-servo="${i}" data-angle="135">135°</button>
          <button class="preset" data-servo="${i}" data-angle="180">180°</button>
        </div>
      </div>`);
  }
}

export function updateAngle(i, val) {
  const v = Math.max(0, Math.min(180, parseInt(val, 10) || 0));
  const arcLen = Math.PI * 58;
  $(`num${i}`).textContent = v;
  $(`arc${i}`).style.strokeDashoffset = (arcLen - (v / 180) * arcLen).toFixed(1);
  $(`needle${i}`).style.transform = `rotate(${-90 + v}deg)`;
  $(`dash-${servoKeys[i - 1]}`).textContent = `${v}°`;
}

export function mover(servo, valor, force = false) {
  if (!hasPermission('robot_control')) return;
  const ahora = Date.now();
  if (!force && ahora - state.ultimoEnvio[servo - 1] <= INTERVALO) return;
  state.ultimoEnvio[servo - 1] = ahora;
  if (publish(`brazo/servo/${servo}`, valor)) {
    updateAngle(servo, valor);
    const card = $(`card${servo}`);
    card.classList.add('pulse');
    setTimeout(() => card.classList.remove('pulse'), 260);
    addLog(`Servo ${servo} (${servoNames[servo - 1]}) -> ${valor}°`, 'ok');
  }
}

export function irA(servo, val) {
  if (!hasPermission('robot_control')) return;
  $(`slider${servo}`).value = val;
  mover(servo, val, true);
}

export function resetAll() {
  if (!hasPermission('robot_control')) return addLog('No tienes permiso para controlar el brazo', 'err');
  for (let i = 1; i <= 4; i++) irA(i, 90);
  saveHistory('robot', 'Todos los servos centrados a 90°');
}

export function setModo(modo) {
  if (!hasPermission('robot_control')) return addLog('No tienes permiso para cambiar el modo', 'err');
  state.currentMode = modo;
  $('btn-manual').classList.toggle('active', modo === 'manual');
  $('btn-auto').classList.toggle('active', modo === 'auto');
  publish('brazo/modo', modo);
  saveHistory('robot_mode', `Modo cambiado a ${modo}`);
}
