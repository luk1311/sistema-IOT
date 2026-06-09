const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');
const test = require('node:test');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const DB_BACKUP = path.join(__dirname, 'data', 'db.json.bak');

// Backup database
if (fs.existsSync(DB_FILE)) {
  fs.copyFileSync(DB_FILE, DB_BACKUP);
  fs.unlinkSync(DB_FILE); // Start with a clean state
} else {
  // Ensure directory exists
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

let serverProcess = null;
let serverUrl = '';

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (serverProcess) {
    serverProcess.kill();
  }
  // Restore database
  if (fs.existsSync(DB_BACKUP)) {
    if (fs.existsSync(DB_FILE)) {
      fs.unlinkSync(DB_FILE);
    }
    fs.copyFileSync(DB_BACKUP, DB_FILE);
    fs.unlinkSync(DB_BACKUP);
  }
  console.log('Teardown complete. DB restored.');
}

// Ensure cleanup runs
process.on('exit', cleanup);
process.on('SIGINT', () => { process.exit(); });
process.on('SIGTERM', () => { process.exit(); });
process.on('uncaughtException', (err) => {
  console.error('Test error:', err);
  process.exit(1);
});

// Helper to start server
function startServer() {
  return new Promise((resolve, reject) => {
    // Port 0 selects a random available port
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: '0' }
    });

    let stdoutData = '';
    serverProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdoutData += chunk;
      console.log('[Server]:', chunk.trim());

      const match = stdoutData.match(/TADASHY listo en http:\/\/localhost:(\d+)/);
      if (match) {
        serverUrl = `http://127.0.0.1:${match[1]}`;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]:', data.toString());
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

test('TADASHY Integration Tests', async (t) => {
  await startServer();
  console.log(`Server started at ${serverUrl}`);

  let adminToken = '';
  let operatorToken = '';
  let operatorId = '';
  let adminId = '';

  await t.test('Serve Static - GET /', async () => {
    const res = await fetch(`${serverUrl}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /TADASHY/);
  });

  await t.test('Authentication - POST /api/auth/login (fail wrong password)', async () => {
    const res = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error, 'Usuario o contraseña incorrectos');
  });

  await t.test('Authentication - POST /api/auth/login (success admin)', async () => {
    const res = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.strictEqual(body.user.username, 'admin');
    assert.strictEqual(body.user.role, 'super_admin');
    adminToken = body.token;
    adminId = body.user.id;
  });

  await t.test('User Management - GET /api/users (fail without token)', async () => {
    const res = await fetch(`${serverUrl}/api/users`);
    assert.strictEqual(res.status, 401);
  });

  await t.test('User Management - POST /api/users (create operator)', async () => {
    const res = await fetch(`${serverUrl}/api/users`, {
      method: 'POST',
      body: JSON.stringify({
        username: 'operator1',
        password: 'password123',
        role: 'operator'
      }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.user.username, 'operator1');
    assert.strictEqual(body.user.role, 'operator');
    assert.strictEqual(body.user.active, true);
    operatorId = body.user.id;
  });

  await t.test('User Management - GET /api/users (success list)', async () => {
    const res = await fetch(`${serverUrl}/api/users`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.users));
    assert.strictEqual(body.users.length, 2);
  });

  await t.test('Authentication - Login as Operator', async () => {
    const res = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'operator1', password: 'password123' }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    operatorToken = body.token;
  });

  await t.test('Permissions - Operator cannot manage users', async () => {
    const res = await fetch(`${serverUrl}/api/users`, {
      headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error, 'Permiso denegado');
  });

  await t.test('Robustness - PATCH /api/users/:id (prevent self-deactivation)', async () => {
    const res = await fetch(`${serverUrl}/api/users/${adminId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'No puedes desactivar tu propio usuario');
  });

  await t.test('Robustness - PATCH /api/users/:id (prevent deactivating last super_admin)', async () => {
    // Attempt to deactivate admin from operator token - should be 403 first
    const failRes = await fetch(`${serverUrl}/api/users/${adminId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${operatorToken}`
      }
    });
    assert.strictEqual(failRes.status, 403);

    // Let's create another admin
    const createRes = await fetch(`${serverUrl}/api/users`, {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin2',
        password: 'adminpassword',
        role: 'super_admin'
      }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(createRes.status, 201);
    const admin2 = await createRes.json();
    const admin2Id = admin2.user.id;

    // Now try to deactivate admin2 (valid request since logued user is admin, not admin2)
    const deactRes = await fetch(`${serverUrl}/api/users/${admin2Id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(deactRes.status, 200);

    // Now try to change the role of admin1 (the last active admin) to operator
    const demoteRes = await fetch(`${serverUrl}/api/users/${adminId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'operator' }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(demoteRes.status, 400);
    const demoteBody = await demoteRes.json();
    assert.strictEqual(demoteBody.error, 'No puedes cambiar el rol al único Super Admin activo');
  });

  await t.test('Automations - POST /api/automations & GET', async () => {
    const res = await fetch(`${serverUrl}/api/automations`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Secuencia',
        steps: [{ servo: 1, angle: 10, delay: 100 }]
      }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.automation.name, 'Test Secuencia');

    const getRes = await fetch(`${serverUrl}/api/automations`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(getRes.status, 200);
    const getBody = await getRes.json();
    assert.ok(getBody.automations.length >= 2);
  });

  await t.test('Logout - POST /api/auth/logout', async () => {
    const res = await fetch(`${serverUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
    assert.strictEqual(res.status, 200);

    // Check operator token is now invalid
    const checkRes = await fetch(`${serverUrl}/api/users`, {
      headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
    assert.strictEqual(checkRes.status, 401);
  });

  // End of test process exit triggers cleanup
  cleanup();
});
