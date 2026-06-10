const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;
const MAX_TELEMETRY_ROWS = 5000;

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
    const parsed = parseJson(payload, payload);
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
    close
  };
}

module.exports = {
  createIotStore,
  normalizeDeviceId,
  parseJson
};
