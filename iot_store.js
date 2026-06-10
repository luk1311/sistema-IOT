const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;
const MAX_TELEMETRY_ROWS = 5000;
const MAX_TELEMETRY_DEPTH = 4;
const MAX_TELEMETRY_KEYS = 80;

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

function rowToDevice(row) {
  if (!row) return null;
  return {
    deviceId: row.device_id,
    name: row.name,
    type: row.type,
    status: row.status,
    firmware: row.firmware,
    ip: row.ip,
    capabilities: parseJson(row.capabilities, []),
    metadata: parseJson(row.metadata, {}),
    config: parseJson(row.config, {}),
    lastTelemetry: parseJson(row.last_telemetry, null),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    updatedAt: row.updated_at
  };
}

function rowToTelemetry(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    topic: row.topic,
    payload: parseJson(row.payload, row.payload),
    receivedAt: row.received_at
  };
}

function rowToNamedEntity(row) {
  if (!row) return null;
  return {
    name: row.name,
    aliases: parseJson(row.aliases, []),
    deviceIds: parseJson(row.device_ids, []),
    location: row.location || null,
    metadata: parseJson(row.metadata, {}),
    updatedAt: row.updated_at
  };
}

function rowToMemoryProfile(row) {
  if (!row) return {
    preferences: {},
    frequentDevices: [],
    usedLocations: [],
    createdAutomations: [],
    historySummary: ''
  };
  return {
    userId: row.user_id,
    sessionId: row.session_id,
    preferences: parseJson(row.preferences, {}),
    frequentDevices: parseJson(row.frequent_devices, []),
    usedLocations: parseJson(row.used_locations, []),
    createdAutomations: parseJson(row.created_automations, []),
    historySummary: row.history_summary || '',
    updatedAt: row.updated_at
  };
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

function getRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return rows;
}

function getRow(db, sql, params = []) {
  return getRows(db, sql, params)[0] || null;
}

async function createIotStore({ dataDir, filename = 'iot.sqlite' }) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();
  const filePath = path.join(dataDir, filename);
  const db = fs.existsSync(filePath)
    ? new SQL.Database(fs.readFileSync(filePath))
    : new SQL.Database();

  let saveTimer = null;

  function persist() {
    fs.writeFileSync(filePath, Buffer.from(db.export()));
  }

  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 120);
  }

  function exec(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    schedulePersist();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'esp32',
      status TEXT NOT NULL DEFAULT 'offline',
      firmware TEXT,
      ip TEXT,
      capabilities TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      config TEXT NOT NULL DEFAULT '{}',
      last_telemetry TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL,
      FOREIGN KEY(device_id) REFERENCES devices(device_id)
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_device_time
      ON telemetry(device_id, received_at DESC);

    CREATE TABLE IF NOT EXISTS device_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      command TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      tool TEXT NOT NULL,
      arguments TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      result TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_profiles (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT 'default',
      preferences TEXT NOT NULL DEFAULT '{}',
      frequent_devices TEXT NOT NULL DEFAULT '[]',
      used_locations TEXT NOT NULL DEFAULT '[]',
      created_automations TEXT NOT NULL DEFAULT '[]',
      history_summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS device_groups (
      name TEXT PRIMARY KEY,
      aliases TEXT NOT NULL DEFAULT '[]',
      location TEXT,
      device_ids TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      name TEXT PRIMARY KEY,
      aliases TEXT NOT NULL DEFAULT '[]',
      device_ids TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_cache (
      cache_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  persist();

  function getDevice(deviceId) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    return rowToDevice(getRow(db, 'SELECT * FROM devices WHERE device_id = ?', [id]));
  }

  function listDevices() {
    return getRows(db, 'SELECT * FROM devices ORDER BY last_seen DESC').map(rowToDevice);
  }

  function registerDevice(deviceId, patch = {}) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    const current = getDevice(id);
    const ts = nowIso();
    const next = {
      name: String(patch.name || current?.name || id).slice(0, 80),
      type: String(patch.type || current?.type || 'esp32').slice(0, 40),
      status: patch.status || current?.status || 'online',
      firmware: patch.firmware || current?.firmware || null,
      ip: patch.ip || current?.ip || null,
      capabilities: JSON.stringify(patch.capabilities || current?.capabilities || []),
      metadata: JSON.stringify({ ...(current?.metadata || {}), ...(patch.metadata || {}) }),
      config: JSON.stringify(patch.config || current?.config || {}),
      lastTelemetry: JSON.stringify(patch.lastTelemetry || current?.lastTelemetry || null),
      firstSeen: current?.firstSeen || ts,
      lastSeen: patch.lastSeen || ts,
      updatedAt: ts
    };

    exec(`
      INSERT INTO devices (
        device_id, name, type, status, firmware, ip, capabilities, metadata,
        config, last_telemetry, first_seen, last_seen, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        status = excluded.status,
        firmware = excluded.firmware,
        ip = excluded.ip,
        capabilities = excluded.capabilities,
        metadata = excluded.metadata,
        config = excluded.config,
        last_telemetry = excluded.last_telemetry,
        last_seen = excluded.last_seen,
        updated_at = excluded.updated_at
    `, [
      id, next.name, next.type, next.status, next.firmware, next.ip, next.capabilities,
      next.metadata, next.config, next.lastTelemetry, next.firstSeen, next.lastSeen, next.updatedAt
    ]);

    return getDevice(id);
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

  function addTelemetry(deviceId, topic, payload) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    const ts = nowIso();
    const parsed = sanitizeTelemetry(parseJson(payload, payload));
    const jsonPayload = JSON.stringify(parsed);
    registerDevice(id, { status: 'online', lastTelemetry: parsed, lastSeen: ts });
    exec('INSERT INTO telemetry (device_id, topic, payload, received_at) VALUES (?, ?, ?, ?)', [
      id, topic, jsonPayload, ts
    ]);
    exec(`
      DELETE FROM telemetry
      WHERE id NOT IN (SELECT id FROM telemetry ORDER BY id DESC LIMIT ?)
    `, [MAX_TELEMETRY_ROWS]);
    return { deviceId: id, topic, payload: parsed, receivedAt: ts };
  }

  function listTelemetry(deviceId, limit = 50) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    return getRows(
      db,
      'SELECT * FROM telemetry WHERE device_id = ? ORDER BY received_at DESC LIMIT ?',
      [id, safeLimit]
    ).map(rowToTelemetry);
  }

  function addEvent(deviceId, type, detail, payload = null) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return null;
    const ts = nowIso();
    exec(
      'INSERT INTO device_events (device_id, type, detail, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, type, String(detail).slice(0, 240), JSON.stringify(payload), ts]
    );
    return { deviceId: id, type, detail, payload, createdAt: ts };
  }

  function addCommand(deviceId, command, payload = {}) {
    const id = normalizeDeviceId(deviceId);
    if (!id || !getDevice(id)) return null;
    const ts = nowIso();
    exec(
      'INSERT INTO device_commands (device_id, command, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, String(command).slice(0, 80), JSON.stringify(payload), 'published', ts]
    );
    return { deviceId: id, command, payload, status: 'published', createdAt: ts };
  }

  function markOfflineStaleDevices(maxAgeMs) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const stale = getRows(
      db,
      "SELECT device_id FROM devices WHERE status = 'online' AND last_seen < ?",
      [cutoff]
    );
    stale.forEach((row) => setStatus(row.device_id, 'offline', { reason: 'heartbeat_timeout' }));
    return stale.map((row) => row.device_id);
  }

  function addAuditLog(correlationId, userId, username, tool, args, status, durationMs, result = null) {
    const ts = nowIso();
    exec(`
      INSERT INTO audit_logs (correlation_id, user_id, username, tool, arguments, status, duration_ms, timestamp, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [correlationId, String(userId), username, tool, JSON.stringify(args), status, Number(durationMs), ts, result ? JSON.stringify(result) : null]);
    return { correlationId, userId, username, tool, arguments: args, status, durationMs, timestamp: ts, result };
  }

  function getMemoryProfile(userId, sessionId = 'default') {
    return rowToMemoryProfile(getRow(
      db,
      'SELECT * FROM memory_profiles WHERE user_id = ? AND session_id = ?',
      [String(userId), String(sessionId || 'default')]
    ));
  }

  function upsertMemoryProfile(userId, sessionId = 'default', patch = {}) {
    const current = getMemoryProfile(userId, sessionId);
    const ts = nowIso();
    const next = {
      preferences: { ...(current.preferences || {}), ...(patch.preferences || {}) },
      frequentDevices: patch.frequentDevices || current.frequentDevices || [],
      usedLocations: patch.usedLocations || current.usedLocations || [],
      createdAutomations: patch.createdAutomations || current.createdAutomations || [],
      historySummary: String(patch.historySummary ?? current.historySummary ?? '').slice(0, 2000)
    };
    exec(`
      INSERT INTO memory_profiles (
        user_id, session_id, preferences, frequent_devices, used_locations,
        created_automations, history_summary, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, session_id) DO UPDATE SET
        preferences = excluded.preferences,
        frequent_devices = excluded.frequent_devices,
        used_locations = excluded.used_locations,
        created_automations = excluded.created_automations,
        history_summary = excluded.history_summary,
        updated_at = excluded.updated_at
    `, [
      String(userId),
      String(sessionId || 'default'),
      JSON.stringify(next.preferences),
      JSON.stringify(next.frequentDevices),
      JSON.stringify(next.usedLocations),
      JSON.stringify(next.createdAutomations),
      next.historySummary,
      ts
    ]);
    return getMemoryProfile(userId, sessionId);
  }

  function listGroups() {
    return getRows(db, 'SELECT * FROM device_groups ORDER BY name ASC').map(rowToNamedEntity);
  }

  function upsertGroup(name, patch = {}) {
    const safeName = String(name || '').trim().toLowerCase().slice(0, 80);
    if (!safeName) return null;
    const ts = nowIso();
    exec(`
      INSERT INTO device_groups (name, aliases, location, device_ids, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        aliases = excluded.aliases,
        location = excluded.location,
        device_ids = excluded.device_ids,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `, [
      safeName,
      JSON.stringify(patch.aliases || []),
      patch.location ? String(patch.location).slice(0, 80) : null,
      JSON.stringify((patch.deviceIds || []).map(normalizeDeviceId).filter(Boolean)),
      JSON.stringify(patch.metadata || {}),
      ts
    ]);
    return rowToNamedEntity(getRow(db, 'SELECT * FROM device_groups WHERE name = ?', [safeName]));
  }

  function listLocations() {
    return getRows(db, 'SELECT * FROM locations ORDER BY name ASC').map(rowToNamedEntity);
  }

  function upsertLocation(name, patch = {}) {
    const safeName = String(name || '').trim().toLowerCase().slice(0, 80);
    if (!safeName) return null;
    const ts = nowIso();
    exec(`
      INSERT INTO locations (name, aliases, device_ids, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        aliases = excluded.aliases,
        device_ids = excluded.device_ids,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `, [
      safeName,
      JSON.stringify(patch.aliases || []),
      JSON.stringify((patch.deviceIds || []).map(normalizeDeviceId).filter(Boolean)),
      JSON.stringify(patch.metadata || {}),
      ts
    ]);
    return rowToNamedEntity(getRow(db, 'SELECT * FROM locations WHERE name = ?', [safeName]));
  }

  function setContextCache(key, value, ttlMs = 30000) {
    const safeKey = String(key || '').slice(0, 160);
    if (!safeKey) return null;
    const ts = nowIso();
    const expiresAt = new Date(Date.now() + Math.max(1000, Number(ttlMs) || 30000)).toISOString();
    exec(`
      INSERT INTO context_cache (cache_key, value, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `, [safeKey, JSON.stringify(value), expiresAt, ts]);
    return { key: safeKey, value, expiresAt, updatedAt: ts };
  }

  function getContextCache(key) {
    const row = getRow(db, 'SELECT * FROM context_cache WHERE cache_key = ?', [String(key || '').slice(0, 160)]);
    if (!row || row.expires_at < nowIso()) return null;
    return parseJson(row.value, null);
  }

  function close() {
    clearTimeout(saveTimer);
    persist();
    db.close();
  }

  return {
    filePath,
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
    close
  };
}

module.exports = {
  createIotStore,
  normalizeDeviceId,
  parseJson,
  sanitizeTelemetry
};
