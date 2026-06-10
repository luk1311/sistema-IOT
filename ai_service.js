const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const Ajv = require('ajv');
const crypto = require('crypto');

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

const INJECTION_PATTERNS = [
  /ignore\s+(?:the\s+)?(above|previous|system|rules|instructions)/i,
  /you\s+are\s+now\s+an?\s+(?:admin|super\s*admin|root|developer)/i,
  /override\s+system/i,
  /ignora\s+(?:las\s+)?(?:instrucciones|reglas)\s+(?:anteriores|del\s+sistema)/i,
  /ahora\s+eres\s+(?:un\s+)?(?:administrador|desarrollador|robot)/i,
  /como\s+(?:un\s+)?(?:administrador|desarrollador|super\s*admin)/i
];

class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.errors = errors;
  }
}

class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
    this.status = 403;
  }
}

class AiServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
  }
}

const DEFAULT_SYSTEM_PROMPT = [
  'Eres TADASHY AI, un asistente técnico inteligente para una plataforma empresarial de IoT, MQTT, robótica y visión artificial.',
  'Responde siempre en español claro, profesional, breve y conciso.',
  'Cuentas con acceso a herramientas seguras de consulta (lectura) y herramientas de control/acción (escritura). Úsalas cuando el usuario lo requiera.',
  'Bajo ninguna circunstancia intentes ejecutar acciones de control físico o de modificación de hardware (como mover servos o accionar motores) directamente.',
  'Si el usuario te pide controlar hardware o ejecutar rutinas críticas, invoca la herramienta correspondiente de forma estructurada. El sistema de backend interceptará tu llamada de forma segura y le pedirá confirmación explícita al usuario antes de ejecutarla físicamente.'
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

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool.name || !tool.schema) {
      throw new Error(`Tool inválida: debe tener name y schema.`);
    }
    const validate = ajv.compile(tool.schema);
    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      schema: tool.schema,
      scope: tool.scope || null,
      critical: tool.critical === true,
      validate,
      handler: tool.handler
    });
  }

  get(name) {
    return this.tools.get(name);
  }

  list() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      schema: t.schema,
      scope: t.scope,
      critical: t.critical
    }));
  }

  validateAndExecute(name, args, userContext) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Herramienta no registrada: ${name}`);
    }
    const normalizedArgs = typeof args === 'string' ? JSON.parse(args || '{}') : (args || {});

    if (tool.scope && userContext) {
      const userPermissions = userContext.permissions || [];
      const userScopes = userContext.scopes || [];
      if (!userPermissions.includes(tool.scope) && !userScopes.includes(tool.scope) && userContext.role !== 'super_admin') {
        throw new SecurityError(`Acceso denegado: el usuario no tiene el scope '${tool.scope}' requerido para usar ${name}.`);
      }
    }

    const valid = tool.validate(normalizedArgs);
    if (!valid) {
      throw new ValidationError(`Parámetros de herramienta inválidos para ${name}`, tool.validate.errors);
    }

    if (typeof tool.handler !== 'function') {
      throw new Error(`El resolver de la herramienta ${name} no está configurado.`);
    }

    return tool.handler(userContext, normalizedArgs);
  }
}

async function createAiService({
  dataDir,
  filename = 'ai.sqlite',
  ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model = process.env.OLLAMA_MODEL || 'mistral',
  timeoutMs = Number(process.env.AI_TIMEOUT_MS || 30000),
  historyLimit = Number(process.env.AI_HISTORY_LIMIT || 12),
  memoryManager = null,
  contextBuilder = null,
  automationGenerator = null,
  toolExecutionLimiter = null
}) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();
  const filePath = path.join(dataDir, filename);
  const db = fs.existsSync(filePath)
    ? new SQL.Database(fs.readFileSync(filePath))
    : new SQL.Database();

  let saveTimer = null;
  const toolRegistry = new ToolRegistry();
  const pendingConfirmations = new Map();

  function persist() {
    fs.writeFileSync(filePath, Buffer.from(db.export()));
  }

  // Limpieza periódica de tokens pendientes de confirmación caducados (más de 10 minutos)
  setInterval(() => {
    const now = Date.now();
    for (const [token, data] of pendingConfirmations.entries()) {
      if (now - data.timestamp > 600000) {
        pendingConfirmations.delete(token);
      }
    }
  }, 60000);

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
      session_id TEXT NOT NULL DEFAULT 'default',
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL,
      model TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_messages_session_time
      ON ai_messages(user_id, session_id, created_at DESC);
  `);

  try {
    const cols = getRows(db, "PRAGMA table_info(ai_messages)");
    const hasSessionId = cols.some(col => col.name === 'session_id');
    if (!hasSessionId) {
      db.run("ALTER TABLE ai_messages ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'");
      persist();
    }
  } catch (err) {
    console.error("Error al migrar la tabla ai_messages:", err.message);
  }

  persist();

  function addMessage(userId, sessionId, role, content, metadata = {}, usedModel = model) {
    const ts = nowIso();
    exec(
      'INSERT INTO ai_messages (user_id, session_id, role, content, model, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, sessionId || 'default', role, content, usedModel, JSON.stringify(metadata), ts]
    );
    return { userId, sessionId: sessionId || 'default', role, content, model: usedModel, metadata, createdAt: ts };
  }

  function listHistory(userId, sessionId = 'default', limit = historyLimit) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || historyLimit, 50));
    const rows = getRows(
      db,
      'SELECT * FROM ai_messages WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?',
      [userId, sessionId || 'default', safeLimit]
    );
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      model: row.model,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at
    })).reverse();
  }

  function detectPromptInjection(prompt) {
    const text = String(prompt || '');
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  function functionToolCall(name, args) {
    return {
      id: crypto.randomUUID(),
      type: 'function',
      function: { name, arguments: args }
    };
  }

  function requestConfirmation({ user, userId, sessionId, toolCalls, cId, selectedModel, provider = 'ollama' }) {
    const confirmationToken = crypto.randomUUID();
    const calls = toolCalls.map((tc) => ({
      toolName: tc.function.name,
      args: tc.function.arguments || {}
    }));

    pendingConfirmations.set(confirmationToken, {
      token: confirmationToken,
      userId,
      user,
      sessionId,
      toolName: calls[0]?.toolName,
      args: calls[0]?.args || {},
      toolCalls: calls,
      correlationId: cId,
      timestamp: Date.now()
    });

    addMessage(userId, sessionId, 'assistant', 'Solicitud de confirmacion para accion critica.', {
      tool_calls: toolCalls,
      pending_confirmation_token: confirmationToken,
      username: user.username,
      correlationId: cId,
      reason: 'critical_device_action'
    }, selectedModel);

    return {
      requiresConfirmation: true,
      reason: 'critical_device_action',
      confirmationToken,
      action: calls.length === 1
        ? { tool: calls[0].toolName, arguments: calls[0].args }
        : { tool: 'batch', calls: calls.map((item) => ({ tool: item.toolName, arguments: item.args })) },
      model: selectedModel,
      provider,
      reply: `Necesito confirmacion explicita para ejecutar ${calls.length} accion(es) critica(s).`
    };
  }

  async function tryContextualPlan({ user, sessionId, content, selectedModel, cId }) {
    if (!automationGenerator) return null;
    const plan = automationGenerator.plan(content);
    if (!plan) return null;

    if (plan.type === 'device_commands') {
      const toolCalls = plan.toolCalls.map((call) => functionToolCall(call.tool, {
        deviceId: call.deviceId,
        command: call.command
      }));
      if (toolExecutionLimiter) toolExecutionLimiter.assertWithinLimit(toolCalls);
      if (memoryManager) {
        memoryManager.rememberInteraction(user, sessionId, {
          deviceIds: plan.toolCalls.map((call) => call.deviceId),
          locations: plan.locations,
          summary: plan.summary
        });
      }
      return requestConfirmation({
        user,
        userId: String(user.id),
        sessionId,
        toolCalls,
        cId,
        selectedModel,
        provider: 'tadashy-orchestrator'
      });
    }

    if (plan.type === 'automation_rule') {
      const toolCall = functionToolCall('createAutomation', plan.automation);
      if (toolExecutionLimiter) toolExecutionLimiter.assertWithinLimit([toolCall]);
      addMessage(String(user.id), sessionId, 'assistant', 'Generando automatizacion desde lenguaje natural.', {
        tool_calls: [toolCall],
        username: user.username,
        correlationId: cId
      }, selectedModel);

      let result;
      try {
        const output = await toolRegistry.validateAndExecute('createAutomation', plan.automation, user);
        result = { success: true, data: output };
        if (memoryManager) {
          memoryManager.rememberInteraction(user, sessionId, {
            deviceIds: [plan.automation.trigger.device, ...plan.automation.actions.map((item) => item.deviceId)],
            automationIds: output?.automation?.id ? [output.automation.id] : [],
            summary: `Automatizacion creada: ${plan.automation.name}`
          });
        }
      } catch (err) {
        result = { success: false, error: err.message || 'Error creando automatizacion.' };
      }

      addMessage(String(user.id), sessionId, 'tool', JSON.stringify(result), {
        tool_name: 'createAutomation',
        username: user.username,
        correlationId: cId
      }, selectedModel);
      const reply = result.success
        ? 'Listo. Cree la automatizacion y quedo registrada con auditoria.'
        : `No pude crear la automatizacion: ${result.error}`;
      const saved = addMessage(String(user.id), sessionId, 'assistant', reply, {
        username: user.username,
        provider: 'tadashy-orchestrator',
        correlationId: cId
      }, selectedModel);
      return {
        reply,
        model: selectedModel,
        provider: 'tadashy-orchestrator',
        message: saved,
        history: listHistory(user.id, sessionId, historyLimit),
        tools: toolRegistry.list(),
        toolCalls: [toolCall],
        result
      };
    }

    return null;
  }

  async function callOllamaChat({ messages, requestModel = model, stream = false, onChunk = null }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const toolsSchema = toolRegistry.list().map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema
      }
    }));

    try {
      const isGroq = Boolean(process.env.GROQ_API_KEY);
      // Map local model names to active Groq models (mixtral-8x7b-32768 is decommissioned)
      let activeModel = requestModel;
      if (isGroq && requestModel === 'mistral') {
        activeModel = 'llama3-8b-8192'; // Using Llama 3 8B which is fast and supports tool calling
      }

      const payload = {
        model: activeModel,
        messages,
        stream
      };

      if (isGroq) {
        payload.temperature = 0.2;
      } else {
        payload.options = { temperature: 0.2 };
      }

      if (toolsSchema.length > 0) {
        payload.tools = toolsSchema;
        if (isGroq) payload.tool_choice = 'auto';
      }

      const apiUrl = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : `${ollamaUrl.replace(/\/$/, '')}/api/chat`;
      const headers = { 'Content-Type': 'application/json' };
      if (isGroq) headers['Authorization'] = `Bearer ${process.env.GROQ_API_KEY}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const error = new Error(`LLM HTTP error: ${response.status} - ${errorText}`);
        error.code = 'LLM_HTTP';
        error.status = response.status;
        throw error;
      }

      if (stream && onChunk) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            if (isGroq) {
              if (line === 'data: [DONE]') continue;
              if (line.startsWith('data: ')) {
                try {
                  const chunk = JSON.parse(line.slice(6));
                  if (chunk?.choices?.[0]?.delta?.content) {
                    onChunk(chunk.choices[0].delta.content);
                  }
                } catch (err) {}
              }
            } else {
              try {
                const chunk = JSON.parse(line);
                if (chunk?.message?.content) {
                  onChunk(chunk.message.content);
                }
              } catch (err) {}
            }
          }
        }
        return '';
      } else {
        const data = await response.json();
        if (isGroq) {
          return data?.choices?.[0]?.message || { role: 'assistant', content: '' };
        } else {
          return data?.message || { role: 'assistant', content: '' };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat({ user, sessionId = 'default', message, model: requestedModel, stream = false, onChunk = null, correlationId }) {
    const userId = String(user.id);
    const content = String(message || '').trim().slice(0, 4000);
    const cId = correlationId || crypto.randomUUID();

    if (!content) {
      throw new ValidationError('El mensaje no puede estar vacío.');
    }

    if (detectPromptInjection(content)) {
      throw new SecurityError('Se detectó un intento de inyección de prompt o manipulación de instrucciones del sistema.');
    }

    const selectedModel = String(requestedModel || model).slice(0, 80) || model;
    addMessage(userId, sessionId, 'user', content, { username: user.username, correlationId: cId }, selectedModel);

    const contextualPlan = await tryContextualPlan({ user, sessionId, content, selectedModel, cId });
    if (contextualPlan) return contextualPlan;

    let loopCount = 0;
    const maxLoops = 3;

    while (loopCount < maxLoops) {
      const rawHistory = listHistory(userId, sessionId, historyLimit);

      const formattedMessages = [
        { role: 'system', content: DEFAULT_SYSTEM_PROMPT }
      ];

      if (contextBuilder) {
        const context = contextBuilder.build({ user, sessionId, prompt: content });
        formattedMessages.push({ role: 'system', content: contextBuilder.toSystemContext(context) });
      }

      rawHistory.forEach(item => {
        const msg = { role: item.role, content: item.content };
        if (item.role === 'assistant' && item.metadata?.tool_calls) {
          msg.tool_calls = item.metadata.tool_calls;
        }
        if (item.role === 'tool') {
          msg.name = item.metadata?.tool_name;
        }
        formattedMessages.push(msg);
      });

      const responseMessage = await callOllamaChat({
        messages: formattedMessages,
        requestModel: selectedModel,
        stream: false
      });

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        loopCount++;
        if (toolExecutionLimiter) toolExecutionLimiter.assertWithinLimit(responseMessage.tool_calls);

        // Buscar si alguna de las tools llamadas por el modelo es crítica/peligrosa
        const criticalCall = responseMessage.tool_calls.find(tc => {
          const registered = toolRegistry.get(tc.function.name);
          return registered && registered.critical;
        });

        if (criticalCall) {
          // Si es crítica, detenemos la ejecución y solicitamos aprobación humana
          const toolName = criticalCall.function.name;
          const args = criticalCall.function.arguments || {};
          const confirmationToken = crypto.randomUUID();

          pendingConfirmations.set(confirmationToken, {
            token: confirmationToken,
            userId,
            user,
            toolName,
            args,
            correlationId: cId,
            timestamp: Date.now()
          });

          // Guardamos el mensaje de la llamada a la herramienta crítica pendiente de confirmación
          addMessage(userId, sessionId, 'assistant', `Solicitando confirmación para ejecutar herramienta ${toolName}...`, {
            tool_calls: responseMessage.tool_calls,
            pending_confirmation_token: confirmationToken,
            username: user.username,
            correlationId: cId
          }, selectedModel);

          return {
            requiresConfirmation: true,
            confirmationToken,
            action: {
              tool: toolName,
              arguments: args
            },
            model: selectedModel,
            provider: 'ollama',
            reply: `El comando requiere tu confirmación explícita para ser enviado al hardware: ejecutar '${toolName}' con argumentos ${JSON.stringify(args)}.`
          };
        }

        // Si no es crítica, resolvemos normalmente en el backend
        addMessage(userId, sessionId, 'assistant', responseMessage.content || '', {
          tool_calls: responseMessage.tool_calls,
          username: user.username,
          correlationId: cId
        }, selectedModel);

        for (const toolCall of responseMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const args = toolCall.function.arguments || {};
          let result;

          try {
            const output = await toolRegistry.validateAndExecute(toolName, args, user);
            result = { success: true, data: output };
          } catch (err) {
            result = { success: false, error: err.message || 'Error de ejecución en la herramienta.' };
          }

          addMessage(userId, sessionId, 'tool', JSON.stringify(result), {
            tool_name: toolName,
            username: user.username,
            correlationId: cId
          }, selectedModel);
        }
      } else {
        let finalReply = responseMessage.content || '';
        if (stream && onChunk) {
          let accumulated = '';
          await callOllamaChat({
            messages: formattedMessages,
            requestModel: selectedModel,
            stream: true,
            onChunk: (chunk) => {
              accumulated += chunk;
              onChunk(chunk);
            }
          });
          finalReply = accumulated;
        }

        const saved = addMessage(userId, sessionId, 'assistant', finalReply, {
          username: user.username,
          provider: 'ollama',
          correlationId: cId
        }, selectedModel);

        return {
          reply: finalReply,
          model: selectedModel,
          provider: 'ollama',
          message: saved,
          history: listHistory(userId, sessionId, historyLimit),
          tools: toolRegistry.list()
        };
      }
    }

    const timeoutMsg = 'Se superó el límite de resolución de herramientas en bucle. Intenta ser más específico.';
    const saved = addMessage(userId, sessionId, 'assistant', timeoutMsg, { error: 'MAX_TOOL_LOOPS', correlationId: cId }, selectedModel);
    return {
      reply: timeoutMsg,
      model: selectedModel,
      provider: 'ollama',
      message: saved,
      history: listHistory(userId, sessionId, historyLimit),
      tools: toolRegistry.list()
    };
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
    toolRegistry,
    pendingConfirmations,
    addMessage,
    close
  };
}

module.exports = {
  createAiService,
  ValidationError,
  SecurityError,
  AiServiceError
};
