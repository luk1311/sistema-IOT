import { $, escapeHtml, state } from './state.js';
import { addLog } from './logger.js';
import { api, saveHistory } from './api.js';
import { hasPermission } from './auth.js';
import { updateAngle } from './robot.js';
import { refreshDevicesSoon } from './devices.js';
import { applyEntityState } from './entities.js';

export async function publish(topic, payload) {
  if (!hasPermission('mqtt_publish')) {
    addLog('No tienes permiso para publicar MQTT', 'err');
    return false;
  }

  if (state.client && state.client.connected) {
    state.client.publish(topic, String(payload));
    state.pubTotal++;
    $('pub-total').textContent = state.pubTotal;
    saveHistory('mqtt_publish', `Publicado en ${topic}`, { topic, payload });
    return true;
  }

  // Si no es super_admin con conexión directa, pasar por el backend
  try {
    const res = await api('/mqtt/publish', {
      method: 'POST',
      body: JSON.stringify({ topic, payload: String(payload) })
    });
    if (res.success) {
      state.pubTotal++;
      $('pub-total').textContent = state.pubTotal;
      return true;
    }
  } catch (err) {
    addLog(`Error publicando: ${err.message}`, 'err');
  }
  return false;
}

export function setDevice(online) {
  $('device-badge').className = online ? 'badge badge-dev-on' : 'badge badge-dev-off';
  $('device-badge').innerHTML = online ? '<i class="ti ti-cpu"></i> ESP32 conectado' : '<i class="ti ti-cpu"></i> ESP32 sin señal';
  $('last-seen').textContent = online ? `Último dato ${new Date().toLocaleTimeString('es-CO')}` : 'Sin datos';
  clearTimeout(state.deviceTimer);
  if (online) state.deviceTimer = setTimeout(() => setDevice(false), 6000);
}

export function conectarMqtt(event) {
  event.preventDefault();
  if (!hasPermission('mqtt_status')) return addLog('No tienes permiso para conectar MQTT', 'err');

  const host = $('mqtt-host').value.trim();
  const port = $('mqtt-port').value.trim();
  const username = $('mqtt-user').value.trim();
  const password = $('mqtt-pass').value;
  if (!host || !port || !username || !password) return addLog('Completa los datos MQTT', 'err');

  connectMqtt({ host, port, username, password });
}

export function connectMqtt({ host, port, username, password }) {
  if (!hasPermission('mqtt_status')) return false;
  if (!host || !port || !username || !password) return false;
  if (state.client?.connected) return true;

  localStorage.setItem('tadashy_mqtt', JSON.stringify({ host, port, username, password }));
  if (state.client) state.client.end(true);

  state.client = window.mqtt.connect(`wss://${host}:${port}/mqtt`, {
    username,
    password,
    clientId: `tadashy_web_${Math.random().toString(16).slice(2, 8)}`,
    connectTimeout: 10000,   // Aumentado a 10s para redes lentas
    reconnectPeriod: 3000,   // Un respiro más largo antes de reconectar
    keepalive: 0,            // DESACTIVADO (0): El broker/proxy no corta la conexión por falta de PING
    clean: true,             // Sesión limpia
    resubscribe: true,       // Asegurar que reconecta las suscripciones
    protocolVersion: 4       // Compatibilidad robusta con Mosquitto/HiveMQ
  });

  state.client.on('connect', () => {
    $('conn-badge').className = 'badge badge-ok';
    $('conn-badge').innerHTML = '<i class="ti ti-wifi"></i> MQTT conectado';
    state.client.subscribe('brazo/#');
    state.client.subscribe('devices/#');
    state.client.subscribe('tadashy/#');
    addLog('Broker MQTT conectado', 'ok');
    saveHistory('mqtt_connect', `Conexión MQTT a ${host}`);
  });

  state.client.on('offline', () => {
    $('conn-badge').className = 'badge badge-warn';
    $('conn-badge').innerHTML = '<i class="ti ti-wifi-off"></i> MQTT desconectado';
    addLog('Broker MQTT desconectado', 'err');
  });

  state.client.on('error', (error) => {
    $('conn-badge').className = 'badge badge-err';
    $('conn-badge').innerHTML = '<i class="ti ti-alert-triangle"></i> Error MQTT';
    addLog(`Error MQTT: ${error.message || 'sin detalle'}`, 'err');
  });

  state.client.on('message', onMqttMessage);
  return true;
}

export function disconnectMqtt() {
  if (state.client) state.client.end(true);
  state.client = null;
  $('conn-badge').className = 'badge badge-warn';
  $('conn-badge').innerHTML = '<i class="ti ti-wifi-off"></i> MQTT desconectado';
}

export function onMqttMessage(topic, payloadBuffer) {
  const payload = payloadBuffer.toString();
  state.mqttTotal++;
  $('mqtt-total').textContent = state.mqttTotal;
  addMqttRow(topic, payload);
  setDevice(topic === 'brazo/status' ? payload === 'online' : true);

  // Widgets genéricos por entidad (resuelve contra entity.mqtt.state).
  applyEntityState(topic, payload);

  const deviceTopic = topic.match(/^devices\/([^/]+)\/(status|telemetry|config)$/);
  if (deviceTopic) refreshDevicesSoon();

  const match = topic.match(/^brazo\/servo\/feedback\/(\d)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    const angle = parseInt(payload, 10);
    if (idx >= 1 && idx <= 4 && angle >= 0 && angle <= 180) {
      updateAngle(idx, angle);
      const slider = $(`slider${idx}`);
      if (slider && document.activeElement !== slider) slider.value = angle;
    }
  }
}

export function addMqttRow(topic, payload) {
  if (topic === state.lastMqttTopic && payload === state.lastMqttPayload && state.lastMqttRow) {
    state.lastMqttCount++;
    state.lastMqttRow.innerHTML = `<span class="row-meta">${new Date().toLocaleTimeString('es-CO')}</span><span class="topic">${escapeHtml(topic)}</span><span class="payload">${escapeHtml(payload)} <span style="opacity:0.6">(${state.lastMqttCount}x)</span></span>`;
    return;
  }

  state.lastMqttTopic = topic;
  state.lastMqttPayload = payload;
  state.lastMqttCount = 1;
  const row = document.createElement('div');
  row.className = 'message-row';
  row.innerHTML = `<span class="row-meta">${new Date().toLocaleTimeString('es-CO')}</span><span class="topic">${escapeHtml(topic)}</span><span class="payload">${escapeHtml(payload)}</span>`;
  state.lastMqttRow = row;
  $('mqtt-messages').prepend(row);
  while ($('mqtt-messages').children.length > 80) $('mqtt-messages').removeChild($('mqtt-messages').lastChild);
}

export function hydrateMqttForm() {
  const saved = JSON.parse(localStorage.getItem('tadashy_mqtt') || 'null');
  if (!saved) return;
  $('mqtt-host').value = saved.host || $('mqtt-host').value;
  $('mqtt-port').value = saved.port || $('mqtt-port').value;
  $('mqtt-user').value = saved.username || '';
  $('mqtt-pass').value = saved.password || '';
}

export async function autoConnectMqtt() {
  if (!state.auth || !hasPermission('mqtt_status') || state.client) return;

  let saved = JSON.parse(localStorage.getItem('tadashy_mqtt') || 'null');
  if (!saved?.host || !saved?.port || !saved?.username || !saved?.password) {
    try {
      const config = await api('/mqtt/config');
      if (config && config.host && config.password) {
        saved = config;
        localStorage.setItem('tadashy_mqtt', JSON.stringify(saved));
        hydrateMqttForm();
      }
    } catch (err) {
      addLog('No se pudo obtener config MQTT del servidor', 'err');
    }
  }

  if (!saved?.host || !saved?.port || !saved?.username || !saved?.password) {
    addLog('MQTT listo: faltan credenciales guardadas', 'inf');
    return;
  }
  connectMqtt(saved);
}
