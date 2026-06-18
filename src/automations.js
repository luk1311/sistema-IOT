import { $, escapeHtml, state } from './state.js';
import { addLog } from './logger.js';
import { api, saveHistory } from './api.js';
import { hasPermission } from './auth.js';
import { setModo, irA } from './robot.js';
import { publish } from './mqtt.js';
import { loadHistory } from './history.js';

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadAutomations() {
  try {
    const data = await api('/automations');
    state.automations = data.automations || [];
    $('auto-total').textContent = state.automations.length;

    if (state.automations.length === 0) {
      $('automation-list').innerHTML = `<div class="empty-state">No hay rutinas creadas</div>`;
      return;
    }

    $('automation-list').innerHTML = state.automations.map((item) => `
      <div class="item-row">
        <div><div class="row-title">${escapeHtml(item.name)}</div><div class="row-meta">${item.steps.length} pasos</div></div>
        <button class="secondary-btn" data-run-auto="${item.id}"><span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span> Ejecutar</button>
      </div>`).join('');
  } catch (err) {
    $('automation-list').innerHTML = `<div class="empty-state" style="color: var(--accent-offline-strong);">Error al cargar rutinas: ${escapeHtml(err.message)}</div>`;
  }
}

export async function createAutomation(event) {
  event.preventDefault();
  try {
    const container = document.getElementById('visual-steps-container');
    if (!container) return;

    const cards = container.querySelectorAll('.step-card');
    const steps = [];
    cards.forEach(card => {
      const action = card.querySelector('.step-action').value;
      const delay = parseInt(card.querySelector('.step-delay').value);

      if (action.startsWith('servo_')) {
        const servoIdx = parseInt(action.replace('servo_', ''));
        const value = parseInt(card.querySelector('.step-value').value);
        steps.push({
          servo: servoIdx,
          angle: isNaN(value) ? 90 : value,
          delay: isNaN(delay) ? 0 : delay
        });
      } else if (action === 'wait') {
        steps.push({
          delay: isNaN(delay) ? 1000 : delay
        });
      } else if (action === 'topic') {
        const payloadStr = card.querySelector('.step-value').value;
        const topicName = card.querySelector('.step-topic-input').value;
        if (topicName) {
          steps.push({
            topic: topicName,
            payload: payloadStr,
            delay: isNaN(delay) ? 0 : delay
          });
        }
      }
    });

    if (steps.length === 0) return addLog('Añade al menos un paso a la rutina', 'warn');

    await api('/automations', {
      method: 'POST',
      body: JSON.stringify({ name: $('auto-name').value.trim(), steps })
    });

    event.target.reset();
    container.innerHTML = '';
    addVisualStep();

    await loadAutomations();
    saveHistory('automation', 'Automatización guardada');
    addLog('Automatización guardada exitosamente', 'ok');
  } catch (error) {
    addLog(`Error al guardar automatización: ${error.message}`, 'err');
  }
}

export async function runAutomation(id) {
  if (!hasPermission('run_automations')) return addLog('No tienes permiso para ejecutar automatizaciones', 'err');
  const item = state.automations.find((automation) => automation.id === id);
  if (!item) return;
  setModo('auto');
  addLog(`Ejecutando ${item.name}`, 'dev');
  await api(`/automations/${id}/run`, { method: 'POST' });
  for (const step of item.steps) {
    await wait(Number(step.delay) || 250);
    if (step.topic) publish(step.topic, JSON.stringify(step.payload ?? ''));
    if (step.servo && Number.isFinite(Number(step.angle))) irA(Number(step.servo), Number(step.angle));
  }
  addLog(`Automatización finalizada: ${item.name}`, 'ok');
  await loadHistory();
}

// --- Visual Automation Builder ---
let visualStepCount = 0;

export function addVisualStep() {
  const container = document.getElementById('visual-steps-container');
  if (!container) return;

  const stepId = `step-${visualStepCount++}`;
  const stepCard = document.createElement('div');
  stepCard.className = 'step-card';
  stepCard.id = stepId;

  stepCard.innerHTML = `
    <div class="step-row">
      <select class="input-futuristic step-action" style="margin: 0; padding: 8px;" onchange="handleStepActionChange('${stepId}')">
        <option value="servo_1">Mover Base (Servo 1)</option>
        <option value="servo_2">Mover Hombro (Servo 2)</option>
        <option value="servo_3">Mover Codo (Servo 3)</option>
        <option value="servo_4">Mover Muñeca (Servo 4)</option>
        <option value="wait">Esperar (Pausa)</option>
        <option value="topic">Enviar Mensaje (MQTT)</option>
      </select>

      <div class="step-dynamic-inputs" style="flex: 1; display: flex; gap: 8px;">
        <input type="number" class="input-futuristic step-value" placeholder="Ángulo (0-180)" min="0" max="180" style="margin: 0; padding: 8px;" required>
        <input type="text" class="input-futuristic step-topic-input" placeholder="Tópico (ej. brazo/luz)" style="margin: 0; padding: 8px; display: none;">
      </div>

      <button type="button" class="step-delete-btn" onclick="document.getElementById('${stepId}').remove()" title="Eliminar paso">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>
    <div class="step-row" style="margin-top: 4px;">
      <span style="font-size: 13px; color: var(--text-muted); width: 140px; display: inline-flex; align-items: center; gap: 4px;"><span class="material-symbols-outlined" style="font-size: 16px;">timer</span> Espera antes del sgte:</span>
      <input type="number" class="input-futuristic step-delay" placeholder="ms" value="1000" min="0" style="margin: 0; padding: 6px; width: 80px;" required>
    </div>
  `;

  container.appendChild(stepCard);
}

export function handleStepActionChange(stepId) {
  const card = document.getElementById(stepId);
  if (!card) return;
  const action = card.querySelector('.step-action').value;
  const valueInput = card.querySelector('.step-value');
  const topicInput = card.querySelector('.step-topic-input');

  if (action.startsWith('servo_')) {
    valueInput.style.display = 'block';
    valueInput.type = 'number';
    valueInput.placeholder = 'Ángulo (0-180)';
    valueInput.required = true;
    topicInput.style.display = 'none';
    topicInput.required = false;
  } else if (action === 'wait') {
    valueInput.style.display = 'none';
    valueInput.required = false;
    topicInput.style.display = 'none';
    topicInput.required = false;
  } else if (action === 'topic') {
    valueInput.style.display = 'block';
    valueInput.type = 'text';
    valueInput.placeholder = 'Mensaje (Payload)';
    valueInput.required = false;
    topicInput.style.display = 'block';
    topicInput.required = true;
  }
}
