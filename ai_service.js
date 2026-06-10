const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_SYSTEM_PROMPT = [
  'Eres TADASHY AI, un asistente tecnico para una plataforma IoT, MQTT, robotica e IA.',
  'Responde en espanol claro y breve.',
  'No ejecutes acciones sobre dispositivos, MQTT, automatizaciones o robotica.',
  'Si el usuario pide controlar hardware, explica que necesitas una tool segura habilitada por backend.',
  'Prioriza diagnostico, explicacion, arquitectura y pasos verificables.'
].join(' ');

function nowIso() {
  return new Date().toISOString();
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

function rowToMessage(row) {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    model: row.model,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    createdAt: row.created_at
  };
}

function sanitizeMessage(value) {
  return String(value || '').trim().slice(0, 4000);
}

function toPublicError(error) {
  if (error.name === 'AbortError') {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      message: 'Ollama no respondio a tiempo. Verifica que el servicio local este activo.'
    };
  }
  if (error.code === 'OLLAMA_HTTP') {
    return {
      status: error.status || 502,
      code: 'OLLAMA_HTTP',
      message: `Ollama respondio con error ${error.status || 502}.`
    };
  }
  return {
    status: 502,
    code: 'AI_UNAVAILABLE',
    message: 'No se pudo conectar con Ollama. Verifica que Ollama este ejecutandose y que Mistral este instalado.'
  };
}

async function createAiService({
  dataDir,
  filename = 'ai.sqlite',
  ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model = process.env.OLLAMA_MODEL || 'mistral',
  timeoutMs = Number(process.env.AI_TIMEOUT_MS || 30000),
  historyLimit = Number(process.env.AI_HISTORY_LIMIT || 12)
}) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();
  const filePath = path.join(dataDir, filename);
  const db = fs.existsSync(filePath)
    ? new SQL.Database(fs.readFileSync(filePath))
    : new SQL.Database();

  let saveTimer = null;
  const tools = new Map();

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
    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL,
      model TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_messages_user_time
      ON ai_messages(user_id, created_at DESC);
  `);
  persist();

  function registerTool(tool) {
    if (!tool?.name) return;
    tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      schema: tool.schema || {}
    });
  }

  registerTool({
    name: 'iot_inventory_read',
    description: 'Futura tool para consultar inventario IoT desde una ejecucion segura del backend.',
    schema: { type: 'object', properties: {} }
  });

  function addMessage(userId, role, content, metadata = {}, usedModel = model) {
    const ts = nowIso();
    exec(
      'INSERT INTO ai_messages (user_id, role, content, model, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, role, content, usedModel, JSON.stringify(metadata), ts]
    );
    return { userId, role, content, model: usedModel, metadata, createdAt: ts };
  }

  function listHistory(userId, limit = historyLimit) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || historyLimit, 50));
    return getRows(
      db,
      'SELECT * FROM ai_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      [userId, safeLimit]
    ).map(rowToMessage).reverse();
  }

  async function callOllama(messages, requestModel = model) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: requestModel,
          messages,
          stream: false,
          options: {
            temperature: 0.2
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error('Ollama HTTP error');
        error.code = 'OLLAMA_HTTP';
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      return data?.message?.content || '';
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat({ user, message, model: requestedModel }) {
    const userId = String(user.id);
    const content = sanitizeMessage(message);
    if (!content) {
      const error = new Error('Mensaje vacio');
      error.status = 400;
      throw error;
    }

    const selectedModel = sanitizeMessage(requestedModel || model).slice(0, 80) || model;
    addMessage(userId, 'user', content, { username: user.username }, selectedModel);

    const history = listHistory(userId, historyLimit)
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({ role: item.role, content: item.content }));

    const messages = [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      ...history
    ];

    try {
      const answer = sanitizeMessage(await callOllama(messages, selectedModel)) || 'No recibi una respuesta util del modelo.';
      const saved = addMessage(userId, 'assistant', answer, {
        username: user.username,
        provider: 'ollama',
        toolsAvailable: Array.from(tools.keys())
      }, selectedModel);
      return {
        reply: answer,
        model: selectedModel,
        provider: 'ollama',
        message: saved,
        history: listHistory(userId, historyLimit),
        tools: Array.from(tools.values())
      };
    } catch (error) {
      const publicError = toPublicError(error);
      addMessage(userId, 'assistant', publicError.message, {
        error: publicError.code,
        provider: 'ollama'
      }, selectedModel);
      const wrapped = new Error(publicError.message);
      wrapped.status = publicError.status;
      wrapped.code = publicError.code;
      throw wrapped;
    }
  }

  function close() {
    clearTimeout(saveTimer);
    persist();
    db.close();
  }

  return {
    filePath,
    model,
    ollamaUrl,
    timeoutMs,
    chat,
    listHistory,
    registerTool,
    close
  };
}

module.exports = {
  createAiService
};
