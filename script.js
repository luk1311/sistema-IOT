const API = '/api';
const INTERVALO = 40;
const servoNames = ['Base', 'Hombro', 'Codo', 'Muñeca'];
const servoKeys = ['base', 'shoulder', 'elbow', 'wrist'];
const servoIcons = ['ti-rotate-clockwise', 'ti-arrow-up', 'ti-fold-up', 'ti-hand-grab'];
const roleLabels = {
  super_admin: 'Super Admin',
  admin: 'Super Admin',
  operator: 'Operador',
  guest: 'Invitado',
  viewer: 'Invitado'
};

let client = null;
let pubTotal = 0;
let mqttTotal = 0;
let ultimoEnvio = [0, 0, 0, 0];
let auth = JSON.parse(localStorage.getItem('tadashy_auth') || 'null');
let automations = [];
let users = [];
let historyItems = [];
let devices = [];
let currentMode = 'manual';
let deviceTimer = null;
let iotEvents = null;
let voiceRecognition = null;
let voiceEnabled = false;
let handsFreeMode = JSON.parse(localStorage.getItem('tadashy_handsfree') || 'false');
let voiceSessionId = localStorage.getItem('tadashy_voice_session') || `voice-${Date.now()}`;
let isSpeaking = false;
let pttActive = false;
let aiCallsSaved = 0;
let aiTokensSaved = 0;

const viewCopy = {
  dashboard: ['Dashboard IoT', 'Estado en tiempo real del sistema y del broker MQTT.'],
  devices: ['Inventario de Dispositivos', 'Monitoreo y control de todo el hardware registrado.'],
  mqtt: ['Explorador y monitor MQTT', 'Conexión, suscripción, publicación y trazas del broker.'],
  automations: ['Automatizaciones', 'Secuencias guardadas con ejecución y registro histórico.'],
  history: ['Historial', 'Eventos de usuario, MQTT, servos y automatizaciones.'],
  users: ['Gestión de usuarios', 'Administración de cuentas, roles y permisos.'],
  ai: ['Asistente TADASHY AI', 'Chatea con la Inteligencia Artificial para consultar y analizar el estado de tu red IoT.']
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  
  let res;
  try {
    res = await fetch(API + path, { ...options, headers });
    if ($('api-badge')) {
      $('api-badge').className = 'badge badge-online';
      $('api-badge').innerHTML = '<div class="status-pulse" style="background: var(--accent-online);"></div> API Online';
    }
  } catch (netErr) {
    if ($('api-badge')) {
      $('api-badge').className = 'badge badge-offline';
      $('api-badge').innerHTML = '<div class="status-pulse"></div> API Offline';
    }
    throw new Error('API Offline o inalcanzable');
  }

  let data = {};
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json().catch(() => ({}));
  }
  
  if (res.status === 401 || res.status === 403) {
    if (path !== '/auth/login' && auth) {
      logout();
      throw new Error('Sesión expirada. Por favor, inicia sesión de nuevo.');
    }
  }
  
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

function hasPermission(permission) {
  if (permission === 'mqtt_status' && auth?.user?.permissions?.includes('mqtt_monitor')) return true;
  if (permission === 'mqtt_publish' && auth?.user?.permissions?.includes('mqtt_monitor')) return true;
  return Boolean(auth?.user?.permissions?.includes(permission));
}

function roleLabel(role) {
  return roleLabels[role] || role;
}

let lastLogMsg = '';
let lastLogCount = 1;
let lastLogElement = null;

function addLog(msg, tipo = 'inf') {
  if (msg === lastLogMsg && lastLogElement) {
    lastLogCount++;
    lastLogElement.innerHTML = `<span class="log-ts">${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span class="log-${tipo}">${escapeHtml(msg)} <span style="opacity:0.6">(${lastLogCount}x)</span></span>`;
    return;
  }
  
  lastLogMsg = msg;
  lastLogCount = 1;
  const ts = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = `<span class="log-ts">${ts}</span><span class="log-${tipo}">${escapeHtml(msg)}</span>`;
  lastLogElement = row;
  
  $('log').prepend(row);
  while ($('log').children.length > 80) $('log').removeChild($('log').lastChild);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[ch]));
}

async function saveHistory(type, detail, metadata = {}) {
  try {
    await api('/history', {
      method: 'POST',
      body: JSON.stringify({ type, detail, metadata })
    });
  } catch (error) {
    addLog(`Historial no guardado: ${error.message}`, 'err');
  }
}

function renderShell() {
  $('login-overlay').style.display = auth ? 'none' : 'flex';
  $('main').style.display = auth ? 'grid' : 'none';
  if (!auth) return;

  $('session-name').textContent = auth.user.username;
  const roleEl = document.querySelector('.operator-role');
  if (roleEl) roleEl.textContent = roleLabel(auth.user.role);
  document.querySelectorAll('[data-permission]').forEach((el) => {
    el.classList.toggle('hidden', !hasPermission(el.dataset.permission));
  });
  const activeNav = document.querySelector('.nav-btn.active');
  if (activeNav && !activeNav.classList.contains('hidden')) {
    switchView(activeNav.dataset.view);
  } else {
    switchView('dashboard');
  }
  buildCards();
  loadAll();
  connectIotEvents();
  autoConnectMqtt();
}

async function login(event) {
  event.preventDefault();
  const username = $('inp-user').value.trim();
  const password = $('inp-pass').value;
  const errEl = $('login-err');
  errEl.style.display = 'none';

  try {
    auth = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem('tadashy_auth', JSON.stringify(auth));
    addLog(`Sesión iniciada por ${auth.user.username}`, 'ok');
    renderShell();
  } catch (error) {
    errEl.textContent = error.message;
    errEl.style.display = 'block';
  }
}

function logout() {
  if (auth?.token) {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
  }
  localStorage.removeItem('tadashy_auth');
  auth = null;
  if (client) client.end(true);
  client = null;
  if (iotEvents) iotEvents.close();
  iotEvents = null;
  renderShell();
}

function switchView(view) {
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${view}`));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('view-title').textContent = viewCopy[view] ? viewCopy[view][0] : 'Vista';
  $('view-subtitle').textContent = viewCopy[view] ? viewCopy[view][1] : '';
  if (view === 'ai') loadAiChat();
}

function buildCards() {
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
            <line id="needle${i}" x1="70" y1="70" x2="70" y2="16" stroke="#a78bff" stroke-width="2" stroke-linecap="round" class="needle-s"/>
            <circle cx="70" cy="70" r="4" fill="#7c6aff"/>
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

function updateAngle(i, val) {
  const v = Math.max(0, Math.min(180, parseInt(val, 10) || 0));
  const arcLen = Math.PI * 58;
  $(`num${i}`).textContent = v;
  $(`arc${i}`).style.strokeDashoffset = (arcLen - (v / 180) * arcLen).toFixed(1);
  $(`needle${i}`).style.transform = `rotate(${-90 + v}deg)`;
  $( `dash-${servoKeys[i - 1]}` ).textContent = `${v}°`;
}

async function publish(topic, payload) {
  if (!hasPermission('mqtt_publish')) {
    addLog('No tienes permiso para publicar MQTT', 'err');
    return false;
  }
  
  if (client && client.connected) {
    client.publish(topic, String(payload));
    pubTotal++;
    $('pub-total').textContent = pubTotal;
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
      pubTotal++;
      $('pub-total').textContent = pubTotal;
      return true;
    }
  } catch (err) {
    addLog(`Error publicando: ${err.message}`, 'err');
  }
  return false;
}

function mover(servo, valor, force = false) {
  if (!hasPermission('robot_control')) return;
  const ahora = Date.now();
  if (!force && ahora - ultimoEnvio[servo - 1] <= INTERVALO) return;
  ultimoEnvio[servo - 1] = ahora;
  if (publish(`brazo/servo/${servo}`, valor)) {
    updateAngle(servo, valor);
    const card = $(`card${servo}`);
    card.classList.add('pulse');
    setTimeout(() => card.classList.remove('pulse'), 260);
    addLog(`Servo ${servo} (${servoNames[servo - 1]}) -> ${valor}°`, 'ok');
  }
}

function irA(servo, val) {
  if (!hasPermission('robot_control')) return;
  $(`slider${servo}`).value = val;
  mover(servo, val, true);
}

function resetAll() {
  if (!hasPermission('robot_control')) return addLog('No tienes permiso para controlar el brazo', 'err');
  for (let i = 1; i <= 4; i++) irA(i, 90);
  saveHistory('robot', 'Todos los servos centrados a 90°');
}

function setModo(modo) {
  if (!hasPermission('robot_control')) return addLog('No tienes permiso para cambiar el modo', 'err');
  currentMode = modo;
  $('btn-manual').classList.toggle('active', modo === 'manual');
  $('btn-auto').classList.toggle('active', modo === 'auto');
  publish('brazo/modo', modo);
  saveHistory('robot_mode', `Modo cambiado a ${modo}`);
}

function setDevice(online) {
  $('device-badge').className = online ? 'badge badge-dev-on' : 'badge badge-dev-off';
  $('device-badge').innerHTML = online ? '<i class="ti ti-cpu"></i> ESP32 conectado' : '<i class="ti ti-cpu"></i> ESP32 sin señal';
  $('last-seen').textContent = online ? `Último dato ${new Date().toLocaleTimeString('es-CO')}` : 'Sin datos';
  clearTimeout(deviceTimer);
  if (online) deviceTimer = setTimeout(() => setDevice(false), 6000);
}

function conectarMqtt(event) {
  event.preventDefault();
  if (!hasPermission('mqtt_status')) return addLog('No tienes permiso para conectar MQTT', 'err');

  const host = $('mqtt-host').value.trim();
  const port = $('mqtt-port').value.trim();
  const username = $('mqtt-user').value.trim();
  const password = $('mqtt-pass').value;
  if (!host || !port || !username || !password) return addLog('Completa los datos MQTT', 'err');

  connectMqtt({ host, port, username, password });
}

function connectMqtt({ host, port, username, password }) {
  if (!hasPermission('mqtt_status')) return false;
  if (!host || !port || !username || !password) return false;
  if (client?.connected) return true;

  localStorage.setItem('tadashy_mqtt', JSON.stringify({ host, port, username, password }));
  if (client) client.end(true);

  client = mqtt.connect(`wss://${host}:${port}/mqtt`, {
    username,
    password,
    clientId: `tadashy_web_${Math.random().toString(16).slice(2, 8)}`,
    connectTimeout: 6000,
    reconnectPeriod: 2000,
    keepalive: 30
  });

  client.on('connect', () => {
    $('conn-badge').className = 'badge badge-ok';
    $('conn-badge').innerHTML = '<i class="ti ti-wifi"></i> MQTT conectado';
    client.subscribe('brazo/#');
    client.subscribe('devices/#');
    addLog('Broker MQTT conectado', 'ok');
    saveHistory('mqtt_connect', `Conexión MQTT a ${host}`);
  });

  client.on('offline', () => {
    $('conn-badge').className = 'badge badge-warn';
    $('conn-badge').innerHTML = '<i class="ti ti-wifi-off"></i> MQTT desconectado';
    addLog('Broker MQTT desconectado', 'err');
  });

  client.on('error', (error) => {
    $('conn-badge').className = 'badge badge-err';
    $('conn-badge').innerHTML = '<i class="ti ti-alert-triangle"></i> Error MQTT';
    addLog(`Error MQTT: ${error.message || 'sin detalle'}`, 'err');
  });

  client.on('message', onMqttMessage);
  return true;
}

function disconnectMqtt() {
  if (client) client.end(true);
  client = null;
  $('conn-badge').className = 'badge badge-warn';
  $('conn-badge').innerHTML = '<i class="ti ti-wifi-off"></i> MQTT desconectado';
}

function onMqttMessage(topic, payloadBuffer) {
  const payload = payloadBuffer.toString();
  mqttTotal++;
  $('mqtt-total').textContent = mqttTotal;
  addMqttRow(topic, payload);
  setDevice(topic === 'brazo/status' ? payload === 'online' : true);

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

let lastMqttTopic = '';
let lastMqttPayload = '';
let lastMqttCount = 1;
let lastMqttRow = null;

function addMqttRow(topic, payload) {
  if (topic === lastMqttTopic && payload === lastMqttPayload && lastMqttRow) {
    lastMqttCount++;
    lastMqttRow.innerHTML = `<span class="row-meta">${new Date().toLocaleTimeString('es-CO')}</span><span class="topic">${escapeHtml(topic)}</span><span class="payload">${escapeHtml(payload)} <span style="opacity:0.6">(${lastMqttCount}x)</span></span>`;
    return;
  }
  
  lastMqttTopic = topic;
  lastMqttPayload = payload;
  lastMqttCount = 1;
  const row = document.createElement('div');
  row.className = 'message-row';
  row.innerHTML = `<span class="row-meta">${new Date().toLocaleTimeString('es-CO')}</span><span class="topic">${escapeHtml(topic)}</span><span class="payload">${escapeHtml(payload)}</span>`;
  lastMqttRow = row;
  $('mqtt-messages').prepend(row);
  while ($('mqtt-messages').children.length > 80) $('mqtt-messages').removeChild($('mqtt-messages').lastChild);
}

async function loadAll() {
  await Promise.allSettled([loadUsers(), loadAutomations(), loadHistory(), loadDevices()]);
}

async function loadDevices() {
  if (!hasPermission('view_dashboard')) return;
  try {
    const data = await api('/devices');
    devices = data.devices || [];
    renderDevices();
  } catch (error) {
    addLog(`Inventario IoT no disponible: ${error.message}`, 'err');
  }
}

function renderDevices() {
  const grid = $('device-grid');
  if (!grid) return;
  const online = devices.filter((device) => device.status === 'online').length;
  $('device-total').textContent = devices.length;
  $('device-online-total').textContent = online;

  if (!devices.length) {
    grid.innerHTML = '<div class="empty-state">Sin dispositivos descubiertos. Esperando heartbeat en devices/{deviceId}/status o telemetria en devices/{deviceId}/telemetry.</div>';
    return;
  }

  grid.innerHTML = devices.map((device) => {
    const lastSeen = device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString('es-CO') : '--';
    const firmware = device.firmware || device.metadata?.firmware || '--';
    const telemetry = device.lastTelemetry
      ? JSON.stringify(device.lastTelemetry).slice(0, 160)
      : 'Sin telemetria reciente';
    const statusClass = device.status === 'online' ? 'online' : 'offline';
    const statusBadge = device.status === 'online'
      ? '<span class="badge badge-dev-on"><i class="ti ti-activity"></i>Online</span>'
      : '<span class="badge badge-dev-off"><i class="ti ti-power"></i>Offline</span>';

    return `
      <div class="device-card ${statusClass}" data-device-id="${escapeHtml(device.deviceId)}">
        <div class="device-head">
          <div>
            <div class="device-id">${escapeHtml(device.name || device.deviceId)}</div>
            <div class="device-type">${escapeHtml(device.type || 'esp32')} - ${escapeHtml(device.deviceId)}</div>
          </div>
          ${statusBadge}
        </div>
        <div class="device-meta">
          <div><span>Ultimo heartbeat</span><strong>${escapeHtml(lastSeen)}</strong></div>
          <div><span>Firmware</span><strong>${escapeHtml(firmware)}</strong></div>
        </div>
        <div class="device-telemetry">${escapeHtml(telemetry)}</div>
      </div>`;
  }).join('');
}

let refreshDevicesTimer = null;
function refreshDevicesSoon() {
  clearTimeout(refreshDevicesTimer);
  refreshDevicesTimer = setTimeout(loadDevices, 250);
}

function upsertDevice(device) {
  if (!device?.deviceId) return;
  const index = devices.findIndex((item) => item.deviceId === device.deviceId);
  if (index >= 0) devices[index] = device;
  else devices.unshift(device);
  renderDevices();
}

function connectIotEvents() {
  if (!auth?.token || iotEvents) return;
  iotEvents = new EventSource(`${API}/iot/events?token=${encodeURIComponent(auth.token)}`);
  iotEvents.addEventListener('device', (event) => {
    const data = JSON.parse(event.data);
    upsertDevice(data.payload);
  });
  iotEvents.addEventListener('telemetry', (event) => {
    const data = JSON.parse(event.data);
    const telemetry = data.payload;
    const device = devices.find((item) => item.deviceId === telemetry.deviceId);
    if (device) {
      device.status = 'online';
      device.lastTelemetry = telemetry.payload;
      device.lastSeen = telemetry.receivedAt;
      renderDevices();
    } else {
      refreshDevicesSoon();
    }
  });
  iotEvents.onerror = () => {
    if (iotEvents) iotEvents.close();
    iotEvents = null;
    if (auth) setTimeout(connectIotEvents, 3000);
  };
}

async function discoverDevices() {
  if (!hasPermission('manage_devices')) return addLog('No tienes permiso para descubrimiento IoT', 'err');
  try {
    await api('/devices/discover', { method: 'POST' });
    addLog('Solicitud de descubrimiento IoT enviada', 'ok');
  } catch (error) {
    addLog(`Descubrimiento IoT fallido: ${error.message}`, 'err');
  }
}

async function loadUsers() {
  if (!hasPermission('manage_users')) return;
  try {
    const data = await api('/users');
    users = data.users || [];
    if ($('user-total')) $('user-total').textContent = users.length;
    
    if (users.length === 0) {
      $('user-list').innerHTML = `<div class="empty-state">No hay operadores registrados</div>`;
      return;
    }

    $('user-list').innerHTML = users.map((user) => `
      <div class="item-row">
        <div><div class="row-title">${escapeHtml(user.username)}</div><div class="row-meta">${escapeHtml(roleLabel(user.role))} · ${user.active ? 'activo' : 'inactivo'}</div></div>
        <div class="flex-row">
          <button class="ghost-btn" data-toggle-user="${user.id}">${user.active ? 'Desactivar' : 'Activar'}</button>
          <button class="ghost-btn" style="color: var(--accent-offline-strong); padding: 4px;" data-delete-user="${user.id}"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
        </div>
      </div>`).join('');
  } catch (err) {
    $('user-list').innerHTML = `<div class="empty-state" style="color: var(--accent-offline-strong);">Error al cargar operadores: ${escapeHtml(err.message)}</div>`;
  }
}

async function createUser(event) {
  event.preventDefault();
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('new-username').value.trim(),
        password: $('new-password').value,
        role: $('new-role').value
      })
    });
    event.target.reset();
    await loadUsers();
    saveHistory('user', 'Usuario creado');
    addLog('Usuario creado exitosamente', 'ok');
  } catch (error) {
    addLog(`Error al crear usuario: ${error.message}`, 'err');
  }
}

async function toggleUser(id) {
  const user = users.find((item) => item.id === id);
  if (!user) return;
  try {
    await api(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !user.active })
    });
    await loadUsers();
    addLog(`Usuario ${user.username} ${!user.active ? 'activado' : 'desactivado'}`, 'ok');
  } catch (error) {
    addLog(`Error al modificar usuario: ${error.message}`, 'err');
  }
}

async function deleteUser(id) {
  if (!confirm('¿Seguro que deseas eliminar este operador permanentemente?')) return;
  try {
    await api(`/users/${id}`, { method: 'DELETE' });
    await loadUsers();
    saveHistory('user', 'Usuario eliminado');
    addLog('Operador eliminado', 'ok');
  } catch (error) {
    addLog(`Error al eliminar usuario: ${error.message}`, 'err');
  }
}

async function loadAutomations() {
  try {
    const data = await api('/automations');
    automations = data.automations || [];
    $('auto-total').textContent = automations.length;
    
    if (automations.length === 0) {
      $('automation-list').innerHTML = `<div class="empty-state">No hay rutinas creadas</div>`;
      return;
    }

    $('automation-list').innerHTML = automations.map((item) => `
      <div class="item-row">
        <div><div class="row-title">${escapeHtml(item.name)}</div><div class="row-meta">${item.steps.length} pasos</div></div>
        <button class="secondary-btn" data-run-auto="${item.id}"><span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span> Ejecutar</button>
      </div>`).join('');
  } catch (err) {
    $('automation-list').innerHTML = `<div class="empty-state" style="color: var(--accent-offline-strong);">Error al cargar rutinas: ${escapeHtml(err.message)}</div>`;
  }
}

async function createAutomation(event) {
  event.preventDefault();
  try {
    const steps = JSON.parse($('auto-steps').value);
    await api('/automations', {
      method: 'POST',
      body: JSON.stringify({ name: $('auto-name').value.trim(), steps })
    });
    event.target.reset();
    await loadAutomations();
    saveHistory('automation', 'Automatización guardada');
    addLog('Automatización guardada exitosamente', 'ok');
  } catch (error) {
    addLog(`Error al guardar automatización: ${error.message}`, 'err');
  }
}

async function runAutomation(id) {
  if (!hasPermission('run_automations')) return addLog('No tienes permiso para ejecutar automatizaciones', 'err');
  const item = automations.find((automation) => automation.id === id);
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

async function loadHistory() {
  const list = $('history-list');
  if (list) {
    list.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-muted);"><span class="material-symbols-outlined" style="font-size: 32px; animation: pulse 1s infinite;">history</span><div style="margin-top: 12px; font-family: \'Outfit\';">Obteniendo registros...</div></div>';
  }
  
  // UX delay to show the loading animation clearly
  await new Promise(r => setTimeout(r, 600));

  const data = await api('/history?t=' + Date.now());
  historyItems = data.history || [];
  if (list) {
    if (historyItems.length === 0) {
      list.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">No hay registros.</div>';
    } else {
      list.innerHTML = historyItems.map((item) => `
        <div class="history-row">
          <span class="row-meta">${new Date(item.createdAt).toLocaleString('es-CO')}</span>
          <span class="topic">${escapeHtml(item.type)}</span>
          <span>${escapeHtml(item.detail)}</span>
        </div>`).join('');
    }
  }
}

async function clearHistory() {
  const list = $('history-list');
  if (list) {
    list.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-muted);"><span class="material-symbols-outlined" style="font-size: 32px; animation: pulse 1s infinite;">delete</span><div style="margin-top: 12px; font-family: \'Outfit\';">Limpiando registros...</div></div>';
  }
  
  await new Promise(r => setTimeout(r, 400));
  
  try {
    await api('/history', { method: 'DELETE' });
  } catch (e) {
    console.warn('Backend does not support DELETE /history, clearing locally');
  }
  
  historyItems = [];
  if (list) {
    list.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">No hay registros.</div>';
  }
  addLog('Historial limpiado', 'info');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hydrateMqttForm() {
  const saved = JSON.parse(localStorage.getItem('tadashy_mqtt') || 'null');
  if (!saved) return;
  $('mqtt-host').value = saved.host || $('mqtt-host').value;
  $('mqtt-port').value = saved.port || $('mqtt-port').value;
  $('mqtt-user').value = saved.username || '';
  $('mqtt-pass').value = saved.password || '';
}

async function loadAiChat() {
  if (!hasPermission('ai_chat')) return;
  try {
    const cap = await api('/ai/capabilities');
    $('ai-info-model').textContent = cap.model || 'Desconocido';
    $('ai-info-endpoint').textContent = cap.ollamaUrl || 'Desconocido';
    $('ai-model-badge').innerHTML = `<i class="ti ti-brain"></i> ${cap.model || 'Mistral'}`;

    $('ai-tools-list').innerHTML = cap.tools.map(t => `
      <div class="cap-tool-card">
        <div class="cap-tool-head">
          <span class="tool-name"><i class="ti ti-settings-automation"></i> ${t.name}</span>
          <span class="tool-scope"><i class="ti ti-shield"></i> ${t.scope || 'público'}</span>
        </div>
        <p class="tool-desc">${t.description}</p>
      </div>
    `).join('');

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

function updateVoiceStatus(text, active = voiceEnabled) {
  const status = $('voice-status');
  if (status) status.textContent = text;
  $('voice-toggle-btn')?.classList.toggle('active', active);
  $('handsfree-toggle-btn')?.classList.toggle('active', handsFreeMode);
}

function speakAi(text) {
  if (!('speechSynthesis' in window) || !text || (!voiceEnabled && !handsFreeMode && !pttActive)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').slice(0, 800));
  utterance.lang = 'es-CO';
  utterance.rate = 0.96;
  utterance.pitch = 1;
  
  utterance.onstart = () => {
    isSpeaking = true;
    if (voiceRecognition) {
      try { voiceRecognition.stop(); } catch (e) {}
    }
    updateVoiceStatus('Hablando... (micrófono desactivado)', false);
  };
  
  utterance.onend = () => {
    isSpeaking = false;
    setTimeout(() => {
      if (!isSpeaking && (voiceEnabled || pttActive)) {
        try { voiceRecognition.start(); } catch (e) {}
      }
      updateVoiceStatus(voiceEnabled ? 'Escuchando · Hey TADASHY' : (pttActive ? 'PTT Activo' : 'Voz lista'));
    }, 1000);
  };
  
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  isSpeaking = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  updateVoiceStatus(voiceEnabled ? 'Escuchando · Hey TADASHY' : 'Voz lista · Hey TADASHY');
  setTimeout(() => {
    if (voiceEnabled || pttActive) {
      try { voiceRecognition.start(); } catch (e) {}
    }
  }, 500);
}

function normalizeVoiceText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

async function handleVoiceTranscript(transcript) {
  if (isSpeaking) return;
  const raw = String(transcript || '').trim();
  const normalized = normalizeVoiceText(raw);
  if (!raw) return;
  if (normalized.includes('stop talking') || normalized.includes('deja de hablar') || normalized.includes('silencio tadashy')) {
    stopSpeaking();
    return;
  }
  const wakeIndex = normalized.indexOf('hey tadashy');
  if (!handsFreeMode && wakeIndex === -1) {
    updateVoiceStatus('Esperando wake word · Hey TADASHY');
    return;
  }
  const command = wakeIndex >= 0 ? raw.slice(wakeIndex + 'hey tadashy'.length).trim() : raw;
  if (!command) return;
  updateVoiceStatus('Procesando voz...');
  const reply = await sendAiMessage(command, { channel: 'voice', sessionId: voiceSessionId, speak: true });
  if (reply) speakAi(reply);
  updateVoiceStatus(voiceEnabled ? 'Escuchando · Hey TADASHY' : 'Voz lista · Hey TADASHY');
}

function initVoiceAssistant() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateVoiceStatus('STT no disponible en este navegador', false);
    return;
  }
  if (voiceRecognition) return;
  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = 'es-CO';
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = false;
  voiceRecognition.maxAlternatives = 1;
  voiceRecognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if (last?.isFinal) handleVoiceTranscript(last[0].transcript).catch((err) => updateVoiceStatus(`Voz: ${err.message}`, false));
  };
  voiceRecognition.onend = () => {
    if ((voiceEnabled || pttActive) && !isSpeaking) {
      try { voiceRecognition.start(); } catch (err) {}
    }
  };
  voiceRecognition.onerror = (event) => updateVoiceStatus(`Voz: ${event.error || 'error'}`, false);
}

function toggleVoice() {
  initVoiceAssistant();
  if (!voiceRecognition) return;
  voiceEnabled = !voiceEnabled;
  if (voiceEnabled) {
    try { voiceRecognition.start(); } catch (err) {}
    updateVoiceStatus('Escuchando · Hey TADASHY', true);
  } else {
    voiceRecognition.stop();
    updateVoiceStatus('Voz lista · Hey TADASHY', false);
  }
}

async function toggleHandsFree() {
  handsFreeMode = !handsFreeMode;
  localStorage.setItem('tadashy_handsfree', JSON.stringify(handsFreeMode));
  updateVoiceStatus(handsFreeMode ? 'Manos libres activo' : 'Manos libres apagado');
  try {
    await api('/ai/memory', {
      method: 'PATCH',
      body: JSON.stringify({
        sessionId: voiceSessionId,
        memory: { preferences: { handsFree: handsFreeMode } }
      })
    });
  } catch (err) {
    addLog(`Preferencia de voz no guardada: ${err.message}`, 'err');
  }
}

function updateAiMetrics(calls, tokens) {
  aiCallsSaved += calls;
  aiTokensSaved += tokens;
  if ($('ai-calls-saved')) $('ai-calls-saved').textContent = aiCallsSaved;
  if ($('ai-tokens-saved')) $('ai-tokens-saved').textContent = `~${aiTokensSaved}`;
}

function handleQuickCommand(cmd, options) {
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
      Total registrados: ${devices.length}<br>
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
        <button class="btn" onclick="sendAiMessage('/dispositivos')" style="justify-content:center;">🔌 Dispositivos</button>
        <button class="btn" onclick="sendAiMessage('/robot')" style="justify-content:center;">🤖 Brazo Robótico</button>
        <button class="btn" onclick="window.executeBotAction('nav_auto')" style="justify-content:center;">⚡ Automatizaciones</button>
        <button class="btn" onclick="window.executeBotAction('nav_mqtt')" style="justify-content:center;">📡 Estado MQTT</button>
      </div>
    `;
  }
  
  appendAiChatMessage('assistant', reply, true);
  if (options?.speak) speakAi("Menú rápido mostrado.");
  return reply;
}

window.executeBotAction = function(action) {
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
};

async function sendAiMessage(messageText, options = {}) {
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
        'Authorization': `Bearer ${auth.token}`
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

function appendAiChatMessage(role, content, isHtml = false) {
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

function createConfirmationCard(container, token, action) {
  const actionDetails = action.calls
    ? action.calls.map((item) => `${item.tool}: ${JSON.stringify(item.arguments)}`).join('\n')
    : JSON.stringify(action.arguments, null, 2);
  const card = document.createElement('div');
  card.className = 'ai-confirm-card';
  card.innerHTML = `
    <div class="confirm-card-title"><i class="ti ti-alert-triangle"></i> Confirmación Requerida</div>
    <div class="confirm-card-details">
      <span><strong>Acción:</strong> ${escapeHtml(action.tool)}</span>
      <span><strong>Parámetros:</strong></span>
      <pre>${escapeHtml(actionDetails)}</pre>
    </div>
    <div class="confirm-card-actions">
      <button class="confirm-btn-yes"><i class="ti ti-check"></i> Confirmar y Ejecutar</button>
      <button class="confirm-btn-no"><i class="ti ti-x"></i> Cancelar</button>
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

async function autoConnectMqtt() {
  if (!auth || !hasPermission('mqtt_status') || client) return;
  
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

function bindEvents() {
  $('login-form').addEventListener('submit', login);
  $('logout-btn').addEventListener('click', logout);
  $('clear-log-btn').addEventListener('click', () => { $('log').innerHTML = ''; });
  $('reset-btn').addEventListener('click', resetAll);
  $('mqtt-form').addEventListener('submit', conectarMqtt);
  $('mqtt-disconnect').addEventListener('click', disconnectMqtt);
  $('publish-form').addEventListener('submit', (event) => {
    event.preventDefault();
    publish($('pub-topic').value.trim(), $('pub-message').value);
  });
  $('subscribe-btn').addEventListener('click', () => {
    if (client?.connected) {
      client.subscribe($('sub-topic').value.trim());
      addLog(`Suscrito a ${$('sub-topic').value.trim()}`, 'ok');
    }
  });
  $('automation-form').addEventListener('submit', createAutomation);
  $('user-form').addEventListener('submit', createUser);
  $('clear-history').addEventListener('click', clearHistory);
  $('discover-devices-btn').addEventListener('click', discoverDevices);
  $('voice-toggle-btn')?.addEventListener('click', toggleVoice);
  $('handsfree-toggle-btn')?.addEventListener('click', toggleHandsFree);
  $('stop-speaking-btn')?.addEventListener('click', stopSpeaking);
  $('ai-chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('ai-chat-input');
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    sendAiMessage(txt);
  });

  if ($('ptt-btn')) {
    const startPtt = () => {
      initVoiceAssistant();
      pttActive = true;
      try { voiceRecognition.start(); } catch (e) {}
      updateVoiceStatus('🎙️ Escuchando...', true);
    };
    const stopPtt = () => {
      pttActive = false;
      if (voiceRecognition && !voiceEnabled) {
        voiceRecognition.stop();
      }
      updateVoiceStatus(voiceEnabled ? 'Escuchando · Hey TADASHY' : 'Voz lista');
    };
    $('ptt-btn').addEventListener('mousedown', startPtt);
    $('ptt-btn').addEventListener('mouseup', stopPtt);
    $('ptt-btn').addEventListener('mouseleave', stopPtt);
    $('ptt-btn').addEventListener('touchstart', (e) => { e.preventDefault(); startPtt(); });
    $('ptt-btn').addEventListener('touchend', (e) => { e.preventDefault(); stopPtt(); });
  }

  $('nav-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-btn');
    if (button) switchView(button.dataset.view);
  });

  const mobileMenuBtn = $('mobile-menu-btn');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      document.querySelector('.sidebar').classList.toggle('open');
    });
  }

  document.addEventListener('input', (event) => {
    if (event.target.matches('input[type=range][data-servo]')) mover(Number(event.target.dataset.servo), event.target.value);
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('input[type=range][data-servo]')) mover(Number(event.target.dataset.servo), event.target.value, true);
  });

  document.addEventListener('click', (event) => {
    // Cierre del sidebar en movil si se hace click fuera
    const sidebar = document.querySelector('.sidebar');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (sidebar && sidebar.classList.contains('open')) {
      if (!sidebar.contains(event.target) && !mobileMenuBtn.contains(event.target)) {
        sidebar.classList.remove('open');
      }
    }

    const preset = event.target.closest('[data-servo][data-angle]');
    if (preset) irA(Number(preset.dataset.servo), Number(preset.dataset.angle));

    const mode = event.target.closest('[data-mode]');
    if (mode) setModo(mode.dataset.mode);

    if (event.target.closest('#btn-manual')) setModo('manual');
    if (event.target.closest('#btn-auto')) setModo('auto');
    if (event.target.closest('#reset-btn')) resetAll();
    if (event.target.closest('#btn-vision')) window.open('Brazo_vision.html', '_blank');

    const run = event.target.closest('[data-run-auto]');
    if (run) runAutomation(run.dataset.runAuto);

    const toggle = event.target.closest('[data-toggle-user]');
    if (toggle) toggleUser(toggle.dataset.toggleUser);

    const delUser = event.target.closest('[data-delete-user]');
    if (delUser) deleteUser(delUser.dataset.deleteUser);

    const deviceCard = event.target.closest('.device-card');
    if (deviceCard) {
      const deviceId = deviceCard.dataset.deviceId || '';
      if (deviceId.toLowerCase().includes('brazo')) {
        $('robot-modal').style.display = 'flex';
      }
    }
  });

  const closeRobotBtn = $('close-robot-modal');
  if (closeRobotBtn) {
    closeRobotBtn.addEventListener('click', () => {
      $('robot-modal').style.display = 'none';
    });
  }
}

bindEvents();
hydrateMqttForm();
updateVoiceStatus(handsFreeMode ? 'Manos libres activo' : 'Voz lista · Hey TADASHY');
renderShell();
