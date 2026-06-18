// Renderizador genérico de widgets por capacidad (Fase 1).
// Convierte device.entities en controles vivos, sin lógica específica de "servos".
// Ver docs/entity-model.md.
import { escapeHtml, state, INTERVALO } from './state.js';
import { publish } from './mqtt.js';

// Índice: tópico de estado -> { deviceId, entity }, para resolver MQTT entrante rápido.
let stateTopicIndex = new Map();
// Throttle por entidad para sliders (igual que el control del brazo).
const lastSent = new Map();

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

function widgetHtml(device, entity) {
  const id = widgetId(device.deviceId, entity.id);
  const data = `data-device="${escapeHtml(device.deviceId)}" data-entity="${escapeHtml(entity.id)}" data-cap="${entity.capability}"`;
  const icon = entity.ui?.icon ? `<i class="ti ${escapeHtml(entity.ui.icon)}"></i>` : '';
  const label = `<span class="entity-label">${icon}${escapeHtml(entity.name)}</span>`;

  switch (entity.capability) {
    case 'range': {
      const min = Number(entity.min ?? 0);
      const max = Number(entity.max ?? 100);
      const step = Number(entity.step ?? 1);
      const def = Number(entity.default ?? min);
      const unit = entity.unit ? escapeHtml(entity.unit) : '';
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}<span class="entity-val">${def}${unit}</span></div>
          <input type="range" class="entity-range" min="${min}" max="${max}" step="${step}" value="${def}" data-unit="${unit}">
        </div>`;
    }
    case 'switch':
      return `
        <div class="entity-widget" id="${id}" ${data} data-state="off">
          <div class="entity-head">${label}
            <button type="button" class="entity-toggle" aria-pressed="false">OFF</button>
          </div>
        </div>`;
    case 'button':
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}
            <button type="button" class="entity-press secondary-btn">Activar</button>
          </div>
        </div>`;
    case 'sensor':
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}<span class="entity-val entity-sensor">--</span></div>
        </div>`;
    case 'text':
    default:
      return `
        <div class="entity-widget" id="${id}" ${data}>
          <div class="entity-head">${label}<span class="entity-val entity-text">--</span></div>
        </div>`;
  }
}

export function deviceEntitiesHtml(device) {
  const entities = (device.entities || [])
    .filter((e) => !e.ui?.hidden)
    .slice()
    .sort((a, b) => (a.ui?.order ?? 99) - (b.ui?.order ?? 99));
  if (!entities.length) return '';
  return `<div class="entity-grid">${entities.map((e) => widgetHtml(device, e)).join('')}</div>`;
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

  switch (entity.capability) {
    case 'range': {
      const slider = el.querySelector('.entity-range');
      const valEl = el.querySelector('.entity-val');
      const num = Number(value);
      if (Number.isFinite(num)) {
        if (slider && document.activeElement !== slider) slider.value = num;
        if (valEl) valEl.textContent = `${num}${entity.unit ? escapeHtml(entity.unit) : ''}`;
      }
      break;
    }
    case 'switch': {
      const on = isOnPayload(entity, value);
      setToggleVisual(el, on);
      break;
    }
    case 'sensor': {
      const valEl = el.querySelector('.entity-sensor');
      if (valEl) valEl.textContent = formatSensor(entity, value);
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

// --- Interacción (delegada, instalada una vez) ---

let controlsInitialized = false;

export function initEntityControls() {
  if (controlsInitialized) return;
  controlsInitialized = true;

  document.addEventListener('input', (event) => {
    const slider = event.target.closest?.('.entity-range');
    if (!slider) return;
    const widget = slider.closest('.entity-widget');
    onRangeInput(widget, slider, false);
  });

  document.addEventListener('change', (event) => {
    const slider = event.target.closest?.('.entity-range');
    if (!slider) return;
    const widget = slider.closest('.entity-widget');
    onRangeInput(widget, slider, true);
  });

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest?.('.entity-toggle');
    if (toggle) return onToggleClick(toggle.closest('.entity-widget'));
    const press = event.target.closest?.('.entity-press');
    if (press) return onPressClick(press.closest('.entity-widget'));
  });
}

function onRangeInput(widget, slider, force) {
  if (!widget) return;
  const { device, entityId, entity } = resolveWidget(widget);
  if (!entity?.mqtt?.set) return;
  const key = `${device}:${entityId}`;
  const now = Date.now();
  if (!force && now - (lastSent.get(key) || 0) <= INTERVALO) {
    updateRangeLabel(widget, slider, entity);
    return;
  }
  lastSent.set(key, now);
  publish(entity.mqtt.set, slider.value);
  updateRangeLabel(widget, slider, entity);
}

function updateRangeLabel(widget, slider, entity) {
  const valEl = widget.querySelector('.entity-val');
  if (valEl) valEl.textContent = `${slider.value}${entity.unit ? escapeHtml(entity.unit) : ''}`;
}

function onToggleClick(widget) {
  if (!widget) return;
  const { entity } = resolveWidget(widget);
  if (!entity?.mqtt?.set) return;
  const goingOn = widget.dataset.state !== 'on';
  const payload = goingOn ? (entity.onPayload ?? 'on') : (entity.offPayload ?? 'off');
  publish(entity.mqtt.set, payload);
  if (entity.optimistic !== false) setToggleVisual(widget, goingOn);
}

function onPressClick(widget) {
  if (!widget) return;
  const { entity } = resolveWidget(widget);
  if (!entity?.mqtt?.set) return;
  publish(entity.mqtt.set, entity.pressPayload ?? 'press');
}

function resolveWidget(widget) {
  const deviceId = widget.dataset.device;
  const entityId = widget.dataset.entity;
  const found = findEntity(deviceId, entityId);
  return { device: deviceId, entityId, entity: found?.entity || null };
}
