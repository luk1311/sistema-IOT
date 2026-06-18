# Diseño del modelo de entidades (Fase 0)

> Base de la "plataforma genérica IoT". Convierte cada dispositivo en un conjunto de
> **entidades** con una **capacidad** común, para que dashboard, reglas e IA dejen de conocer
> "servos" y conozcan *capacidades*.

## Decisiones de diseño clave

1. **Cero migración SQL.** Las entidades se guardan en la columna `config` ya existente
   (`config.entities`). No se crean tablas ni columnas nuevas en `iot_store.js`.
2. **Compatibilidad con la IA.** El campo `capabilities` (`string[]`) existente pasa a ser
   **derivado** de `entities` (tipos + nombres normalizados). Así `ContextBuilder` y
   `AutomationGenerator` (`tadashy_ai_core.js`) siguen funcionando sin cambios.
3. **Compatibilidad con el brazo.** Cada entidad declara *sus propios* tópicos MQTT, así que el
   brazo mapea a los tópicos legacy (`brazo/servo/N`) y nada se rompe durante la transición.
4. **Validación con `ajv`** (ya es dependencia del proyecto).

## Estructura

### Dispositivo
Extiende la forma actual (`rowToDevice` en `iot_store.js`); solo añade `entities` dentro de `config`.

```jsonc
{
  "deviceId": "brazo",          // /^[a-zA-Z0-9_-]{3,64}$/  (ya validado)
  "name": "Brazo Robótico",
  "type": "robot",              // categoría/ícono libre
  "status": "online",           // online | offline
  "entities": [ /* Entity[] */ ] // guardado en config.entities
}
```

### Entidad (instancia de capacidad)
Campos comunes:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | único en el dispositivo, `/^[a-zA-Z0-9_-]{1,48}$/` |
| `name` | string | nombre visible |
| `capability` | enum | `switch` \| `range` \| `sensor` \| `button` \| `text` |
| `mqtt` | object | mapeo a tópicos (abajo) |
| `ui` | object? | `icon`, `order`, `hidden` |

Bloque `mqtt`:

| Campo | Uso |
|---|---|
| `state` | tópico del valor actual (lectura) — opcional |
| `set` | tópico para enviar comando (escritura) — opcional |
| `payloadKey` | si el payload es JSON, qué clave leer (si se omite, se usa el payload entero) |

Campos por capacidad:

- **switch**: `onPayload` (def. `"on"`), `offPayload` (def. `"off"`), `optimistic` (bool)
- **range**: `min`, `max`, `step` (def. 1), `unit`, `default`
- **sensor**: `unit`, `dataType` (`number`\|`string`\|`bool`), `precision` (decimales)
- **button**: `pressPayload` (def. `"press"`)
- **text**: sin campos extra (estado libre)

## Convención de tópicos MQTT (para hardware nuevo)

```
tadashy/{deviceId}/{entityId}/state    ← el dispositivo publica su estado
tadashy/{deviceId}/{entityId}/set      ← TADASHY publica el comando
```

El hardware existente NO necesita migrar: cada entidad puede apuntar a cualquier tópico vía
`mqtt.state`/`mqtt.set`.

## Ejemplos

### Brazo robótico (4 entidades `range`, tópicos legacy)
```json
{
  "deviceId": "brazo",
  "name": "Brazo Robótico",
  "type": "robot",
  "entities": [
    { "id": "base",     "name": "Base",    "capability": "range",
      "min": 0, "max": 180, "step": 1, "unit": "°", "default": 90,
      "mqtt": { "set": "brazo/servo/1", "state": "brazo/servo/feedback/1" },
      "ui": { "icon": "ti-rotate-clockwise", "order": 1 } },
    { "id": "shoulder", "name": "Hombro",  "capability": "range",
      "min": 0, "max": 180, "step": 1, "unit": "°", "default": 90,
      "mqtt": { "set": "brazo/servo/2", "state": "brazo/servo/feedback/2" },
      "ui": { "icon": "ti-arrow-up", "order": 2 } },
    { "id": "elbow",    "name": "Codo",    "capability": "range",
      "min": 0, "max": 180, "step": 1, "unit": "°", "default": 90,
      "mqtt": { "set": "brazo/servo/3", "state": "brazo/servo/feedback/3" },
      "ui": { "icon": "ti-fold-up", "order": 3 } },
    { "id": "wrist",    "name": "Muñeca",  "capability": "range",
      "min": 0, "max": 180, "step": 1, "unit": "°", "default": 90,
      "mqtt": { "set": "brazo/servo/4", "state": "brazo/servo/feedback/4" },
      "ui": { "icon": "ti-hand-grab", "order": 4 } }
  ]
}
```

### Luz (entidad `switch`, convención nueva)
```json
{
  "deviceId": "luz-sala", "name": "Luz Sala", "type": "light",
  "entities": [
    { "id": "power", "name": "Encendido", "capability": "switch",
      "onPayload": "ON", "offPayload": "OFF",
      "mqtt": { "set": "tadashy/luz-sala/power/set", "state": "tadashy/luz-sala/power/state" },
      "ui": { "icon": "ti-bulb" } }
  ]
}
```

### Sensor ambiental (dos entidades `sensor` desde un solo payload JSON)
```json
{
  "deviceId": "sensor-cocina", "name": "Sensor Cocina", "type": "sensor",
  "entities": [
    { "id": "temp", "name": "Temperatura", "capability": "sensor",
      "unit": "°C", "dataType": "number", "precision": 1,
      "mqtt": { "state": "tadashy/sensor-cocina/env/state", "payloadKey": "temperature" } },
    { "id": "hum", "name": "Humedad", "capability": "sensor",
      "unit": "%", "dataType": "number", "precision": 0,
      "mqtt": { "state": "tadashy/sensor-cocina/env/state", "payloadKey": "humidity" } }
  ]
}
```

## Esquema de validación (`ajv`)

Propuesto para `src/schemas/device-schema.js`. Usa `if/then` por `capability`.

```js
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
    { if: { properties: { capability: { const: 'range' } } },
      then: { required: ['min', 'max'],
        properties: {
          min: { type: 'number' }, max: { type: 'number' },
          step: { type: 'number', exclusiveMinimum: 0 },
          unit: { type: 'string', maxLength: 12 },
          default: { type: 'number' }
        } } },
    { if: { properties: { capability: { const: 'switch' } } },
      then: { properties: {
          onPayload: { type: 'string', maxLength: 80 },
          offPayload: { type: 'string', maxLength: 80 },
          optimistic: { type: 'boolean' }
        } } },
    { if: { properties: { capability: { const: 'sensor' } } },
      then: { properties: {
          unit: { type: 'string', maxLength: 12 },
          dataType: { enum: ['number', 'string', 'bool'] },
          precision: { type: 'integer', minimum: 0, maximum: 6 }
        } } },
    { if: { properties: { capability: { const: 'button' } } },
      then: { properties: { pressPayload: { type: 'string', maxLength: 80 } } } }
  ]
};

const deviceConfigSchema = {
  type: 'object',
  properties: {
    entities: { type: 'array', maxItems: 64, items: entitySchema }
  }
};
```

## Cómo se conecta (siguientes pasos de implementación, fuera de este diseño)

1. `src/schemas/device-schema.js` — el esquema ajv anterior + helper `validateEntities()`.
2. `iot_store.js` — al `registerDevice`/`updateDevice`: validar `config.entities` y derivar
   `capabilities = entities.map(capability + name)` automáticamente.
3. Seed del brazo: registrar las 4 entidades `range` (reemplaza el caso especial hardcodeado).
4. `mqtt.js` (frontend) — resolver mensajes entrantes contra `entity.mqtt.state`/`payloadKey`.
5. `devices.js` + dashboard — renderizar widgets a partir de `capability` (switch→toggle,
   range→slider, sensor→valor/gráfica), sustituyendo las tarjetas de servo fijas.

Estos pasos se harán en modo plan, fase por fase, con verificación.
```
