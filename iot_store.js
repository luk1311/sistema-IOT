// IoT store respaldado por Firebase Firestore (con caché en memoria).
// Diseñado para el plan gratuito de Render (filesystem efímero): el estado vive
// en memoria, se carga de Firestore al arranque y se persiste write-through
// (fire-and-forget). La API pública es SÍNCRONA e idéntica a la versión SQLite,
// para no cambiar a sus consumidores (server.js, rutas, alert-engine, ai_core).
const crypto = require('crypto');
const {
  validateEntities,
  findDuplicateEntityIds,
  deriveCapabilities
} = require('./src/schemas/device-schema');
const { validateRule } = require('./src/schemas/rule-schema');

const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;
const MAX_TELEMETRY_PER_DEVICE = 500;
const MAX_ALERTS = 1000;
const MAX_TELEMETRY_DEPTH = 4;
const MAX_TELEMETRY_KEYS = 80;

// Entidades por defecto del brazo robótico (4 servos como capacidades `range`).
const BRAZO_ENTITIES = [
  { id: 'base', name: 'Base', capability: 'range', min: 0, max: 180, step: 1, unit: '°', default: 90,
    mqtt: { set: 'brazo/servo/1', state: 'brazo/servo/feedback/1' }, ui: { icon: 'ti-rotate-clockwise', order: 1 } },
  { id: 'shoulder', name: 'Hombro', capability: 'range', min: 0, max: 180, step: 1, unit: '°', default: 90,
    mqtt: { set: 'brazo/servo/2', state: 'brazo/servo/feedback/2' }, ui: { icon: 'ti-arrow-up', order: 2 } },
  { id: 'elbow', name: 'Codo', capability: 'range', min: 0, max: 180, step: 1, unit: '°', default: 90,
    mqtt: { set: 'brazo/servo/3', state: 'brazo/servo/feedback/3' }, ui: { icon: 'ti-fold-up', order: 3 } },
  { id: 'wrist', name: 'Muñeca', capability: 'range', min: 0, max: 180, step: 1, unit: '°', default: 90,
    mqtt: { set: 'brazo/servo/4', state: 'brazo/servo/feedback/4' }, ui: { icon: 'ti-hand-grab', order: 4 } }
];

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeDeviceId(deviceId) {
  const id = String(deviceId || '').trim();
  if (!DEVICE_ID_RE.test(id)) return null;
  return id;
}

function sanitizeTelemetry(value, depth = 0, state = { keys: 0 }) {
  if (depth > MAX_TELEMETRY_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(/ignore\s+(?:previous|system|instructions|rules)/ig, '[filtered]')
      .replace(/ignora\s+(?:instrucciones|reglas)/ig, '[filtered]')
      .slice(0, 1000);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeTelemetry(item, depth + 1, state));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (state.keys >= MAX_TELEMETRY_KEYS) break;
      const safeKey = String(key).replace(/[^\w.-]/g, '_').slice(0, 64);
      if (/prompt|instruction|system|password|secret|token/i.test(safeKey)) continue;
      state.keys++;
      out[safeKey] = sanitizeTelemetry(item, depth + 1, state);
    }
    return out;
  }
  return String(value).slice(0, 1000);
}

// doc id seguro para Firestore (sin '/'): para nombres de grupos/ubicaciones.
function safeDocId(name) {
  return String(name || '').replace(/[^\w-]/g, '_').slice(0, 120) || 'x';
}

// doc id para suscripciones push (el endpoint es una URL larga).
function subDocId(endpoint) {
  return crypto.createHash('sha1').update(String(endpoint || '')).digest('hex');
}

async function createIotStore({ firestore = null } = {}) {
  // --- Estado en memoria ---
  const devices = new Map();          // deviceId -> device
  const telemetry = new Map();        // deviceId -> row[]  (solo memoria)
  const alerts = [];                  // newest-first
  const pushSubs = new Map();         // endpoint -> sub
  const groups = new Map();           // name -> group
  const locations = new Map();        // name -> location
  const memoryProfiles = new Map();   // `${userId}::${sessionId}` -> profile
  const rules = new Map();            // ruleId -> rule
  const contextCache = new Map();     // key -> { value, expiresAt }
  const events = [];
  const commands = [];
  const auditLogs = [];
  let telemetrySeq = 0;

  // --- Persistencia write-through (fire-and-forget) ---
  function persist(coll, id, data) {
    if (!firestore) return;
    firestore.collection(coll).doc(String(id)).set(data).catch(() => {});
  }
  function unpersist(coll, id) {
    if (!firestore) return;
    firestore.collection(coll).doc(String(id)).delete().catch(() => {});
  }

  // --- Carga inicial desde Firestore ---
  if (firestore) {
    try {
      const [dev, al, ps, gr, loc, mp, rl] = await Promise.all([
        firestore.collection('iot_devices').get(),
        firestore.collection('iot_alerts').get(),
        firestore.collection('push_subscriptions').get(),
        firestore.collection('device_groups').get(),
        firestore.collection('iot_locations').get(),
        firestore.collection('memory_profiles').get(),
        firestore.collection('iot_rules').get()
      ]);
      dev.docs.forEach((d) => { const v = d.data(); if (v && v.deviceId) devices.set(v.deviceId, v); });
      al.docs.forEach((d) => { const v = d.data(); if (v) alerts.push(v); });
      alerts.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
      ps.docs.forEach((d) => { const v = d.data(); if (v && v.endpoint) pushSubs.set(v.endpoint, v); });
      gr.docs.forEach((d) => { const v = d.data(); if (v && v.name) groups.set(v.name, v); });
      loc.docs.forEach((d) => { const v = d.data(); if (v && v.name) locations.set(v.name, v); });
      mp.docs.forEach((d) => { const v = d.data(); if (v && v.userId) memoryProfiles.set(`${v.userId}::${v.sessionId || 'default'}`, v); });
      rl.docs.forEach((d) => { const v = d.data(); if (v && v.id) rules.set(v.id, v); });
      console.log(`[IoT] Cargado de Firestore: ${devices.size} dispositivos, ${alerts.length} alertas, ${pushSubs.size} suscripciones, ${rules.size} reglas.`);
    } catch (e) {
      console.warn('[IoT] No se pudo cargar de Firestore:', e.message);
    }
  }

  // --- Dispositivos ---
  function getDevice(deviceId) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    return devices.get(id) || null;
  }

  function listDevices() {
    return [...devices.values()].sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
  }

  function registerDevice(deviceId, patch = {}) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    const current = devices.get(id) || null;
    const ts = nowIso();

    // --- Modelo de entidades (Fase 0): validar solo si vienen entidades explícitas ---
    const entitiesProvided = patch.entities !== undefined
      || (patch.config && patch.config.entities !== undefined);
    const resolvedEntities = patch.entities !== undefined
      ? patch.entities
      : (patch.config && patch.config.entities !== undefined)
        ? patch.config.entities
        : (current ? (current.entities || []) : []);

    if (entitiesProvided) {
      if (!Array.isArray(resolvedEntities)) throw new Error('entities debe ser un array');
      const { valid, errors } = validateEntities(resolvedEntities);
      if (!valid) throw new Error('Entidades invalidas: ' + JSON.stringify(errors));
      const dups = findDuplicateEntityIds(resolvedEntities);
      if (dups.length) throw new Error('IDs de entidad duplicados: ' + dups.join(', '));
    }

    const safeEntities = Array.isArray(resolvedEntities) ? resolvedEntities : [];
    const baseConfig = patch.config || (current && current.config) || {};
    const mergedConfig = (safeEntities.length || entitiesProvided)
      ? { ...baseConfig, entities: safeEntities }
      : baseConfig;
    const capabilities = safeEntities.length
      ? deriveCapabilities(safeEntities)
      : (patch.capabilities || (current && current.capabilities) || []);

    const device = {
      deviceId: id,
      name: String(patch.name || (current && current.name) || id).slice(0, 80),
      type: String(patch.type || (current && current.type) || 'esp32').slice(0, 40),
      status: patch.status || (current && current.status) || 'online',
      area: (patch.area !== undefined ? patch.area : (current && current.area)) || '',
      firmware: patch.firmware || (current && current.firmware) || null,
      ip: patch.ip || (current && current.ip) || null,
      capabilities,
      entities: safeEntities,
      metadata: { ...((current && current.metadata) || {}), ...(patch.metadata || {}) },
      config: mergedConfig,
      lastTelemetry: patch.lastTelemetry || (current && current.lastTelemetry) || null,
      firstSeen: (current && current.firstSeen) || ts,
      lastSeen: patch.lastSeen || ts,
      updatedAt: ts
    };
    devices.set(id, device);
    persist('iot_devices', id, device);
    return device;
  }

  function updateDevice(deviceId, patch = {}) {
    const current = getDevice(deviceId);
    if (!current) return null;
    return registerDevice(current.deviceId, {
      ...current,
      ...patch,
      metadata: { ...(current.metadata || {}), ...(patch.metadata || {}) },
      lastSeen: current.lastSeen
    });
  }

  function setStatus(deviceId, status, metadata = {}) {
    const safeStatus = status === 'offline' ? 'offline' : 'online';
    const device = registerDevice(deviceId, { status: safeStatus, metadata });
    addEvent(deviceId, 'status', `Estado ${safeStatus}`, { status: safeStatus, metadata });
    return device;
  }

  // La telemetría NO se persiste a Firestore (evita agotar la cuota de escrituras).
  // Actualiza el dispositivo en memoria sin write-through; solo persiste si es nuevo.
  function addTelemetry(deviceId, topic, payload) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    const ts = nowIso();
    const parsed = sanitizeTelemetry(parseJson(payload, payload));

    const existing = devices.get(id);
    if (!existing) {
      registerDevice(id, { status: 'online', lastTelemetry: parsed, lastSeen: ts });
    } else {
      existing.status = 'online';
      existing.lastTelemetry = parsed;
      existing.lastSeen = ts;
      existing.updatedAt = ts;
      // sin persist: la telemetría es de alta frecuencia
    }

    const row = { id: ++telemetrySeq, deviceId: id, topic, payload: parsed, receivedAt: ts };
    const arr = telemetry.get(id) || [];
    arr.push(row);
    if (arr.length > MAX_TELEMETRY_PER_DEVICE) arr.splice(0, arr.length - MAX_TELEMETRY_PER_DEVICE);
    telemetry.set(id, arr);
    return row;
  }

  function listTelemetry(deviceId, limit = 50) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return [];
    const safe = Math.max(1, Math.min(Number(limit) || 50, 500));
    const arr = telemetry.get(id) || [];
    return arr.slice(-safe).reverse();
  }

  function addEvent(deviceId, type, detail, payload = null) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    const e = { deviceId: id, type, detail: String(detail).slice(0, 240), payload, createdAt: nowIso() };
    events.push(e);
    if (events.length > 2000) events.shift();
    return e;
  }

  function addCommand(deviceId, command, payload = {}) {
    const id = normalizeDeviceId(deviceId);
    if (!id || !devices.get(id)) return null;
    const c = { deviceId: id, command: String(command).slice(0, 80), payload, status: 'published', createdAt: nowIso() };
    commands.push(c);
    if (commands.length > 2000) commands.shift();
    return c;
  }

  function markOfflineStaleDevices(maxAgeMs) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const stale = [];
    for (const d of devices.values()) {
      if (d.status === 'online' && String(d.lastSeen || '') < cutoff) stale.push(d.deviceId);
    }
    stale.forEach((id) => setStatus(id, 'offline', { reason: 'heartbeat_timeout' }));
    return stale;
  }

  function addAuditLog(correlationId, userId, username, tool, args, status, durationMs, result = null) {
    const a = {
      correlationId, userId: String(userId), username, tool, arguments: args,
      status, durationMs: Number(durationMs), timestamp: nowIso(), result
    };
    auditLogs.push(a);
    if (auditLogs.length > 5000) auditLogs.shift();
    return a;
  }

  // --- Perfiles de memoria (IA) ---
  function getMemoryProfile(userId, sessionId = 'default') {
    const sid = sessionId || 'default';
    const p = memoryProfiles.get(`${userId}::${sid}`);
    if (!p) {
      return { preferences: {}, frequentDevices: [], usedLocations: [], createdAutomations: [], historySummary: '' };
    }
    return p;
  }

  function upsertMemoryProfile(userId, sessionId = 'default', patch = {}) {
    const sid = sessionId || 'default';
    const key = `${userId}::${sid}`;
    const current = memoryProfiles.get(key) || {};
    const next = {
      userId: String(userId),
      sessionId: sid,
      preferences: { ...(current.preferences || {}), ...(patch.preferences || {}) },
      frequentDevices: patch.frequentDevices || current.frequentDevices || [],
      usedLocations: patch.usedLocations || current.usedLocations || [],
      createdAutomations: patch.createdAutomations || current.createdAutomations || [],
      historySummary: String(patch.historySummary ?? current.historySummary ?? '').slice(0, 2000),
      updatedAt: nowIso()
    };
    memoryProfiles.set(key, next);
    persist('memory_profiles', `${userId}__${sid}`, next);
    return next;
  }

  // --- Grupos y ubicaciones ---
  function listGroups() {
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function upsertGroup(name, patch = {}) {
    const safe = String(name || '').trim().toLowerCase().slice(0, 80);
    if (!safe) return null;
    const g = {
      name: safe,
      aliases: patch.aliases || [],
      location: patch.location ? String(patch.location).slice(0, 80) : null,
      deviceIds: (patch.deviceIds || []).map(normalizeDeviceId).filter(Boolean),
      metadata: patch.metadata || {},
      updatedAt: nowIso()
    };
    groups.set(safe, g);
    persist('device_groups', safeDocId(safe), g);
    return g;
  }

  function listLocations() {
    return [...locations.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function upsertLocation(name, patch = {}) {
    const safe = String(name || '').trim().toLowerCase().slice(0, 80);
    if (!safe) return null;
    const l = {
      name: safe,
      aliases: patch.aliases || [],
      deviceIds: (patch.deviceIds || []).map(normalizeDeviceId).filter(Boolean),
      metadata: patch.metadata || {},
      updatedAt: nowIso()
    };
    locations.set(safe, l);
    persist('iot_locations', safeDocId(safe), l);
    return l;
  }

  // --- Caché de contexto (solo memoria) ---
  function setContextCache(key, value, ttlMs = 30000) {
    const k = String(key || '').slice(0, 160);
    if (!k) return null;
    const ts = nowIso();
    const expiresAt = new Date(Date.now() + Math.max(1000, Number(ttlMs) || 30000)).toISOString();
    contextCache.set(k, { value, expiresAt });
    return { key: k, value, expiresAt, updatedAt: ts };
  }

  function getContextCache(key) {
    const entry = contextCache.get(String(key || '').slice(0, 160));
    if (!entry || entry.expiresAt < nowIso()) return null;
    return entry.value;
  }

  // --- Alertas ---
  function addAlert({ deviceId, entityId = null, type, severity = 'warning', message }) {
    const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const alert = {
      id, deviceId: String(deviceId || ''), entityId, type: String(type),
      severity, message: String(message).slice(0, 240), status: 'unread', createdAt: nowIso()
    };
    alerts.unshift(alert);
    if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
    persist('iot_alerts', id, alert);
    return alert;
  }

  function listAlerts(limit = 50) {
    const safe = Math.max(1, Math.min(Number(limit) || 50, 200));
    return alerts.slice(0, safe);
  }

  function markAlertRead(id) {
    const a = alerts.find((x) => String(x.id) === String(id));
    if (a) { a.status = 'read'; persist('iot_alerts', a.id, a); }
    return true;
  }

  // --- Suscripciones Web Push ---
  function addPushSubscription(sub, userId = null) {
    if (!sub || !sub.endpoint || !sub.keys) return null;
    const rec = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      userId: userId ? String(userId) : null,
      createdAt: nowIso()
    };
    pushSubs.set(sub.endpoint, rec);
    persist('push_subscriptions', subDocId(sub.endpoint), rec);
    return { endpoint: sub.endpoint };
  }

  function listPushSubscriptions() {
    return [...pushSubs.values()].map((r) => ({ endpoint: r.endpoint, keys: r.keys, userId: r.userId }));
  }

  function removePushSubscription(endpoint) {
    const e = String(endpoint || '');
    pushSubs.delete(e);
    unpersist('push_subscriptions', subDocId(e));
    return true;
  }

  // --- Reglas de automatización (Fase 3) ---
  function listRules() {
    return [...rules.values()];
  }

  function getRule(id) {
    return rules.get(String(id)) || null;
  }

  function upsertRule(rule) {
    const { valid, errors } = validateRule(rule);
    if (!valid) throw new Error('Regla invalida: ' + JSON.stringify(errors));
    const id = rule.id || crypto.randomUUID();
    const existing = rules.get(id);
    const next = {
      id,
      name: rule.name,
      enabled: rule.enabled !== false,
      trigger: rule.trigger,
      actions: rule.actions,
      cooldownMs: Number.isInteger(rule.cooldownMs) ? rule.cooldownMs : (existing ? existing.cooldownMs || 0 : 0),
      createdAt: (existing && existing.createdAt) || nowIso(),
      updatedAt: nowIso()
    };
    rules.set(id, next);
    persist('iot_rules', id, next);
    return next;
  }

  function deleteRule(id) {
    const k = String(id);
    rules.delete(k);
    unpersist('iot_rules', k);
    return true;
  }

  function setRuleEnabled(id, enabled) {
    const r = rules.get(String(id));
    if (!r) return null;
    r.enabled = Boolean(enabled);
    r.updatedAt = nowIso();
    persist('iot_rules', r.id, r);
    return r;
  }

  function close() { /* nada que cerrar */ }

  // --- Seed del brazo si no existe / no tiene entidades ---
  const seededBrazo = getDevice('brazo');
  if (!seededBrazo) {
    registerDevice('brazo', { name: 'Brazo Robótico', type: 'robot', status: 'online', entities: BRAZO_ENTITIES });
  } else if (!seededBrazo.entities || seededBrazo.entities.length === 0) {
    registerDevice('brazo', { type: 'robot', entities: BRAZO_ENTITIES });
  }

  return {
    filePath: firestore ? 'firestore' : 'memoria',
    getDevice,
    listDevices,
    registerDevice,
    updateDevice,
    setStatus,
    addTelemetry,
    listTelemetry,
    addEvent,
    addCommand,
    markOfflineStaleDevices,
    addAuditLog,
    getMemoryProfile,
    upsertMemoryProfile,
    listGroups,
    upsertGroup,
    listLocations,
    upsertLocation,
    getContextCache,
    setContextCache,
    addAlert,
    listAlerts,
    markAlertRead,
    addPushSubscription,
    listPushSubscriptions,
    removePushSubscription,
    listRules,
    getRule,
    upsertRule,
    deleteRule,
    setRuleEnabled,
    close
  };
}

module.exports = {
  createIotStore,
  normalizeDeviceId,
  parseJson,
  sanitizeTelemetry
};
