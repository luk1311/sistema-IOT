// Frontend de reglas de automatización (Fase 3).
import { $, state, escapeHtml } from './state.js';
import { api } from './api.js';
import { addLog } from './logger.js';

let rules = [];

const sensorEntities = (device) => (device.entities || []).filter((e) => e.capability === 'sensor');
const settableEntities = (device) => (device.entities || []).filter((e) => ['switch', 'range', 'button'].includes(e.capability));
const deviceOptions = () => (state.devices || []).map((d) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.name || d.deviceId)}</option>`).join('');

export async function loadRules() {
  const panel = $('rules-panel');
  if (!panel) return;
  renderRuleForm(panel);
  try {
    const res = await api('/rules');
    rules = res.rules || [];
    renderRuleList();
  } catch (e) {
    const list = $('rule-list');
    if (list) list.innerHTML = `<div class="empty-state">No se pudieron cargar las reglas: ${escapeHtml(e.message)}</div>`;
  }
}

function renderRuleForm(panel) {
  panel.innerHTML = `
    <div class="glass-panel panel-p-lg rules-card">
      <h3 class="font-outfit" style="margin-bottom: 16px; font-size: 18px;">Reglas automáticas</h3>
      <form id="rule-form" class="rule-form">
        <input type="text" id="rule-name" class="input-futuristic" placeholder="Nombre de la regla (ej. Ventilador por calor)" required>
        <div class="rule-row">
          <span class="rule-kw">SI</span>
          <select id="rule-trig-device" class="input-futuristic"></select>
          <select id="rule-trig-entity" class="input-futuristic"></select>
          <select id="rule-op" class="input-futuristic" style="max-width: 80px;">
            <option value="&gt;">&gt;</option>
            <option value="&lt;">&lt;</option>
            <option value="&gt;=">&ge;</option>
            <option value="&lt;=">&le;</option>
            <option value="==">=</option>
            <option value="!=">&ne;</option>
          </select>
          <input type="text" id="rule-value" class="input-futuristic" placeholder="valor" required style="max-width: 90px;">
        </div>
        <div class="rule-row">
          <span class="rule-kw">ENTONCES</span>
          <select id="rule-act-device" class="input-futuristic"></select>
          <select id="rule-act-entity" class="input-futuristic"></select>
          <input type="text" id="rule-act-value" class="input-futuristic" placeholder="valor (ON / 90 / …)" style="max-width: 130px;">
        </div>
        <button type="submit" class="btn btn-primary" style="justify-content: center;">Crear regla</button>
      </form>
      <div id="rule-list" class="rule-list" style="margin-top: 16px; display: flex; flex-direction: column;"></div>
    </div>`;

  const trigDev = $('rule-trig-device');
  const actDev = $('rule-act-device');
  trigDev.innerHTML = deviceOptions();
  actDev.innerHTML = deviceOptions();

  const fillTrig = () => {
    const d = (state.devices || []).find((x) => x.deviceId === trigDev.value);
    $('rule-trig-entity').innerHTML = (d ? sensorEntities(d) : []).map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
  };
  const fillAct = () => {
    const d = (state.devices || []).find((x) => x.deviceId === actDev.value);
    $('rule-act-entity').innerHTML = (d ? settableEntities(d) : []).map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} (${e.capability})</option>`).join('');
  };
  trigDev.addEventListener('change', fillTrig);
  actDev.addEventListener('change', fillAct);
  fillTrig();
  fillAct();

  $('rule-form').addEventListener('submit', createRule);
}

function renderRuleList() {
  const list = $('rule-list');
  if (!list) return;
  if (!rules.length) {
    list.innerHTML = '<div class="empty-state">No hay reglas creadas</div>';
    return;
  }
  list.innerHTML = rules.map((r) => {
    const t = r.trigger || {};
    const a = (r.actions || [])[0] || {};
    const cond = `${t.deviceId}.${t.entityId} ${t.op} ${t.value}`;
    const act = a.type === 'command' ? `comando ${a.command} → ${a.deviceId}` : `${a.deviceId}.${a.entityId} = ${a.value}`;
    return `
      <div class="item-row">
        <div>
          <div class="row-title">${escapeHtml(r.name)}</div>
          <div class="row-meta">SI ${escapeHtml(cond)} → ${escapeHtml(act)}</div>
        </div>
        <div class="flex-row">
          <button class="ghost-btn" data-toggle-rule="${r.id}">${r.enabled ? 'Activa' : 'Inactiva'}</button>
          <button class="ghost-btn" style="color: var(--accent-offline-strong); padding: 4px;" data-delete-rule="${r.id}"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-toggle-rule]').forEach((b) => b.addEventListener('click', () => toggleRule(b.dataset.toggleRule)));
  list.querySelectorAll('[data-delete-rule]').forEach((b) => b.addEventListener('click', () => deleteRule(b.dataset.deleteRule)));
}

function toNum(v) {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) ? n : v;
}

async function createRule(event) {
  event.preventDefault();
  const entityId = $('rule-trig-entity').value;
  const actEntity = $('rule-act-entity').value;
  if (!entityId) return addLog('La regla necesita una entidad sensor de disparo', 'err');
  if (!actEntity) return addLog('La regla necesita una entidad de acción', 'err');

  const rule = {
    name: $('rule-name').value.trim(),
    trigger: {
      deviceId: $('rule-trig-device').value,
      entityId,
      op: $('rule-op').value,
      value: toNum($('rule-value').value.trim())
    },
    actions: [{
      type: 'entity_set',
      deviceId: $('rule-act-device').value,
      entityId: actEntity,
      value: toNum($('rule-act-value').value.trim())
    }]
  };

  try {
    await api('/rules', { method: 'POST', body: JSON.stringify(rule) });
    await loadRules();
    addLog(`Regla "${rule.name}" creada`, 'ok');
  } catch (e) {
    addLog('Error al crear regla: ' + e.message, 'err');
  }
}

async function toggleRule(id) {
  const r = rules.find((x) => x.id === id);
  if (!r) return;
  try {
    await api(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !r.enabled }) });
    await loadRules();
  } catch (e) {
    addLog('Error: ' + e.message, 'err');
  }
}

async function deleteRule(id) {
  if (!confirm('¿Eliminar esta regla permanentemente?')) return;
  try {
    await api(`/rules/${id}`, { method: 'DELETE' });
    await loadRules();
    addLog('Regla eliminada', 'ok');
  } catch (e) {
    addLog('Error: ' + e.message, 'err');
  }
}
