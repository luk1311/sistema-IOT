const Ajv = require('ajv');
const crypto = require('crypto');

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

const COMMAND_ALIASES = {
  apaga: 'off',
  apagar: 'off',
  desactiva: 'off',
  desactivar: 'off',
  enciende: 'on',
  encender: 'on',
  activa: 'on',
  activar: 'on',
  prende: 'on',
  prender: 'on'
};

const TYPE_ALIASES = {
  luz: ['light', 'lamp', 'relay'],
  luces: ['light', 'lamp', 'relay'],
  lampara: ['light', 'lamp'],
  lamparas: ['light', 'lamp'],
  ventilador: ['fan'],
  ventiladores: ['fan'],
  sensor: ['sensor'],
  sensores: ['sensor']
};

const automationSchema = {
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
};

const validateAutomation = ajv.compile(automationSchema);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function makeCorrelationId() {
  return crypto.randomUUID();
}

class Repository {
  constructor(store) {
    this.store = store;
  }
}

class MemoryManager extends Repository {
  getProfile(userId, sessionId = 'default') {
    return this.store.getMemoryProfile(userId, sessionId);
  }

  rememberInteraction(user, sessionId, event) {
    const current = this.getProfile(user.id, sessionId);
    const next = {
      frequentDevices: unique([...(current.frequentDevices || []), ...(event.deviceIds || [])]).slice(-100),
      usedLocations: unique([...(current.usedLocations || []), ...(event.locations || [])]).slice(-60),
      createdAutomations: unique([...(current.createdAutomations || []), ...(event.automationIds || [])]).slice(-100),
      historySummary: [current.historySummary, event.summary].filter(Boolean).join(' | ').slice(-1200)
    };
    return this.store.upsertMemoryProfile(user.id, sessionId, next);
  }

  patchProfile(user, sessionId, patch) {
    return this.store.upsertMemoryProfile(user.id, sessionId, patch || {});
  }
}

class DeviceRegistry extends Repository {
  list() {
    return this.store.listDevices();
  }

  get(deviceId) {
    return this.store.getDevice(deviceId);
  }

  findByType(typeWord, devices = this.list()) {
    const wanted = TYPE_ALIASES[normalizeText(typeWord)] || [normalizeText(typeWord)];
    return devices.filter((device) => {
      const type = normalizeText(device.type);
      const name = normalizeText(device.name);
      const caps = (device.capabilities || []).map(normalizeText);
      return wanted.some((item) => type.includes(item) || name.includes(item) || caps.includes(item));
    });
  }

  resolveDeviceIds(deviceIds) {
    return unique(deviceIds).map((id) => this.get(id)).filter(Boolean);
  }
}

class LocationRegistry extends Repository {
  listLocations() {
    return this.store.listLocations();
  }

  listGroups() {
    return this.store.listGroups();
  }

  findGroupOrLocation(name) {
    const normalized = normalizeText(name);
    const groups = this.listGroups();
    const locations = this.listLocations();
    const matchByName = (item) => {
      const names = [item.name, ...(item.aliases || [])].map(normalizeText);
      return names.some((candidate) => candidate === normalized || normalized.includes(candidate) || candidate.includes(normalized));
    };
    return groups.find(matchByName) || locations.find(matchByName) || null;
  }
}

class ContextBuilder {
  constructor({ memoryManager, deviceRegistry, locationRegistry }) {
    this.memoryManager = memoryManager;
    this.deviceRegistry = deviceRegistry;
    this.locationRegistry = locationRegistry;
  }

  build({ user, sessionId, prompt }) {
    const memory = this.memoryManager.getProfile(user.id, sessionId);
    const devices = this.deviceRegistry.list();
    const groups = this.locationRegistry.listGroups();
    const locations = this.locationRegistry.listLocations();
    return {
      user: { id: user.id, username: user.username, role: user.role, scopes: user.scopes || [] },
      sessionId,
      prompt: String(prompt || '').slice(0, 1000),
      memory,
      devices: devices.slice(0, 200),
      groups: groups.slice(0, 100),
      locations: locations.slice(0, 100)
    };
  }

  toSystemContext(context) {
    return [
      'Contexto operacional TADASHY:',
      JSON.stringify({
        memory: context.memory,
        devices: context.devices.map((d) => ({
          deviceId: d.deviceId,
          name: d.name,
          type: d.type,
          capabilities: d.capabilities,
          metadata: d.metadata
        })),
        groups: context.groups,
        locations: context.locations
      }).slice(0, 8000)
    ].join('\n');
  }
}

class AutomationGenerator {
  constructor({ deviceRegistry, locationRegistry }) {
    this.deviceRegistry = deviceRegistry;
    this.locationRegistry = locationRegistry;
  }

  commandFromText(text) {
    const normalized = normalizeText(text);
    const verb = Object.keys(COMMAND_ALIASES).find((item) => normalized.startsWith(item) || normalized.includes(` ${item} `));
    return verb ? COMMAND_ALIASES[verb] : null;
  }

  extractTarget(text) {
    const normalized = normalizeText(text);
    const locationMatch = normalized.match(/\b(?:el|la|los|las|todo|todos|todas)\s+(.+)$/);
    return locationMatch ? locationMatch[1].trim() : normalized;
  }

  resolveCommandTargets(text) {
    const normalized = normalizeText(text);
    const command = this.commandFromText(normalized);
    if (!command) return null;

    const groupOrLocation = this.locationRegistry.findGroupOrLocation(this.extractTarget(normalized));
    let candidates = groupOrLocation
      ? this.deviceRegistry.resolveDeviceIds(groupOrLocation.deviceIds || [])
      : [];

    const typeWord = Object.keys(TYPE_ALIASES).find((word) => normalized.includes(word));
    if (typeWord) {
      const typeMatches = this.deviceRegistry.findByType(typeWord, candidates.length ? candidates : undefined);
      candidates = typeMatches;
    }

    if (!candidates.length && normalized.includes('todo')) {
      candidates = this.deviceRegistry.list();
    }

    if (!candidates.length) return null;

    const toolCalls = candidates.slice(0, 50).map((device) => ({
      tool: 'sendCommand',
      deviceId: device.deviceId,
      command
    }));

    return {
      type: 'device_commands',
      command,
      targets: candidates,
      toolCalls,
      locations: groupOrLocation ? [groupOrLocation.name] : [],
      summary: `Comando ${command} preparado para ${toolCalls.length} dispositivo(s).`
    };
  }

  generateRule(text) {
    const normalized = normalizeText(text);
    if (!/\b(crea|crear|regla|cuando)\b/.test(normalized)) return null;

    const command = this.commandFromText(normalized) || 'on';
    const actionType = Object.keys(TYPE_ALIASES).find((word) => normalized.includes(word)) || 'ventilador';
    const thresholdMatch = normalized.match(/(?:temperatura|temp)\s+(?:supere|sea mayor que|mayor a|>)\s+(\d+(?:\.\d+)?)/)
      || normalized.match(/(\d+(?:\.\d+)?)\s+grados/);
    if (!thresholdMatch) return null;

    const sensors = this.deviceRegistry.findByType('sensor')
      .filter((device) => normalizeText(device.name).includes('temp')
        || normalizeText(device.type).includes('temp')
        || (device.capabilities || []).map(normalizeText).some((cap) => cap.includes('temperature')));
    const triggerDevice = sensors[0] || this.deviceRegistry.list().find((device) => normalizeText(device.deviceId).includes('temp'));
    const actionDevice = this.deviceRegistry.findByType(actionType)[0];
    if (!triggerDevice || !actionDevice) return null;

    const automation = {
      name: `Regla IA ${new Date().toISOString().slice(0, 19)}`,
      trigger: {
        device: triggerDevice.deviceId,
        condition: `temperature > ${thresholdMatch[1]}`
      },
      actions: [{
        tool: 'sendCommand',
        deviceId: actionDevice.deviceId,
        command
      }]
    };

    if (!validateAutomation(automation)) {
      return { type: 'invalid_rule', errors: validateAutomation.errors };
    }
    return { type: 'automation_rule', automation, schema: automationSchema };
  }

  plan(text) {
    return this.generateRule(text) || this.resolveCommandTargets(text);
  }
}

class ToolExecutionLimiter {
  constructor({ maxCalls = 50 } = {}) {
    this.maxCalls = maxCalls;
  }

  assertWithinLimit(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length > this.maxCalls) {
      throw new Error(`Límite de ejecución excedido: máximo ${this.maxCalls} tool calls por solicitud.`);
    }
  }
}

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, handler) {
    const handlers = this.listeners.get(type) || new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
    return () => handlers.delete(handler);
  }

  emit(type, payload) {
    const event = { type, payload, at: new Date().toISOString() };
    for (const handler of this.listeners.get(type) || []) handler(event);
    for (const handler of this.listeners.get('*') || []) handler(event);
    return event;
  }
}

class SessionManager {
  constructor({ ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  touch(userId, sessionId = 'default', metadata = {}) {
    const key = `${userId}:${sessionId || 'default'}`;
    const now = Date.now();
    const session = {
      userId,
      sessionId: sessionId || 'default',
      metadata,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString()
    };
    this.sessions.set(key, session);
    return session;
  }

  prune() {
    const now = new Date().toISOString();
    for (const [key, session] of this.sessions.entries()) {
      if (session.expiresAt < now) this.sessions.delete(key);
    }
  }
}

module.exports = {
  AutomationGenerator,
  ContextBuilder,
  DeviceRegistry,
  EventBus,
  LocationRegistry,
  MemoryManager,
  Repository,
  SessionManager,
  ToolExecutionLimiter,
  automationSchema,
  makeCorrelationId,
  normalizeText
};
