// Esquema y utilidades del modelo de entidades (Fase 0).
// Ver docs/entity-model.md para el diseño completo.
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, removeAdditional: false });

const entitySchema = {
  type: 'object',
  required: ['id', 'name', 'capability'],
  additionalProperties: true,
  properties: {
    id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,48}$' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    capability: { enum: ['switch', 'range', 'sensor', 'button', 'text'] },
    mqtt: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: 'string', maxLength: 200 },
        set: { type: 'string', maxLength: 200 },
        payloadKey: { type: 'string', maxLength: 80 }
      }
    },
    ui: {
      type: 'object',
      additionalProperties: false,
      properties: {
        icon: { type: 'string', maxLength: 60 },
        order: { type: 'number' },
        hidden: { type: 'boolean' }
      }
    }
  },
  allOf: [
    {
      if: { properties: { capability: { const: 'range' } } },
      then: {
        required: ['min', 'max'],
        properties: {
          min: { type: 'number' },
          max: { type: 'number' },
          step: { type: 'number', exclusiveMinimum: 0 },
          unit: { type: 'string', maxLength: 12 },
          default: { type: 'number' }
        }
      }
    },
    {
      if: { properties: { capability: { const: 'switch' } } },
      then: {
        properties: {
          onPayload: { type: 'string', maxLength: 80 },
          offPayload: { type: 'string', maxLength: 80 },
          optimistic: { type: 'boolean' }
        }
      }
    },
    {
      if: { properties: { capability: { const: 'sensor' } } },
      then: {
        properties: {
          unit: { type: 'string', maxLength: 12 },
          dataType: { enum: ['number', 'string', 'bool'] },
          precision: { type: 'integer', minimum: 0, maximum: 6 },
          alert: {
            type: 'object',
            additionalProperties: false,
            properties: {
              min: { type: 'number' },
              max: { type: 'number' },
              message: { type: 'string', maxLength: 160 }
            }
          }
        }
      }
    },
    {
      if: { properties: { capability: { const: 'button' } } },
      then: {
        properties: { pressPayload: { type: 'string', maxLength: 80 } }
      }
    }
  ]
};

const entitiesArraySchema = {
  type: 'array',
  maxItems: 64,
  items: entitySchema
};

const validateEntitiesArray = ajv.compile(entitiesArraySchema);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Valida un array de entidades contra el esquema.
 * @returns {{ valid: boolean, errors: object[]|null }}
 */
function validateEntities(entities) {
  const valid = validateEntitiesArray(entities);
  return { valid, errors: valid ? null : (validateEntitiesArray.errors || []) };
}

/**
 * Detecta IDs de entidad duplicados dentro de un dispositivo.
 * @returns {string[]} lista de ids duplicados (vacía si no hay)
 */
function findDuplicateEntityIds(entities) {
  const seen = new Set();
  const dups = new Set();
  for (const entity of entities || []) {
    const id = entity && entity.id;
    if (id == null) continue;
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

/**
 * Deriva la lista plana `capabilities` (texto) a partir de las entidades.
 * Mantiene compatible el matching por palabras del nucleo de IA
 * (ContextBuilder / AutomationGenerator en tadashy_ai_core.js).
 * @returns {string[]} tokens unicos (capacidades + palabras de nombre/id)
 */
function deriveCapabilities(entities) {
  const tokens = new Set();
  for (const entity of entities || []) {
    if (!entity) continue;
    if (entity.capability) tokens.add(normalizeText(entity.capability));
    normalizeText(entity.name).split(/\s+/).filter(Boolean).forEach((w) => tokens.add(w));
    if (entity.id) tokens.add(normalizeText(entity.id));
  }
  return [...tokens].filter(Boolean);
}

module.exports = {
  entitySchema,
  entitiesArraySchema,
  validateEntities,
  findDuplicateEntityIds,
  deriveCapabilities,
  normalizeText
};
