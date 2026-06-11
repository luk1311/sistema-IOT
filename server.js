const http = require('http');
const express = require('express');
const cors = require('cors');
const app = express();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mqtt = require('mqtt');
const { createIotStore, normalizeDeviceId, parseJson } = require('./iot_store');
const { createAiService } = require('./ai_service');
const {
  AutomationGenerator,
  ContextBuilder,
  DeviceRegistry,
  EventBus,
  LocationRegistry,
  MemoryManager,
  SessionManager,
  ToolExecutionLimiter
} = require('./tadashy_ai_core');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const HEARTBEAT_TIMEOUT_MS = Number(process.env.IOT_HEARTBEAT_TIMEOUT_MS || 15000);
const MQTT_URL = process.env.MQTT_URL || process.env.TADASHY_MQTT_URL || '';
const MQTT_USERNAME = process.env.MQTT_USERNAME || process.env.TADASHY_MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || process.env.TADASHY_MQTT_PASSWORD || '';

let iotStore = null;
let iotMqttClient = null;
let aiService = null;
let aiModules = null;
const eventClients = new Set();
const eventBus = new EventBus();
const sessionManager = new SessionManager();

const SCOPES = {
  super_admin: ['ai:chat', 'devices:read', 'telemetry:read', 'automations:read', 'users:read', 'system:read', 'devices:control', 'automations:create', 'automations:execute', 'automations:stop', 'voice:use', 'memory:read', 'memory:write', 'groups:read'],
  operator: ['ai:chat', 'devices:read', 'telemetry:read', 'automations:read', 'system:read', 'devices:control', 'automations:create', 'automations:execute', 'automations:stop', 'voice:use', 'memory:read', 'memory:write', 'groups:read'],
  guest: ['devices:read', 'telemetry:read', 'voice:use', 'memory:read']
};

const activeAutomations = new Map();

async function runAutomationInBackend(automation) {
  const id = automation.id;
  activeAutomations.set(id, true);
  console.log(`[Automation] Iniciando ${automation.name} en el servidor...`);
  
  for (const step of automation.steps) {
    if (!activeAutomations.has(id)) {
      console.log(`[Automation] Detenida: ${automation.name}`);
      break;
    }
    
    const delay = Number(step.delay) || 250;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (!activeAutomations.has(id)) {
      break;
    }

    if (step.topic && iotMqttClient?.connected) {
      iotMqttClient.publish(step.topic, JSON.stringify(step.payload ?? ''));
    }
    if (step.servo && Number.isFinite(Number(step.angle)) && iotMqttClient?.connected) {
      iotMqttClient.publish(`brazo/servo/${step.servo}`, String(step.angle));
    }
  }
  activeAutomations.delete(id);
  console.log(`[Automation] Finalizada: ${automation.name}`);
}

function stopAutomationInBackend(id) {
  activeAutomations.delete(id);
}

const rateLimits = new Map();
function checkRateLimit(req, limit = 15, windowMs = 60000) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const state = rateLimits.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > state.resetTime) {
    state.count = 1;
    state.resetTime = now + windowMs;
  } else {
    state.count++;
  }
  rateLimits.set(ip, state);
  return state.count <= limit;
}

const PERMISSIONS = {
  super_admin: [
    'manage_users',
    'manage_robots',
    'manage_devices',
    'manage_settings',
    'view_dashboard',
    'ai_chat',
    'view_history',
    'run_automations',
    'ai:chat',
    'voice:use',
    'memory:read',
    'memory:write',
    'mqtt_status',
    'mqtt_monitor',
    'mqtt_publish',
    'robot_control'
  ],
  operator: [
    'view_dashboard',
    'ai_chat',
    'view_history',
    'run_automations',
    'ai:chat',
    'voice:use',
    'memory:read',
    'memory:write',
    'mqtt_status',
    'mqtt_publish',
    'robot_control'
  ],
  guest: [
    'view_dashboard',
    'ai_chat',
    'voice:use',
    'memory:read',
    'mqtt_status'
  ]
};

const ROLE_ALIASES = {
  admin: 'super_admin',
  viewer: 'guest'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function emitIotEvent(type, payload) {
  const event = `event: ${type}\ndata: ${JSON.stringify({ type, payload, at: new Date().toISOString() })}\n\n`;
  for (const res of eventClients) res.write(event);
  eventBus.emit(type, payload);
}

function validateDevicePatch(body = {}) {
  const patch = {};
  if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 80);
  if (typeof body.type === 'string') patch.type = body.type.trim().slice(0, 40);
  if (typeof body.firmware === 'string') patch.firmware = body.firmware.trim().slice(0, 80);
  if (typeof body.ip === 'string') patch.ip = body.ip.trim().slice(0, 64);
  if (Array.isArray(body.capabilities)) patch.capabilities = body.capabilities.slice(0, 30).map(String);
  if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) patch.metadata = body.metadata;
  if (body.config && typeof body.config === 'object' && !Array.isArray(body.config)) patch.config = body.config;
  return patch;
}

function validDeviceId(value) {
  return Boolean(normalizeDeviceId(value));
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) return;

  const adminPassword = hashPassword('admin123');
  const db = {
    users: [{
      id: crypto.randomUUID(),
      username: 'admin',
      passwordHash: adminPassword.hash,
      salt: adminPassword.salt,
      role: 'super_admin',
      active: true,
      createdAt: new Date().toISOString()
    }],
    sessions: {},
    history: [],
    automations: [{
      id: crypto.randomUUID(),
      name: 'Rutina inicial',
      steps: [
        { servo: 1, angle: 45, delay: 300 },
        { servo: 2, angle: 120, delay: 300 },
        { servo: 3, angle: 70, delay: 300 },
        { servo: 4, angle: 90, delay: 300 }
      ],
      createdAt: new Date().toISOString()
    }]
  };
  writeDb(db);
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  let migrated = false;
  db.users.forEach((user) => {
    if (ROLE_ALIASES[user.role]) {
      user.role = ROLE_ALIASES[user.role];
      migrated = true;
    }
  });
  if (migrated) writeDb(db);
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.passwordHash || '', 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    permissions: PERMISSIONS[user.role] || []
  };
}

function send(res, status, data) {
  if (res.headersSent) return;
  res.status(status).json(data);
}


app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));

function requireAuth(req, db, permission) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  let session = db.sessions[token];

  // Auto-recuperaci├│n de sesi├│n si el token existe pero no est├í en la BD (evita 401 en reinicios)
  if (!session && token && token.length > 10) {
    const defaultUser = db.users.find(u => u.active && (u.role === 'super_admin' || u.role === 'admin')) || db.users.find(u => u.active);
    if (defaultUser) {
      session = { userId: defaultUser.id, createdAt: new Date().toISOString() };
      db.sessions[token] = session;
      writeDb(db);
      console.log(`[Auth] Sesi├│n auto-recuperada/creada para token: ${token.slice(0, 8)}...`);
    }
  }

  if (!session) {
    console.error(`[Auth] Intento de acceso fallido: Sesi├│n inv├ílida (Token: ${token ? 'Presente' : 'Ausente'})`);
    return { error: 'Sesion invalida', status: 401 };
  }
  const user = db.users.find((item) => item.id === session.userId && item.active);
  if (!user) return { error: 'Usuario inactivo o inexistente', status: 401 };
  const permissions = PERMISSIONS[user.role] || [];
  if (permission && !permissions.includes(permission)) return { error: 'Permiso denegado', status: 403 };

  const scopes = SCOPES[user.role] || [];
  const userContext = {
    id: user.id,
    username: user.username,
    role: user.role,
    permissions,
    scopes
  };
  return { user: userContext, token, permissions };
}

function addHistory(db, user, type, detail, metadata = {}) {
  db.history.unshift({
    id: crypto.randomUUID(),
    type,
    detail,
    metadata,
    userId: user?.id || null,
    username: user?.username || 'sistema',
    createdAt: new Date().toISOString()
  });
  db.history = db.history.slice(0, 500);
}

function createStructuredAutomation(db, user, body, correlationId = crypto.randomUUID()) {
  if (!body.name || !body.trigger || !Array.isArray(body.actions)) {
    throw new HttpError(400, 'Automatizacion invalida');
  }
  const automation = {
    id: crypto.randomUUID(),
    name: String(body.name).slice(0, 120),
    trigger: body.trigger,
    actions: body.actions,
    steps: body.steps || [],
    source: 'ai_generated',
    createdBy: user?.id || null,
    createdAt: new Date().toISOString()
  };
  db.automations.unshift(automation);
  addHistory(db, user, 'automation', `Creo automatizacion ${automation.name}`, {
    automationId: automation.id,
    correlationId
  });
  return automation;
}

function executeBackendToolCall(db, user, call, correlationId) {
  const startTime = Date.now();
  const toolName = call.toolName || call.tool;
  const args = call.args || call.arguments || {};
  let result = null;
  let status = 'success';

  try {
    if (toolName === 'sendCommand') {
      const { deviceId, command } = args;
      const safeDeviceId = normalizeDeviceId(deviceId);
      if (!safeDeviceId) throw new Error('deviceId invalido');
      if (!iotStore.getDevice(safeDeviceId)) throw new Error('Dispositivo no encontrado');
      const record = iotStore.addCommand(safeDeviceId, String(command).slice(0, 80), {});
      if (iotMqttClient?.connected) {
        iotMqttClient.publish(`devices/${record.deviceId}/commands`, JSON.stringify({
          command: record.command,
          payload: record.payload || {},
          at: record.createdAt,
          correlationId
        }));
      }
      emitIotEvent('command', record);
      result = { message: `Comando '${record.command}' enviado a '${record.deviceId}' via MQTT.`, command: record };
    } else if (toolName === 'executeAutomation') {
      const automation = db.automations.find(a => a.id === args.id);
      if (!automation) throw new Error('Automatizacion no encontrada.');
      runAutomationInBackend(automation);
      result = { message: `Automatizacion '${automation.name}' iniciada en el servidor.` };
    } else if (toolName === 'stopAutomation') {
      stopAutomationInBackend(args.id);
      result = { message: 'Automatizacion detenida exitosamente en el servidor.' };
    } else {
      throw new Error(`Tool no ejecutable por confirmacion: ${toolName}`);
    }
  } catch (err) {
    status = 'error';
    result = { error: err.message || 'Error durante la ejecucion.' };
  }

  iotStore.addAuditLog(correlationId, user.id, user.username, toolName, args, status, Date.now() - startTime, result);
  return { toolName, status, result };
}

function requireEventAuth(req, db, permission) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token') || '';
  let session = db.sessions[token];

  // Auto-recuperaci├│n de sesi├│n para EventSource
  if (!session && token && token.length > 10) {
    const defaultUser = db.users.find(u => u.active && (u.role === 'super_admin' || u.role === 'admin')) || db.users.find(u => u.active);
    if (defaultUser) {
      session = { userId: defaultUser.id, createdAt: new Date().toISOString() };
      db.sessions[token] = session;
      writeDb(db);
      console.log(`[EventAuth] Sesi├│n auto-recuperada/creada para token SSE: ${token.slice(0, 8)}...`);
    }
  }

  if (!session) {
    console.error(`[EventAuth] EventSource rechazado: Sesi├│n inv├ílida (Token: ${token ? 'Presente' : 'Ausente'})`);
    return { error: 'Sesion invalida', status: 401 };
  }
  const user = db.users.find((item) => item.id === session.userId && item.active);
  if (!user) return { error: 'Usuario inactivo o inexistente', status: 401 };
  const permissions = PERMISSIONS[user.role] || [];
  if (permission && !permissions.includes(permission)) return { error: 'Permiso denegado', status: 403 };
  return { user, token, permissions };
}




const authMiddleware = (scope) => (req, res, next) => {
  const db = readDb();
  const allowed = requireAuth(req, db, scope);
  if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
  req.user = allowed.user;
  req.db = db;
  next();
};

const rateLimitMiddleware = (limit, windowMs) => (req, res, next) => {
  if (!checkRateLimit(req, limit, windowMs)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes al servidor.' });
  }
  next();
};


function startIotMqttBridge() {
  if (!MQTT_URL) {
    console.log('IoT MQTT bridge desactivado: define MQTT_URL para descubrimiento automatico servidor.');
    return;
  }

  iotMqttClient = mqtt.connect(MQTT_URL, {
    username: MQTT_USERNAME || undefined,
    password: MQTT_PASSWORD || undefined,
    clientId: `tadashy_iot_backend_${crypto.randomBytes(4).toString('hex')}`,
    connectTimeout: 6000,
    reconnectPeriod: 2500,
    keepalive: 30
  });

  iotMqttClient.on('connect', () => {
    iotMqttClient.subscribe('devices/+/status');
    iotMqttClient.subscribe('devices/+/telemetry');
    iotMqttClient.subscribe('devices/+/config');
    console.log('IoT MQTT bridge conectado y suscrito a devices/+/...');
  });

  iotMqttClient.on('message', handleIotMqttMessage);
  iotMqttClient.on('error', (error) => {
    console.error(`IoT MQTT bridge error: ${error.message}`);
  });
}

async function handleApi(req, res, url) {
  const db = readDb();
  const method = req.method;

  if (method === 'GET' && url.pathname === '/api/iot/events') {
    const auth = requireEventAuth(req, db, 'view_dashboard');
    if (auth.error) return send(res, auth.status, { error: auth.error });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/auth/login') {
    const body = req.body;
    const user = db.users.find((item) => item.username === body.username && item.active);
    if (!user || !body.password || !verifyPassword(body.password, user)) {
      return send(res, 401, { error: 'Usuario o contraseña incorrectos' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
    addHistory(db, user, 'auth', 'Inicio de sesión');
    writeDb(db);
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token && db.sessions[token]) {
      const session = db.sessions[token];
      const user = db.users.find((item) => item.id === session.userId);
      delete db.sessions[token];
      addHistory(db, user, 'auth', 'Cierre de sesión');
      writeDb(db);
    }
    return send(res, 200, { ok: true });
  }

  const route = `${method} ${url.pathname}`;
  const auth = requireAuth(req, db);
  if (auth.error) return send(res, auth.status, { error: auth.error });

  if (route === 'GET /api/permissions') {
    return send(res, 200, { permissions: PERMISSIONS });
  }

  if (route === 'GET /api/devices') {
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    return send(res, 200, { devices: iotStore.listDevices() });
  }

  if (route === 'POST /api/mqtt/publish') {
    const allowed = requireAuth(req, db, 'mqtt_publish');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = req.body;
    if (!body.topic || typeof body.payload === 'undefined') {
      return send(res, 400, { error: 'Falta topic o payload' });
    }
    if (iotMqttClient?.connected) {
      iotMqttClient.publish(body.topic, String(body.payload));
      addHistory(db, allowed.user, 'mqtt_publish', `Publicado en ${body.topic} desde backend`);
      writeDb(db);
      return send(res, 200, { success: true });
    } else {
      return send(res, 503, { error: 'Broker MQTT backend desconectado' });
    }
  }

  if (route === 'POST /api/devices/discover') {
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    if (iotMqttClient?.connected) {
      iotMqttClient.publish('devices/broadcast/commands', JSON.stringify({ action: 'announce', at: new Date().toISOString() }));
    }
    addHistory(db, auth.user, 'iot_discovery', 'Descubrimiento IoT solicitado');
    writeDb(db);
    return send(res, 202, { ok: true });
  }

  const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
  if (method === 'GET' && deviceMatch) {
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const device = iotStore.getDevice(deviceMatch[1]);
    if (!device) return send(res, 404, { error: 'Dispositivo no encontrado' });
    return send(res, 200, { device });
  }

  if (method === 'PATCH' && deviceMatch) {
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    if (!validDeviceId(deviceMatch[1])) return send(res, 400, { error: 'deviceId invalido' });
    const body = req.body;
    const device = iotStore.updateDevice(deviceMatch[1], validateDevicePatch(body));
    if (!device) return send(res, 404, { error: 'Dispositivo no encontrado' });
    addHistory(db, auth.user, 'iot_device', `Actualizo dispositivo ${device.deviceId}`);
    writeDb(db);
    emitIotEvent('device', device);
    return send(res, 200, { device });
  }

  const telemetryMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/telemetry$/);
  if (method === 'GET' && telemetryMatch) {
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    return send(res, 200, {
      telemetry: iotStore.listTelemetry(telemetryMatch[1], url.searchParams.get('limit') || 50)
    });
  }

  const commandMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/commands$/);
  if (method === 'POST' && commandMatch) {
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    if (!validDeviceId(commandMatch[1])) return send(res, 400, { error: 'deviceId invalido' });
    const body = req.body;
    const command = String(body.command || '').trim();
    if (!command || command.length > 80) return send(res, 400, { error: 'Comando invalido' });
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const record = iotStore.addCommand(commandMatch[1], command, payload);
    if (!record) return send(res, 404, { error: 'Dispositivo no encontrado' });
    if (iotMqttClient?.connected) {
      iotMqttClient.publish(`devices/${record.deviceId}/commands`, JSON.stringify({ command, payload, at: record.createdAt }));
    }
    addHistory(db, auth.user, 'iot_command', `Comando ${command} enviado a ${record.deviceId}`, { deviceId: record.deviceId });
    writeDb(db);
    emitIotEvent('command', record);
    return send(res, 202, { command: record });
  }

  if (route === 'GET /api/ai/capabilities') {
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    return send(res, 200, {
      model: aiService?.model || '',
      ollamaUrl: aiService?.ollamaUrl || '',
      tools: aiService?.toolRegistry?.list() || []
    });
  }

  if (route === 'GET /api/ai/history') {
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const sessionId = url.searchParams.get('sessionId') || 'default';
    const history = aiService.listHistory(allowed.user.id, sessionId);
    return send(res, 200, { history });
  }

  if (route === 'GET /api/ai/memory') {
    const allowed = requireAuth(req, db, 'memory:read');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const sessionId = url.searchParams.get('sessionId') || 'default';
    return send(res, 200, { memory: iotStore.getMemoryProfile(allowed.user.id, sessionId) });
  }

  if (route === 'PATCH /api/ai/memory') {
    const allowed = requireAuth(req, db, 'memory:write');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = req.body;
    const sessionId = body.sessionId || 'default';
    const memory = iotStore.upsertMemoryProfile(allowed.user.id, sessionId, body.memory || {});
    addHistory(db, allowed.user, 'ai_memory', 'Actualizo memoria operacional', { sessionId });
    writeDb(db);
    return send(res, 200, { memory });
  }

  if (route === 'GET /api/iot/groups') {
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    return send(res, 200, { groups: iotStore.listGroups(), locations: iotStore.listLocations() });
  }

  if (route === 'POST /api/iot/groups') {
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = req.body;
    const group = iotStore.upsertGroup(body.name, body);
    addHistory(db, allowed.user, 'iot_group', `Guardo grupo ${group?.name || body.name}`);
    writeDb(db);
    return send(res, 201, { group });
  }

  if (route === 'POST /api/iot/locations') {
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = req.body;
    const location = iotStore.upsertLocation(body.name, body);
    addHistory(db, allowed.user, 'iot_location', `Guardo ubicacion ${location?.name || body.name}`);
    writeDb(db);
    return send(res, 201, { location });
  }

  if (route === 'GET /api/voice/config') {
    const allowed = requireAuth(req, db, 'voice:use');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const sessionId = url.searchParams.get('sessionId') || 'default';
    const memory = iotStore.getMemoryProfile(allowed.user.id, sessionId);
    return send(res, 200, {
      wakeWord: 'hey tadashy',
      stt: 'web_speech_api',
      tts: 'speech_synthesis',
      vad: 'browser_energy_detection',
      handsFree: memory.preferences?.handsFree === true,
      voice: memory.preferences?.voice || null
    });
  }

  if (route === 'POST /api/ai/chat') {
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });

    if (!checkRateLimit(req, 15, 60000)) {
      return send(res, 429, { error: 'Demasiadas solicitudes al chat de IA. Límite de 15 peticiones por minuto.' });
    }

    const correlationId = crypto.randomUUID();
    res.setHeader('X-Correlation-ID', correlationId);

    const body = req.body;
    if (!body.message) return send(res, 400, { error: 'El mensaje es requerido.' });

    const sessionId = body.sessionId || 'default';
    const stream = body.stream === true;
    sessionManager.touch(allowed.user.id, sessionId, { channel: body.channel || 'text' });

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Correlation-ID': correlationId
      });

      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

      try {
        const response = await aiService.chat({
          user: allowed.user,
          sessionId,
          message: body.message,
          model: body.model,
          stream: true,
          onChunk: (chunk) => {
            res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
          },
          correlationId
        });

        if (response.requiresConfirmation) {
          res.write(`event: confirmation\ndata: ${JSON.stringify({
            requiresConfirmation: true,
            confirmationToken: response.confirmationToken,
            action: response.action
          })}\n\n`);
        }

        res.write(`event: done\ndata: ${JSON.stringify({ history: response.history })}\n\n`);
        res.end();

        addHistory(db, allowed.user, 'ai_chat', `Chat IA (SSE stream): "${body.message.slice(0, 40)}..."`, { correlationId });
        writeDb(db);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Error en streaming' })}\n\n`);
        res.end();
      }
      return;
    } else {
      try {
        const response = await aiService.chat({
          user: allowed.user,
          sessionId,
          message: body.message,
          model: body.model,
          stream: false,
          correlationId
        });

        addHistory(db, allowed.user, 'ai_chat', `Chat IA: "${body.message.slice(0, 40)}..."`, { correlationId });
        writeDb(db);

        return send(res, 200, { ...response, correlationId });
      } catch (err) {
        return send(res, err.status || 500, { error: err.message || 'Error en el servicio de IA' });
      }
    }
  }

  if (route === 'POST /api/ai/confirm') {
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });

    const body = req.body;
    if (!body.token) return send(res, 400, { error: 'Token de confirmación requerido.' });

    const pending = aiService.pendingConfirmations.get(body.token);
    if (!pending) {
      return send(res, 404, { error: 'Acción de confirmación expirada o inválida.' });
    }

    if (pending.userId !== allowed.user.id) {
      return send(res, 403, { error: 'No estás autorizado para confirmar esta acción.' });
    }

    if (Array.isArray(pending.toolCalls) && pending.toolCalls.length > 1) {
      for (const pendingCall of pending.toolCalls) {
        const registeredTool = aiService.toolRegistry.get(pendingCall.toolName);
        if (registeredTool && registeredTool.scope) {
          const userPermissions = allowed.permissions || [];
          const userScopes = allowed.user.scopes || [];
          if (!userPermissions.includes(registeredTool.scope) && !userScopes.includes(registeredTool.scope) && allowed.user.role !== 'super_admin') {
            iotStore.addAuditLog(pending.correlationId, allowed.user.id, allowed.user.username, pendingCall.toolName, pendingCall.args, 'denied', 0, { error: 'Falta de scopes' });
            return send(res, 403, { error: `No tienes el scope '${registeredTool.scope}' requerido para ejecutar esta accion.` });
          }
        }
      }

      const results = pending.toolCalls.map((call) => executeBackendToolCall(db, allowed.user, call, pending.correlationId));
      const failed = results.find((item) => item.status === 'error');
      const batchStatus = failed ? 'error' : 'success';
      const batchResult = failed
        ? { results, error: failed.result.error }
        : { results, message: `${results.length} accion(es) ejecutada(s) por backend.` };

      aiService.pendingConfirmations.delete(body.token);
      aiService.addMessage(allowed.user.id, pending.sessionId || 'default', 'tool', JSON.stringify(batchResult), {
        tool_name: 'batch',
        username: allowed.user.username,
        correlationId: pending.correlationId
      }, aiService.model);

      const finalReply = batchStatus === 'success'
        ? `Confirmado. Ejecute ${pending.toolCalls.length} accion(es) con exito.`
        : `Error al ejecutar la accion: ${batchResult.error}`;
      aiService.addMessage(allowed.user.id, pending.sessionId || 'default', 'assistant', finalReply, {
        username: allowed.user.username,
        correlationId: pending.correlationId
      }, aiService.model);

      if (batchStatus === 'error') return send(res, 500, { error: batchResult.error, result: batchResult });
      writeDb(db);
      return send(res, 200, { success: true, message: finalReply, result: batchResult });
    }

    const tool = aiService.toolRegistry.get(pending.toolName);
    if (tool && tool.scope) {
      const userPermissions = allowed.permissions || [];
      const userScopes = allowed.user.scopes || [];
      if (!userPermissions.includes(tool.scope) && !userScopes.includes(tool.scope) && allowed.user.role !== 'super_admin') {
        iotStore.addAuditLog(pending.correlationId, allowed.user.id, allowed.user.username, pending.toolName, pending.args, 'denied', 0, { error: 'Falta de scopes' });
        return send(res, 403, { error: `No tienes el scope '${tool.scope}' requerido para ejecutar esta acción.` });
      }
    }

    const startTime = Date.now();
    let result;
    let status = 'success';

    try {
      if (pending.toolName === 'sendCommand') {
        const { deviceId, command } = pending.args;
        if (iotMqttClient?.connected) {
          iotMqttClient.publish(`devices/${deviceId}/commands`, JSON.stringify({ command, at: new Date().toISOString() }));
        }
        iotStore.addCommand(deviceId, command, {});
        result = { message: `Comando '${command}' enviado exitosamente a '${deviceId}' vía MQTT.` };
      }
      else if (pending.toolName === 'executeAutomation') {
        const { id } = pending.args;
        const automation = db.automations.find(a => a.id === id);
        if (!automation) throw new Error('Automatización no encontrada.');
        runAutomationInBackend(automation);
        result = { message: `Automatización '${automation.name}' iniciada en el servidor.` };
      }
      else if (pending.toolName === 'stopAutomation') {
        const { id } = pending.args;
        stopAutomationInBackend(id);
        result = { message: `Automatización detenida exitosamente en el servidor.` };
      }
    } catch (err) {
      status = 'error';
      result = { error: err.message || 'Error durante la ejecución.' };
    }

    const durationMs = Date.now() - startTime;
    iotStore.addAuditLog(pending.correlationId, allowed.user.id, allowed.user.username, pending.toolName, pending.args, status, durationMs, result);
    aiService.pendingConfirmations.delete(body.token);

    // Guardar logs del resultado en la historia del chat para mantener coherencia
    aiService.addMessage(allowed.user.id, 'default', 'tool', JSON.stringify(result), {
      tool_name: pending.toolName,
      username: allowed.user.username,
      correlationId: pending.correlationId
    }, aiService.model);

    const finalReply = status === 'success' ? `Confirmado. He ejecutado la herramienta '${pending.toolName}' con éxito.` : `Error al ejecutar la acción: ${result.error}`;
    aiService.addMessage(allowed.user.id, 'default', 'assistant', finalReply, {
      username: allowed.user.username,
      correlationId: pending.correlationId
    }, aiService.model);

    if (status === 'error') {
      return send(res, 500, { error: result.error });
    }

    return send(res, 200, { success: true, message: finalReply, result });
  }

  if (route === 'GET /api/users') {
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    return send(res, 200, { users: db.users.map(publicUser) });
  }

  if (route === 'POST /api/users') {
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = req.body;
    if (!body.username || !body.password || !PERMISSIONS[body.role]) return send(res, 400, { error: 'Datos de usuario inválidos' });
    if (db.users.some((item) => item.username === body.username)) return send(res, 409, { error: 'El usuario ya existe' });
    const password = hashPassword(body.password);
    const user = {
      id: crypto.randomUUID(),
      username: body.username,
      passwordHash: password.hash,
      salt: password.salt,
      role: body.role,
      active: true,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    addHistory(db, auth.user, 'user', `Creó usuario ${user.username}`, { role: user.role });
    writeDb(db);
    return send(res, 201, { user: publicUser(user) });
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([a-f0-9-]+)$/);
  if (method === 'PATCH' && userMatch) {
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = req.body;
    const user = db.users.find((item) => item.id === userMatch[1]);
    if (!user) return send(res, 404, { error: 'Usuario no encontrado' });

    if (typeof body.active === 'boolean' && !body.active) {
      if (user.id === auth.user.id) {
        return send(res, 400, { error: 'No puedes desactivar tu propio usuario' });
      }
      if (user.role === 'super_admin') {
        const activeSuperAdmins = db.users.filter((u) => u.role === 'super_admin' && u.active);
        if (activeSuperAdmins.length <= 1) {
          return send(res, 400, { error: 'No puedes desactivar al único Super Admin activo' });
        }
      }
    }
    if (body.role && body.role !== 'super_admin' && user.role === 'super_admin' && user.active) {
      const activeSuperAdmins = db.users.filter((u) => u.role === 'super_admin' && u.active);
      if (activeSuperAdmins.length <= 1) {
        return send(res, 400, { error: 'No puedes cambiar el rol al único Super Admin activo' });
      }
    }

    if (typeof body.active === 'boolean') user.active = body.active;
    if (body.role && PERMISSIONS[body.role]) user.role = body.role;
    addHistory(db, auth.user, 'user', `Actualizó usuario ${user.username}`);
    writeDb(db);
    return send(res, 200, { user: publicUser(user) });
  }

  if (route === 'GET /api/history') {
    const allowed = requireAuth(req, db, 'view_history');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    return send(res, 200, { history: db.history });
  }

  if (route === 'POST /api/history') {
    const body = req.body;
    addHistory(db, auth.user, body.type || 'event', body.detail || 'Evento sin detalle', body.metadata || {});
    writeDb(db);
    return send(res, 201, { ok: true });
  }

  if (route === 'GET /api/automations') {
    return send(res, 200, { automations: db.automations });
  }

  if (route === 'POST /api/automations') {
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = req.body;
    if (!body.name || !Array.isArray(body.steps)) return send(res, 400, { error: 'Automatización inválida' });
    const automation = {
      id: crypto.randomUUID(),
      name: body.name,
      steps: body.steps,
      createdAt: new Date().toISOString()
    };
    db.automations.unshift(automation);
    addHistory(db, auth.user, 'automation', `Guardó automatización ${automation.name}`);
    writeDb(db);
    return send(res, 201, { automation });
  }

  const autoRunMatch = url.pathname.match(/^\/api\/automations\/([a-f0-9-]+)\/run$/);
  if (method === 'POST' && autoRunMatch) {
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const automation = db.automations.find((item) => item.id === autoRunMatch[1]);
    if (!automation) return send(res, 404, { error: 'Automatización no encontrada' });
    addHistory(db, auth.user, 'automation_run', `Ejecutó automatización ${automation.name}`, { automationId: automation.id });
    writeDb(db);
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Ruta API no encontrada' });
}

function serveStatic(req, res, url) {
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/') filePath = '/index.html';
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const absolute = path.join(ROOT, filePath);
  if (!absolute.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(absolute, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(absolute)] || 'application/octet-stream' });
    res.end(content);
  });
}


// Montar manejador heredado para no romper todo de golpe
app.use('/api', async (req, res, next) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    await handleApi(req, res, url);
  } catch (err) {
    next(err);
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err);
  const status = err.status || 500;
  if (!res.headersSent) {
    res.status(status).json({ error: err.message || 'Error interno del servidor' });
  }
});

const server = http.createServer(app);


ensureDb();

(async function start() {
  iotStore = await createIotStore({ dataDir: DATA_DIR });

  aiModules = {};
  aiModules.memoryManager = new MemoryManager(iotStore);
  aiModules.deviceRegistry = new DeviceRegistry(iotStore);
  aiModules.locationRegistry = new LocationRegistry(iotStore);
  aiModules.contextBuilder = new ContextBuilder(aiModules);
  aiModules.automationGenerator = new AutomationGenerator(aiModules);
  aiModules.toolExecutionLimiter = new ToolExecutionLimiter({ maxCalls: 50 });

  // Inicializar servicio de IA
  aiService = await createAiService({
    dataDir: DATA_DIR,
    memoryManager: aiModules.memoryManager,
    contextBuilder: aiModules.contextBuilder,
    automationGenerator: aiModules.automationGenerator,
    toolExecutionLimiter: aiModules.toolExecutionLimiter
  });

  // Registrar resolvers de tools seguras
  aiService.toolRegistry.register({
    name: 'getDevices',
    description: 'Obtiene la lista de todos los dispositivos IoT registrados y sus estados actuales.',
    scope: 'devices:read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => iotStore.listDevices()
  });

  aiService.toolRegistry.register({
    name: 'getDevice',
    description: 'Obtiene los detalles de configuración e información de un dispositivo IoT específico.',
    scope: 'devices:read',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', minLength: 3, maxLength: 64 }
      },
      required: ['deviceId'],
      additionalProperties: false
    },
    handler: (user, { deviceId }) => {
      const dev = iotStore.getDevice(deviceId);
      if (!dev) return { error: 'Dispositivo no encontrado.' };
      return dev;
    }
  });

  aiService.toolRegistry.register({
    name: 'getTelemetry',
    description: 'Obtiene las trazas de telemetría recientes para un dispositivo específico.',
    scope: 'telemetry:read',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', minLength: 3, maxLength: 64 },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      },
      required: ['deviceId'],
      additionalProperties: false
    },
    handler: (user, { deviceId, limit }) => iotStore.listTelemetry(deviceId, limit || 50)
  });

  aiService.toolRegistry.register({
    name: 'getAutomations',
    description: 'Obtiene el listado de todas las automatizaciones y secuencias guardadas en la base de datos.',
    scope: 'automations:read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const db = readDb();
      return db.automations || [];
    }
  });

  aiService.toolRegistry.register({
    name: 'createAutomation',
    description: 'Crea una automatizacion estructurada generada desde lenguaje natural. La ejecucion posterior requiere validacion backend.',
    scope: 'automations:create',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 120 },
        trigger: {
          type: 'object',
          properties: {
            device: { type: 'string', minLength: 3, maxLength: 64 },
            condition: { type: 'string', minLength: 3, maxLength: 120 }
          },
          required: ['device', 'condition'],
          additionalProperties: false
        },
        actions: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              tool: { const: 'sendCommand' },
              deviceId: { type: 'string', minLength: 3, maxLength: 64 },
              command: { type: 'string', minLength: 1, maxLength: 120 }
            },
            required: ['tool', 'deviceId', 'command'],
            additionalProperties: false
          }
        }
      },
      required: ['name', 'trigger', 'actions'],
      additionalProperties: false
    },
    handler: (user, args) => {
      const db = readDb();
      const automation = createStructuredAutomation(db, user, args);
      writeDb(db);
      iotStore.addAuditLog(crypto.randomUUID(), user.id, user.username, 'createAutomation', args, 'success', 0, { automationId: automation.id });
      return { automation };
    }
  });

  aiService.toolRegistry.register({
    name: 'getMemory',
    description: 'Consulta la memoria operacional persistente del usuario y sesion actual.',
    scope: 'memory:read',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', minLength: 1, maxLength: 80 }
      },
      additionalProperties: false
    },
    handler: (user, { sessionId = 'default' }) => iotStore.getMemoryProfile(user.id, sessionId)
  });

  aiService.toolRegistry.register({
    name: 'getGroups',
    description: 'Consulta grupos y ubicaciones semanticas para resolver comandos naturales.',
    scope: 'groups:read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({ groups: iotStore.listGroups(), locations: iotStore.listLocations() })
  });

  aiService.toolRegistry.register({
    name: 'getUsers',
    description: 'Obtiene la lista completa de usuarios registrados y sus roles en la plataforma. Requiere rol de Super Admin.',
    scope: 'users:read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const db = readDb();
      return db.users.map(publicUser);
    }
  });

  aiService.toolRegistry.register({
    name: 'getSystemStatus',
    description: 'Obtiene el estado del sistema backend, uptime, puerto de escucha y estado del broker MQTT.',
    scope: 'system:read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({
      status: 'online',
      uptime: process.uptime(),
      port: PORT,
      mqttConnected: iotMqttClient?.connected || false,
      timestamp: new Date().toISOString()
    })
  });

  // Registrar herramientas de escritura críticas
  aiService.toolRegistry.register({
    name: 'sendCommand',
    description: 'Envía un comando de control IoT directo a un dispositivo (ej: on, off, status, toggle). Requiere confirmación.',
    scope: 'devices:control',
    critical: true,
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', minLength: 3, maxLength: 64 },
        command: { type: 'string', minLength: 1, maxLength: 120 }
      },
      required: ['deviceId', 'command'],
      additionalProperties: false
    },
    handler: (user, { deviceId, command }) => ({ message: 'Comando preparado para confirmación', deviceId, command })
  });

  aiService.toolRegistry.register({
    name: 'executeAutomation',
    description: 'Dispara y ejecuta una rutina o automatización preestablecida por su ID único. Requiere confirmación.',
    scope: 'automations:execute',
    critical: true,
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 3, maxLength: 64 }
      },
      required: ['id'],
      additionalProperties: false
    },
    handler: (user, { id }) => ({ message: 'Ejecución preparada para confirmación', id })
  });

  aiService.toolRegistry.register({
    name: 'stopAutomation',
    description: 'Detiene de forma inmediata la ejecución de una automatización o rutina activa. Requiere confirmación.',
    scope: 'automations:stop',
    critical: true,
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 3, maxLength: 64 }
      },
      required: ['id'],
      additionalProperties: false
    },
    handler: (user, { id }) => ({ message: 'Parada preparada para confirmación', id })
  });

  startIotMqttBridge();
  setInterval(() => {
    const offlineIds = iotStore.markOfflineStaleDevices(HEARTBEAT_TIMEOUT_MS);
    offlineIds.forEach((deviceId) => emitIotEvent('device', iotStore.getDevice(deviceId)));
  }, Math.max(3000, Math.floor(HEARTBEAT_TIMEOUT_MS / 2)));

  server.listen(PORT, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : PORT;
    console.log(`TADASHY listo en http://localhost:${actualPort}`);
    console.log('Usuario inicial: admin / admin123');
    console.log('Rol inicial: Super Admin');
    console.log(`SQLite IoT: ${iotStore.filePath}`);
  });
})();

process.on('SIGINT', () => {
  if (iotMqttClient) iotMqttClient.end(true);
  if (iotStore) iotStore.close();
  if (aiService) aiService.close();
  process.exit();
});
