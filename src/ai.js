import { API, $, escapeHtml, state } from './state.js';
import { api } from './api.js';
import { addLog } from './logger.js';
import { hasPermission } from './auth.js';
import { publish } from './mqtt.js';
import { switchView } from './views.js';
import { discoverDevices } from './devices.js';
import { speakAi } from './voice.js';

export async function loadAiChat() {
  if (!hasPermission('ai_chat')) return;
  try {
    const cap = await api('/ai/capabilities');
    $('ai-info-model').textContent = cap.model || 'Desconocido';
    $('ai-info-endpoint').textContent = cap.ollamaUrl || 'Desconocido';
    $('ai-model-badge').innerHTML = `<i class="ti ti-brain"></i> ${cap.model || 'Mistral'}`;

    // Auto-reparación para navegadores con index.html atascado en caché (Service Workers viejos)
    const oldToolsList = $('ai-tools-list');
    if (oldToolsList) {
      const h4 = oldToolsList.previousElementSibling;
      if (h4 && h4.tagName === 'H4') h4.textContent = 'Comandos Rápidos';
      oldToolsList.outerHTML = `
        <div id="ai-quick-prompts" style="display: flex; flex-direction: column; gap: 10px;">
          <button class="quick-prompt-btn" data-prompt="¿Cuántos dispositivos hay conectados en la red y cuál es su estado?">
            <i class="ti ti-router"></i>
            <div class="quick-text">
              <strong>Escanear Red IoT</strong>
              <span>Estado de dispositivos</span>
            </div>
          </button>
          <button class="quick-prompt-btn" data-prompt="Muestra un resumen de las automatizaciones activas en este momento.">
            <i class="ti ti-logic-and"></i>
            <div class="quick-text">
              <strong>Automatizaciones</strong>
              <span>Reglas activas</span>
            </div>
          </button>
          <button class="quick-prompt-btn" data-prompt="Revisa la telemetría reciente del brazo robótico, ¿todo está bien?">
            <i class="ti ti-activity"></i>
            <div class="quick-text">
              <strong>Analizar Telemetría</strong>
              <span>Revisar métricas y alertas</span>
            </div>
          </button>
          <button class="quick-prompt-btn" data-prompt="Quiero enviar un comando físico al brazo robótico para mover el servo base a 90 grados.">
            <i class="ti ti-hand-grab"></i>
            <div class="quick-text">
              <strong>Control Robótico</strong>
              <span>Mover servos y hardware</span>
            </div>
          </button>
        </div>
      `;
    }

    // Habilitar clics en los botones de Comandos Rápidos
    document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
      btn.onclick = () => {
        const prompt = btn.getAttribute('data-prompt');
        if (prompt) {
          $('ai-chat-input').value = prompt;
          $('ai-chat-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      };
    });


    const histRes = await api('/ai/history?sessionId=default');
    const container = $('ai-chat-messages');
    container.innerHTML = '';

    if (!histRes.history || histRes.history.length === 0) {
      appendAiChatMessage('assistant', 'Hola, soy el Asistente TADASHY AI. ¿En qué puedo ayudarte con el sistema IoT hoy?');
    } else {
      histRes.history.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') {
          if (msg.role === 'assistant' && !msg.content && msg.metadata?.tool_calls) {
            return;
          }
          appendAiChatMessage(msg.role, msg.content);
        }
      });
    }
  } catch (err) {
    console.error("Error al cargar capabilities de IA:", err);
  }
}

export function updateAiMetrics(calls, tokens) {
  state.aiCallsSaved += calls;
  state.aiTokensSaved += tokens;
  if ($('ai-calls-saved')) $('ai-calls-saved').textContent = state.aiCallsSaved;
  if ($('ai-tokens-saved')) $('ai-tokens-saved').textContent = `~${state.aiTokensSaved}`;
}

export function handleQuickCommand(cmd, options) {
  updateAiMetrics(1, 150);
  let reply = '';

  if (cmd.includes('robot') || cmd === '/robot') {
    reply = `
      <b>🤖 Menú: Brazo Robótico</b><br><br>
      Elige una acción rápida:<br>
      <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-primary" onclick="window.executeBotAction('robot_start')" style="justify-content:center;">Posición Inicio</button>
        <button class="btn" onclick="window.executeBotAction('robot_rest')" style="justify-content:center;">Posición Reposo</button>
        <button class="btn" onclick="window.executeBotAction('robot_open')" style="justify-content:center;">Abrir Pinza</button>
        <button class="btn" onclick="window.executeBotAction('robot_close')" style="justify-content:center;">Cerrar Pinza</button>
      </div>
    `;
  } else if (cmd.includes('dispositivos') || cmd === '/dispositivos') {
    reply = `
      <b>🔌 Dispositivos</b><br><br>
      Total registrados: ${state.devices.length}<br>
      <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-primary" onclick="window.executeBotAction('nav_devices')" style="justify-content:center;">Ir a Dispositivos</button>
        <button class="btn" onclick="window.executeBotAction('devices_scan')" style="justify-content:center;">Escanear Red</button>
      </div>
    `;
  } else {
    reply = `
      <b>🤖 TADASHY Assistant</b><br>
      <i>Modo Comandos Rápidos</i><br><br>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn" onclick="window.sendAiMessage('/dispositivos')" style="justify-content:center;">🔌 Dispositivos</button>
        <button class="btn" onclick="window.sendAiMessage('/robot')" style="justify-content:center;">🤖 Brazo Robótico</button>
        <button class="btn" onclick="window.executeBotAction('nav_auto')" style="justify-content:center;">⚡ Automatizaciones</button>
        <button class="btn" onclick="window.executeBotAction('nav_mqtt')" style="justify-content:center;">📡 Estado MQTT</button>
      </div>
    `;
  }

  appendAiChatMessage('assistant', reply, true);
  if (options?.speak) speakAi("Menú rápido mostrado.");
  return reply;
}

export function executeBotAction(action) {
  updateAiMetrics(1, 50);
  switch (action) {
    case 'robot_start': publish('brazo/posicion', 'start'); addLog('Bot: Brazo a posición Inicio', 'ok'); appendAiChatMessage('assistant', 'Brazo enviado a posición de inicio.'); break;
    case 'robot_rest': publish('brazo/posicion', 'rest'); addLog('Bot: Brazo a posición Reposo', 'inf'); appendAiChatMessage('assistant', 'Brazo enviado a reposo.'); break;
    case 'robot_open': publish('brazo/servo/4', '0'); appendAiChatMessage('assistant', 'Pinza abierta.'); break;
    case 'robot_close': publish('brazo/servo/4', '180'); appendAiChatMessage('assistant', 'Pinza cerrada.'); break;
    case 'nav_devices': switchView('devices'); break;
    case 'devices_scan': discoverDevices(); appendAiChatMessage('assistant', 'Escaneo de red iniciado.'); break;
    case 'nav_auto': switchView('automations'); break;
    case 'nav_mqtt': switchView('mqtt'); break;
  }
}

export async function sendAiMessage(messageText, options = {}) {
  const messagesContainer = $('ai-chat-messages');
  appendAiChatMessage('user', messageText);

  const txtLower = messageText.toLowerCase().trim();
  if (txtLower.startsWith('/') || ['comandos', 'menu', 'ayuda'].includes(txtLower)) {
    return handleQuickCommand(txtLower, options);
  }


  const assistantBubble = appendAiChatMessage('assistant', '');
  const loadingEl = document.createElement('span');
  loadingEl.className = 'ai-loading-dots';
  loadingEl.innerHTML = '<span>.</span><span>.</span><span>.</span>';
  assistantBubble.appendChild(loadingEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const res = await fetch(API + '/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.auth.token}`
      },
      body: JSON.stringify({
        message: messageText,
        stream: true,
        sessionId: options.sessionId || 'default',
        channel: options.channel || 'text'
      })
    });

    if (!res.ok) {
      let errData = {};
      try { errData = await res.json(); } catch(e) {}
      throw new Error(errData.error || `HTTP ${res.status}: Servidor no disponible (¿Node.js apagado o sin conexión a Ollama?)`);
    }

    loadingEl.remove();

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';
    let confirmationText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              accumulatedText += data.text;
              assistantBubble.textContent = accumulatedText;
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
            if (data.requiresConfirmation) {
              loadingEl.remove();
              createConfirmationCard(assistantBubble, data.confirmationToken, data.action);
              confirmationText = data.reason === 'critical_device_action'
                ? 'La accion requiere confirmacion humana antes de ejecutarse.'
                : 'Se requiere confirmacion.';
            }
            if (data.error) {
              assistantBubble.textContent = `Error: ${data.error}`;
              assistantBubble.classList.add('bubble-err');
            }
          } catch (err) {
          }
        }
      }
    }
    const finalText = accumulatedText || confirmationText;
    if (options.speak && finalText) speakAi(finalText);
    return finalText;
  } catch (err) {
    loadingEl.remove();
    assistantBubble.textContent = `Error: ${err.message}`;
    assistantBubble.classList.add('bubble-err');
    if (options.speak) speakAi(`Error: ${err.message}`);
    return '';
  }
}

export function appendAiChatMessage(role, content, isHtml = false) {
  const container = $('ai-chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble bubble-${role}`;

  const avatar = document.createElement('div');
  avatar.className = `chat-avatar avatar-${role}`;
  avatar.innerHTML = role === 'user' ? '<span class="material-symbols-outlined" style="font-size:18px;">person</span>' : '<span class="material-symbols-outlined" style="font-size:18px;">smart_toy</span>';

  const body = document.createElement('div');
  body.className = 'chat-body';
  if (isHtml) {
    body.innerHTML = content;
  } else {
    body.textContent = content;
  }

  bubble.appendChild(avatar);
  bubble.appendChild(body);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return body;
}

export function createConfirmationCard(container, token, action) {
  // Traducir acciones técnicas a lenguaje natural
  const actionNames = {
    'stopAutomation': 'Detener Automatización',
    'startAutomation': 'Iniciar Automatización',
    'toggleAutomation': 'Alternar estado de Automatización',
    'sendCommand': 'Enviar comando físico al dispositivo',
    'updateDeviceConfiguration': 'Modificar configuración del dispositivo'
  };

  const readableAction = actionNames[action.tool] || action.tool;

  // Formatear argumentos a lista amigable
  let argsHtml = '';
  if (action.arguments && Object.keys(action.arguments).length > 0) {
    argsHtml = '<ul style="margin:0; padding-left:16px; list-style-type:circle; color: var(--text-primary);">';
    for (const [key, val] of Object.entries(action.arguments)) {
      const readableKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      argsHtml += `<li style="margin-bottom:4px;"><strong style="color:var(--accent-ai);">${escapeHtml(readableKey)}:</strong> ${escapeHtml(String(val))}</li>`;
    }
    argsHtml += '</ul>';
  } else {
    argsHtml = '<span style="color:var(--text-muted);">Sin parámetros específicos</span>';
  }

  const card = document.createElement('div');
  card.className = 'ai-confirm-card';
  card.innerHTML = `
    <div class="confirm-card-title"><i class="ti ti-alert-triangle"></i> Autorización de Seguridad Requerida</div>
    <div class="confirm-card-details" style="background: rgba(0,0,0,0.2); border: none; border-left: 3px solid var(--accent-ai); padding: 12px 16px; border-radius: 4px;">
      <p style="margin: 0 0 10px 0; color: #fff; font-size: 14px;"><strong>Tadashy quiere:</strong> ${escapeHtml(readableAction)}</p>
      <div style="font-size: 13px; color: var(--text-secondary);">
        <p style="margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">Detalles de la orden:</p>
        ${argsHtml}
      </div>
    </div>
    <div class="confirm-card-actions">
      <button class="confirm-btn-yes"><i class="ti ti-check"></i> Aprobar Acción</button>
      <button class="confirm-btn-no"><i class="ti ti-x"></i> Rechazar</button>
    </div>
  `;

  container.appendChild(card);

  const yesBtn = card.querySelector('.confirm-btn-yes');
  const noBtn = card.querySelector('.confirm-btn-no');

  yesBtn.addEventListener('click', async () => {
    yesBtn.disabled = true;
    noBtn.disabled = true;
    yesBtn.textContent = 'Ejecutando...';

    try {
      const confirmRes = await api('/ai/confirm', {
        method: 'POST',
        body: JSON.stringify({ token })
      });

      card.className = 'ai-confirm-card confirmed';
      card.innerHTML = `
        <div class="confirm-card-success">
          <i class="ti ti-circle-check"></i>
          <span>Acción ejecutada con éxito.</span>
        </div>
      `;

      appendAiChatMessage('assistant', confirmRes.message);
      speakAi(confirmRes.message);
    } catch (err) {
      card.className = 'ai-confirm-card error';
      card.innerHTML = `
        <div class="confirm-card-error">
          <i class="ti ti-circle-x"></i>
          <span>Error de ejecución: ${escapeHtml(err.message)}</span>
        </div>
      `;
    }
  });

  noBtn.addEventListener('click', () => {
    yesBtn.disabled = true;
    noBtn.disabled = true;
    card.className = 'ai-confirm-card cancelled';
    card.innerHTML = `
      <div class="confirm-card-cancelled">
        <i class="ti ti-circle-minus"></i>
        <span>Acción cancelada por el usuario.</span>
      </div>
    `;
  });
}
