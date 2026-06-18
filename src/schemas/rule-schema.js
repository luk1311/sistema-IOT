// Esquema de regla del motor de automatización (Fase 3).
// Regla = trigger (comparación sobre una entidad sensor) -> acciones.
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, coerceTypes: true, allowUnionTypes: true });

const ruleSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['name', 'trigger', 'actions'],
  properties: {
    id: { type: 'string', maxLength: 80 },
    name: { type: 'string', minLength: 3, maxLength: 120 },
    enabled: { type: 'boolean' },
    cooldownMs: { type: 'integer', minimum: 0, maximum: 86400000 },
    trigger: {
      type: 'object',
      additionalProperties: false,
      required: ['deviceId', 'entityId', 'op', 'value'],
      properties: {
        deviceId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,64}$' },
        entityId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,48}$' },
        op: { enum: ['>', '<', '>=', '<=', '==', '!='] },
        value: { type: ['number', 'string'] }
      }
    },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'deviceId'],
        properties: {
          type: { enum: ['entity_set', 'command'] },
          deviceId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{3,64}$' },
          entityId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,48}$' },
          value: { type: ['number', 'string'] },
          command: { type: 'string', maxLength: 120 }
        }
      }
    }
  }
};

const validate = ajv.compile(ruleSchema);

function validateRule(rule) {
  const valid = validate(rule);
  return { valid, errors: valid ? null : (validate.errors || []) };
}

module.exports = { ruleSchema, validateRule };
