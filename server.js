const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const PERMISSIONS = {
  super_admin: [
    'manage_users',
    'manage_robots',
    'manage_devices',
    'manage_settings',
    'view_dashboard',
    'view_history',
    'run_automations',
    'mqtt_status',
    'mqtt_monitor',
    'mqtt_publish',
    'robot_control'
  ],
  operator: [
    'view_dashboard',
    'view_history',
    'run_automations',
    'mqtt_status',
    'mqtt_monitor',
    'mqtt_publish',
    'robot_control'
  ],
  guest: [
    'view_dashboard',
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
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new HttpError(413, 'Payload demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON inválido'));
      }
    });
  });
}

function requireAuth(req, db, permission) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = db.sessions[token];
  if (!session) return { error: 'Sesión inválida', status: 401 };
  const user = db.users.find((item) => item.id === session.userId && item.active);
  if (!user) return { error: 'Usuario inactivo o inexistente', status: 401 };
  const permissions = PERMISSIONS[user.role] || [];
  if (permission && !permissions.includes(permission)) return { error: 'Permiso denegado', status: 403 };
  return { user, token, permissions };
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

async function handleApi(req, res, url) {
  const db = readDb();
  const method = req.method;

  if (method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await parseBody(req);
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

  if (route === 'GET /api/users') {
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    return send(res, 200, { users: db.users.map(publicUser) });
  }

  if (route === 'POST /api/users') {
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return send(res, allowed.status, { error: allowed.error });
    const body = await parseBody(req);
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
    const body = await parseBody(req);
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
    const body = await parseBody(req);
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
    const body = await parseBody(req);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    send(res, status, { error: error.message || 'Error interno' });
  }
});

ensureDb();
server.listen(PORT, () => {
  console.log(`TADASHY listo en http://localhost:${PORT}`);
  console.log('Usuario inicial: admin / admin123');
  console.log('Rol inicial: Super Admin');
});
