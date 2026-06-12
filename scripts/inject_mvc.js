const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '../server.js');
let code = fs.readFileSync(serverFile, 'utf8');

const handleApiRegex = /async function handleApi\(req, res, url\) \{[\s\S]*?\n\}\n/m;
code = code.replace(handleApiRegex, '\n/* handleApi removed in favor of MVC routes */\n');

const legacyRouterRegex = /\/\/ Montar manejador heredado para no romper todo de golpe[\s\S]*?\}\);/m;

const newRouterSetup = `// --- MVC Routes Setup ---
const deps = { 
  readDb, writeDb, verifyPassword, hashPassword, publicUser, requireAuth, requireEventAuth, addHistory, checkRateLimit, sessionManager, 
  crypto, firestore, validDeviceId, validateDevicePatch, PERMISSIONS, SCOPES, runAutomationInBackend, executeBackendToolCall, eventClients,
  getIotStore: () => iotStore,
  getIotMqttClient: () => iotMqttClient,
  getAiService: () => aiService
};

const authRoutes = require('./src/routes/auth.routes')(deps);
const usersRoutes = require('./src/routes/users.routes')(deps);
const historyRoutes = require('./src/routes/history.routes')(deps);
const automationsRoutes = require('./src/routes/automations.routes')(deps);
const devicesRoutes = require('./src/routes/devices.routes')(deps);
const aiRoutes = require('./src/routes/ai.routes')(deps);

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/voice', aiRoutes); // /api/voice/config is inside ai.routes, we will map it below

app.get('/api/permissions', (req, res) => res.status(200).json({ permissions: PERMISSIONS }));
app.get('/api/mqtt/config', (req, res) => {
  const db = readDb();
  const allowed = requireAuth(req, db, 'mqtt_status');
  if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
  let host = '';
  if (MQTT_URL) {
    try { host = new URL(MQTT_URL).hostname; } catch(e) {}
  }
  return res.status(200).json({ host, port: 8884, username: MQTT_USERNAME, password: MQTT_PASSWORD });
});
app.post('/api/mqtt/publish', (req, res) => {
  const db = readDb();
  const allowed = requireAuth(req, db, 'mqtt_publish');
  if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
  const body = req.body;
  if (!body.topic || typeof body.payload === 'undefined') return res.status(400).json({ error: 'Falta topic o payload' });
  if (iotMqttClient?.connected) {
    iotMqttClient.publish(body.topic, String(body.payload));
    addHistory(db, allowed.user, 'mqtt_publish', \`Publicado en \${body.topic}\`);
    writeDb(db);
    return res.status(200).json({ success: true });
  }
  return res.status(503).json({ error: 'Broker desconectado' });
});

app.get('/api/iot/groups', (req, res) => {
  const db = readDb();
  const allowed = requireAuth(req, db, 'view_dashboard');
  if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
  return res.status(200).json({ groups: iotStore.listGroups(), locations: iotStore.listLocations() });
});

app.get('/api/voice/config', (req, res) => {
  const db = readDb();
  const allowed = requireAuth(req, db, 'voice:use');
  if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
  const sessionId = req.query.sessionId || 'default';
  const memory = iotStore.getMemoryProfile(allowed.user.id, sessionId);
  return res.status(200).json({
    wakeWord: 'hey tadashy',
    stt: 'web_speech_api',
    tts: 'speech_synthesis',
    vad: 'browser_energy_detection',
    handsFree: memory.preferences?.handsFree === true,
    voice: memory.preferences?.voice || null
  });
});

app.use('/api/*', (req, res) => res.status(404).json({ error: 'Ruta API no encontrada' }));
`;

code = code.replace(legacyRouterRegex, newRouterSetup);
fs.writeFileSync(serverFile, code);
console.log('Refactorización MVC inyectada correctamente (con getters dinámicos).');
