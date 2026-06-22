// Renderizador genérico de widgets por capacidad (Fase 1).
// Convierte device.entities en controles vivos, sin lógica específica de "servos".
// Ver docs/entity-model.md.
import { escapeHtml, state, INTERVALO } from './state.js';
import { publish } from './mqtt.js';
import { api } from './api.js';

const ARC_LEN = Math.PI * 58; // longitud del arco del gauge (radio 58)

// Índice: tópico de estado -> { deviceId, entity }, para resolver MQTT entrante rápido.
let stateTopicIndex = new Map();
// Throttle por entidad para sliders (igual que el control del brazo).
const lastSent = new Map();
// Instancias Chart.js por widget (para destruir/actualizar).
const chartRegistry = new Map();

export function reindexEntities() {
  stateTopicIndex = new Map();
  for (const device of state.devices || []) {
    for (const entity of device.entities || []) {
      if (entity?.mqtt?.state) {
        stateTopicIndex.set(entity.mqtt.state, { deviceId: device.deviceId, entity });
      }
    }
  }
}

function findEntity(deviceId, entityId) {
  const device = (state.devices || []).find((d) => d.deviceId === deviceId);
  if (!device) return null;
  const entity = (device.entities || []).find((e) => e.id === entityId);
  return entity ? { device, entity } : null;
}

function widgetId(deviceId, entityId) {
  return `ent-${deviceId}-${entityId}`;
}

function readPayloadValue(entity, payload) {
  let value = payload;
  if (entity.mqtt?.payloadKey) {
    let parsed = payload;
    if (typeof payload === 'string') {
      try { parsed = JSON.parse(payload); } catch { parsed = null; }
    }
    value = parsed && typeof parsed === 'object' ? parsed[entity.mqtt.payloadKey] : undefined;
  }
  return value;
}

function formatSensor(entity, value) {
  if (value === undefined || value === null || value === '') return '--';
  if (entity.dataType === 'number' && Number.isFinite(Number(value))) {
    const n = Number(value);
    const txt = Number.isInteger(entity.precision) ? n.toFixed(entity.precision) : String(n);
    return `${txt}${entity.unit ? ' ' + entity.unit : ''}`;
  }
  return `${value}${entity.unit ? ' ' + entity.unit : ''}`;
}

// --- Render ---

function rangeGaugeHtml(device, entity) {
  const id = widgetId(device.deviceId, entity.id);
  const data = `data-device="${escapeHtml(device.deviceId)}" data-entity="${escapeHtml(entity.id)}" data-cap="range"`;
  const min = Number(entity.min ?? 0);
  const max = Number(entity.max ?? 180);
  const step = Number(entity.step ?? 1);
  const currentVal = device.entityStates?.[entity.id];
  const def = Number(currentVal ?? entity.default ?? min);
  const mid = Math.round((min + max) / 2);
  const unit = entity.unit ? escapeHtml(entity.unit) : '°';
  const icon = entity.ui?.icon ? escapeHtml(entity.ui.icon) : 'ti-settings';
  const frac = max > min ? (def - min) / (max - min) : 0;
  const offset = (ARC_LEN - frac * ARC_LEN).toFixed(1);
  const presets = [min, Math.round(min + (max - min) * 0.25), mid, Math.round(min + (max - min) * 0.75), max];
  return `
    <div class="servo-card entity-widget" id="${id}" ${data}>
      <div class="servo-header">
        <div class="servo-title"><i class="ti ${icon}"></i>${escapeHtml(entity.name)}</div>
        <div class="servo-angle"><span class="num">${def}</span><span class="deg">${unit}</span></div>
      </div>
      <div class="arc-wrap">
        <svg width="140" height="82" viewBox="0 0 140 82" role="img" aria-label="${escapeHtml(entity.name)}">
          <path class="arc-bg-s" d="M 12,70 A 58,58 0 0,1 128,70"/>
          <path class="arc-fill-s" d="M 12,70 A 58,58 0 0,1 128,70" stroke-dasharray="${ARC_LEN.toFixed(1)}" stroke-dashoffset="${offset}"/>
          <line class="needle-s" x1="70" y1="70" x2="70" y2="16" stroke="#b666ff" stroke-width="2" stroke-linecap="round"/>
          <circle cx="70" cy="70" r="4" fill="#8A2BE2"/>
          <text x="10" y="80" font-size="9" fill="#4a3f6b">${min}</text>
          <text x="62" y="12" font-size="9" fill="#4a3f6b">${mid}</text>
          <text x="118" y="80" font-size="9" fill="#4a3f6b" text-anchor="end">${max}</text>
        </svg>
      </div>
      <input type="range" class="entity-range" min="${min}" max="${max}" step="${step}" value="${def}" data-unit="${unit}">
      <div class="slider-ticks"><span>${min}${unit}</span><span>${mid}${unit}</span><span>${max}${unit}</span></div>
      <div class="presets">
        ${presets.map((p) => `<button class="preset entity-preset" data-angle="${p}">${p}${unit}</button>`).join('')}
      </div>
    </div>`;
}

function widgetHtml(device, entity, opts = {}) {
  const id = widgetId(device.deviceId, entity.id);
  const data = `data-device="${escapeHtml(device.deviceId)}" data-entity="${escapeHtml(entity.id)}" data-cap="${entity.capability}"`;
  const icon = entity.ui?.icon ? `<i class="ti ${escapeHtml(entity.ui.icon)}"></i>` : '';
  const label = `<span class="entity-label">${icon}${escapeHtml(entity.name)}</span>`;
  const currentVal = device.entityStates?.[entity.id];

  switch (entity.capability) {
    case 'range': {
      if (opts.gauge) return rangeGaugeHtml(device, entity);
      const min = Number(entity.min ?? 0);
      const max = Number(entity.max ?? 100);
      const step = Number(entity.step ?? 1);
      const def = Number(currentVal ?? entity.default ?? min);
      const unit = entity.unit ? escapeHtml(entity.unit) : '';
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}<span class="entity-val">${def}${unit}</span></div>
          <input type="range" class="entity-range" min="${min}" max="${max}" step="${step}" value="${def}" data-unit="${unit}">
        </div>`;
    }
    case 'switch': {
      const isOn = isOnPayload(entity, currentVal !== undefined ? currentVal : (entity.default ?? 'off'));
      const stateStr = isOn ? 'on' : 'off';
      const labelStr = isOn ? 'ON' : 'OFF';
      const activeClass = isOn ? 'active' : '';
      return `
        <div class="entity-widget" id="${id}" ${data} data-state="${stateStr}">
          <div class="entity-head">${label}
            <button type="button" class="entity-toggle ${activeClass}" aria-pressed="${isOn}">${labelStr}</button>
          </div>
        </div>`;
    }
    case 'button':
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}
            <button type="button" class="entity-press secondary-btn">Activar</button>
          </div>
        </div>`;
    case 'sensor': {
      const valStr = formatSensor(entity, currentVal);
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}<span class="entity-val entity-sensor">${escapeHtml(valStr)}</span></div>
          <canvas class="entity-chart" height="70" aria-label="Histórico ${escapeHtml(entity.name)}"></canvas>
        </div>`;
    }
    case 'text':
    default: {
      const valStr = currentVal !== undefined ? String(currentVal) : '--';
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}<span class="entity-val entity-text">${escapeHtml(valStr)}</span></div>
        </div>`;
    }
  }
}

function sortedEntities(device) {
  return (device.entities || [])
    .filter((e) => !e.ui?.hidden)
    .slice()
    .sort((a, b) => (a.ui?.order ?? 99) - (b.ui?.order ?? 99));
}

export function deviceEntitiesHtml(device) {
  if (!device.entityStates) {
    device.entityStates = {};
  }
  if (device.lastTelemetry && typeof device.lastTelemetry === 'object' && !Array.isArray(device.lastTelemetry)) {
    for (const [k, v] of Object.entries(device.lastTelemetry)) {
      device.entityStates[k] = v;
    }
  }
  const entities = sortedEntities(device);
  if (!entities.length) return '';
  return `<div class="entity-grid">${entities.map((e) => widgetHtml(device, e)).join('')}</div>`;
}

// Actualiza los indicadores de estado del HUB del brazo (en línea / modo de operación).
export function updateArmHub() {
  const brazo = (state.devices || []).find((d) => d.deviceId === 'brazo');
  const badge = document.getElementById('arm-status-badge');
  const statusText = document.getElementById('arm-status-text');
  if (badge && statusText) {
    const online = brazo?.status === 'online';
    badge.classList.toggle('is-online', online);
    badge.classList.toggle('is-offline', !online);
    statusText.textContent = online ? 'En línea' : 'Desconectado';
  }
  const modeText = document.getElementById('arm-mode-text');
  if (modeText) modeText.textContent = state.currentMode === 'auto' ? 'Automático' : 'Manual';
}

// Llena el grid de gauges del modal del brazo desde su modelo de entidades.
export function renderBrazoPanel() {
  const grid = document.getElementById('servo-grid');
  if (!grid) return;
  const brazo = (state.devices || []).find((d) => d.deviceId === 'brazo');
  updateArmHub();
  const ranges = sortedEntities(brazo || {}).filter((e) => e.capability === 'range');
  if (!ranges.length) return; // aún no cargó el brazo
  if (brazo) {
    if (!brazo.entityStates) {
      brazo.entityStates = {};
    }
    if (brazo.lastTelemetry && typeof brazo.lastTelemetry === 'object' && !Array.isArray(brazo.lastTelemetry)) {
      for (const [k, v] of Object.entries(brazo.lastTelemetry)) {
        brazo.entityStates[k] = v;
      }
    }
  }
  if (grid.childElementCount === ranges.length) return; // ya renderizado: evita churn mid-drag
  grid.innerHTML = ranges.map((e) => widgetHtml(brazo, e, { gauge: true })).join('');
}

// --- Estado entrante (MQTT) ---

export function applyEntityState(topic, payload) {
  const hit = stateTopicIndex.get(topic);
  if (!hit) return false;
  const { deviceId, entity } = hit;
  const el = document.getElementById(widgetId(deviceId, entity.id));
  if (!el) return false;
  const value = readPayloadValue(entity, payload);
  if (value === undefined) return false;

  const device = (state.devices || []).find((d) => d.deviceId === deviceId);
  if (device) {
    if (!device.entityStates) device.entityStates = {};
    device.entityStates[entity.id] = value;
  }

  switch (entity.capability) {
    case 'range': {
      const num = Number(value);
      if (!Number.isFinite(num)) break;
      const slider = el.querySelector('.entity-range');
      if (slider && document.activeElement !== slider) slider.value = num;
      updateRangeVisual(el, entity, num);
      break;
    }
    case 'switch':
      setToggleVisual(el, isOnPayload(entity, value));
      break;
    case 'sensor': {
      const valEl = el.querySelector('.entity-sensor');
      if (valEl) valEl.textContent = formatSensor(entity, value);
      pushChartPoint(widgetId(deviceId, entity.id), value);
      break;
    }
    case 'text': {
      const valEl = el.querySelector('.entity-text');
      if (valEl) valEl.textContent = String(value).slice(0, 120);
      break;
    }
    default:
      break;
  }
  return true;
}

function isOnPayload(entity, value) {
  const on = String(entity.onPayload ?? 'on').toLowerCase();
  return String(value).toLowerCase() === on || ['1', 'true', 'on'].includes(String(value).toLowerCase());
}

function setToggleVisual(el, on) {
  el.dataset.state = on ? 'on' : 'off';
  const btn = el.querySelector('.entity-toggle');
  if (btn) {
    btn.textContent = on ? 'ON' : 'OFF';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('active', on);
  }
}

// Actualiza la parte visual de un range: etiqueta compacta o gauge, mas resumen dash-*.
function updateRangeVisual(widget, entity, value) {
  const unit = entity.unit ? escapeHtml(entity.unit) : '';
  const valEl = widget.querySelector('.entity-val');
  if (valEl) valEl.textContent = `${value}${unit}`;
  if (widget.querySelector('.arc-fill-s')) {
    const min = Number(entity.min ?? 0);
    const max = Number(entity.max ?? 180);
    const frac = max > min ? (value - min) / (max - min) : 0;
    const num = widget.querySelector('.num');
    const arc = widget.querySelector('.arc-fill-s');
    const needle = widget.querySelector('.needle-s');
    if (num) num.textContent = value;
    if (arc) arc.style.strokeDashoffset = (ARC_LEN - frac * ARC_LEN).toFixed(1);
    if (needle) needle.style.transform = `rotate(${(-90 + frac * 180).toFixed(1)}deg)`;
  }
  // Resumen del dashboard (ids dash-<entityId> coinciden con las entidades del brazo).
  const dash = document.getElementById('dash-' + entity.id);
  if (dash) dash.textContent = `${value}${entity.unit || '°'}`;
  const dashbar = document.getElementById('dashbar-' + entity.id);
  if (dashbar) {
    const bmin = Number(entity.min ?? 0);
    const bmax = Number(entity.max ?? 180);
    const bfrac = bmax > bmin ? (value - bmin) / (bmax - bmin) : 0;
    dashbar.style.width = `${Math.max(0, Math.min(1, bfrac)) * 100}%`;
  }
}

// Actualización optimista para acciones que no vienen por slider (reset, automatizaciones).
export function optimisticRange(deviceId, entityId, value) {
  const el = document.getElementById(widgetId(deviceId, entityId));
  const found = findEntity(deviceId, entityId);
  if (!el || !found) return;
  const slider = el.querySelector('.entity-range');
  if (slider && document.activeElement !== slider) slider.value = value;
  updateRangeVisual(el, found.entity, Number(value));
}

// --- Gráficas (Chart.js) ---

function buildChart(canvas, key, entity, points) {
  if (!window.Chart) return;
  const existing = chartRegistry.get(key);
  if (existing) existing.destroy();
  const chart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: points.map((p) => new Date(p.t).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
      datasets: [{
        data: points.map((p) => p.v),
        borderColor: '#8A2BE2',
        backgroundColor: 'rgba(138,43,226,0.15)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { display: false },
        y: { ticks: { color: 'rgba(255,255,255,0.4)', maxTicksLimit: 4 }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });
  chartRegistry.set(key, chart);
}

function pushChartPoint(key, value) {
  const chart = chartRegistry.get(key);
  const num = Number(value);
  if (!chart || !Number.isFinite(num)) return;
  chart.data.labels.push(new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  chart.data.datasets[0].data.push(num);
  if (chart.data.labels.length > 40) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
  chart.update('none');
}

// Carga el histórico de telemetría y dibuja la gráfica de cada entidad sensor visible.
export async function hydrateEntityCharts() {
  if (!window.Chart) return;
  for (const device of state.devices || []) {
    for (const entity of device.entities || []) {
      if (entity.capability !== 'sensor') continue;
      const key = widgetId(device.deviceId, entity.id);
      if (chartRegistry.has(key)) continue; // ya construida: se actualiza en vivo
      const el = document.getElementById(key);
      const canvas = el?.querySelector('.entity-chart');
      if (!canvas) continue;
      try {
        const res = await api(`/devices/${device.deviceId}/telemetry?limit=40`);
        const rows = (res.telemetry || []).filter((r) => !entity.mqtt?.state || r.topic === entity.mqtt.state);
        const points = rows
          .map((r) => ({ t: r.receivedAt, v: Number(readPayloadValue(entity, r.payload)) }))
          .filter((p) => Number.isFinite(p.v))
          .reverse();
        buildChart(canvas, key, entity, points);
      } catch (e) { /* sin histórico: gráfica vacía hasta que llegue telemetría */ }
    }
  }
}

// --- Interacción (delegada, instalada una vez) ---

let controlsInitialized = false;

export function initEntityControls() {
  if (controlsInitialized) return;
  controlsInitialized = true;

  document.addEventListener('input', (event) => {
    const slider = event.target.closest?.('.entity-range');
    if (slider) onRangeInput(slider.closest('.entity-widget'), slider, false);
  });

  document.addEventListener('change', (event) => {
    const slider = event.target.closest?.('.entity-range');
    if (slider) onRangeInput(slider.closest('.entity-widget'), slider, true);
  });

  document.addEventListener('click', (event) => {
    const preset = event.target.closest?.('.entity-preset');
    if (preset) return onPresetClick(preset);
    const toggle = event.target.closest?.('.entity-toggle');
    if (toggle) return onToggleClick(toggle.closest('.entity-widget'));
    const press = event.target.closest?.('.entity-press');
    if (press) return onPressClick(press.closest('.entity-widget'));
  });
}

async function sendEntityControl(deviceId, entity, value) {
  const device = (state.devices || []).find((d) => d.deviceId === deviceId);
  if (device && device.type !== 'tuya' && device.type !== 'shelly') {
    if (entity.mqtt && entity.mqtt.set) {
      publish(entity.mqtt.set, value);
    }
    return;
  }

  try {
    const creds = {
      tuyaClientId: localStorage.getItem('tadashy_tuya_client_id') || '',
      tuyaSecret: localStorage.getItem('tadashy_tuya_secret') || '',
      shellyAuthKey: localStorage.getItem('tadashy_shelly_auth_key') || ''
    };
    await api(`/devices/${deviceId}/entities/${entity.id}/control`, {
      method: 'POST',
      body: JSON.stringify({ value, ...creds })
    });
  } catch (err) {
    console.error('[Entities] Error al controlar entidad por API:', err.message);
  }
}

function onRangeInput(widget, slider, force) {
  if (!widget) return;
  const { device, entity } = resolveWidget(widget);
  if (!entity) return;
  const key = `${device}:${entity.id}`;
  const now = Date.now();
  if (!force && now - (lastSent.get(key) || 0) <= INTERVALO) {
    updateRangeVisual(widget, entity, Number(slider.value));
    return;
  }
  lastSent.set(key, now);
  sendEntityControl(device, entity, slider.value);
  updateRangeVisual(widget, entity, Number(slider.value));
}

function onPresetClick(preset) {
  const widget = preset.closest('.entity-widget');
  if (!widget) return;
  const { device, entity } = resolveWidget(widget);
  if (!entity) return;
  const value = preset.dataset.angle;
  const slider = widget.querySelector('.entity-range');
  if (slider) slider.value = value;
  sendEntityControl(device, entity, value);
  updateRangeVisual(widget, entity, Number(value));
}

function onToggleClick(widget) {
  if (!widget) return;
  const { device, entity } = resolveWidget(widget);
  if (!entity) return;
  const goingOn = widget.dataset.state !== 'on';
  const payload = goingOn ? (entity.onPayload ?? 'on') : (entity.offPayload ?? 'off');
  sendEntityControl(device, entity, payload);
  if (entity.optimistic !== false) setToggleVisual(widget, goingOn);
}

function onPressClick(widget) {
  if (!widget) return;
  const { device, entity } = resolveWidget(widget);
  if (!entity) return;
  sendEntityControl(device, entity, entity.pressPayload ?? 'press');
}

function resolveWidget(widget) {
  const deviceId = widget.dataset.device;
  const entityId = widget.dataset.entity;
  const found = findEntity(deviceId, entityId);
  return { device: deviceId, entityId, entity: found?.entity || null };
}
