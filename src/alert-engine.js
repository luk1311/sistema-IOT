// Motor de alertas proactivas (Fase 2).
// Detecta umbrales de sensor, dispositivos desconectados y fallos de comando,
// y los persiste + emite (SSE) + envía por Web Push. Vive en el backend para que
// el push funcione con la app cerrada (requiere el bridge MQTT del servidor).
const COOLDOWN_MS = 5 * 60 * 1000; // anti-spam por (device, entity, type)

function readEntityValue(entity, payload) {
  let value = payload;
  if (entity.mqtt && entity.mqtt.payloadKey) {
    let parsed = payload;
    if (typeof payload === 'string') {
      try { parsed = JSON.parse(payload); } catch { parsed = null; }
    }
    value = parsed && typeof parsed === 'object' ? parsed[entity.mqtt.payloadKey] : undefined;
  }
  return value;
}

function createAlertEngine({ iotStore, emit, pushSender } = {}) {
  const cooldowns = new Map();        // key -> lastFiredTs
  const thresholdState = new Map();   // `${deviceId}:${entityId}` -> 'in' | 'out'

  function fire(alert) {
    const key = `${alert.deviceId}:${alert.entityId || '-'}:${alert.type}`;
    const now = Date.now();
    if (!alert.bypassCooldown && now - (cooldowns.get(key) || 0) < COOLDOWN_MS) return null;
    cooldowns.set(key, now);

    let stored;
    try {
      stored = iotStore.addAlert({
        deviceId: alert.deviceId,
        entityId: alert.entityId || null,
        type: alert.type,
        severity: alert.severity || 'warning',
        message: alert.message
      });
    } catch (e) {
      stored = { ...alert, createdAt: new Date().toISOString() };
    }
    try { if (emit) emit('alert', stored); } catch (e) { /* noop */ }
    try { if (pushSender) pushSender(stored); } catch (e) { /* noop */ }
    return stored;
  }

  // Evalúa los umbrales de las entidades sensor de un dispositivo ante telemetría nueva.
  function checkTelemetry(device, topic, payload) {
    if (!device || !Array.isArray(device.entities)) return;
    for (const entity of device.entities) {
      if (entity.capability !== 'sensor' || !entity.alert) continue;
      // No se filtra por tópico: la telemetría del backend llega en el tópico agregado
      // del dispositivo (devices/{id}/telemetry) y readEntityValue extrae la clave de
      // la entidad. Si la clave no está en el payload, el valor es undefined y se omite.
      const val = Number(readEntityValue(entity, payload));
      if (!Number.isFinite(val)) continue;

      const { min, max, message } = entity.alert;
      const out = (min != null && val < min) || (max != null && val > max);
      const stateKey = `${device.deviceId}:${entity.id}`;
      const prev = thresholdState.get(stateKey) || 'in';

      if (out && prev === 'in') {
        thresholdState.set(stateKey, 'out');
        const unit = entity.unit || '';
        // La máquina de estados (dentro→fuera) ya evita el spam, así que el umbral
        // omite el cooldown temporal (de lo contrario no volvería a avisar tras re-armarse).
        fire({
          deviceId: device.deviceId, entityId: entity.id, type: 'sensor_threshold', severity: 'warning',
          message: message || `${entity.name}: ${val}${unit} fuera de rango`, bypassCooldown: true
        });
      } else if (!out && prev === 'out') {
        thresholdState.set(stateKey, 'in');
        const unit = entity.unit || '';
        fire({
          deviceId: device.deviceId, entityId: entity.id, type: 'sensor_resolved', severity: 'info',
          message: `${entity.name} volvió a rango normal (${val}${unit})`, bypassCooldown: true
        });
      }
    }
  }

  // Recibe ids de dispositivos que pasaron a offline (barrido de heartbeat o LWT).
  function checkOffline(deviceIds) {
    for (const id of deviceIds || []) {
      fire({ deviceId: id, type: 'device_offline', severity: 'warning', message: `Dispositivo ${id} desconectado` });
    }
  }

  // Heurística de fallo de comando: comando enviado a un dispositivo offline.
  function recordCommand(deviceId, command) {
    let device = null;
    try { device = iotStore.getDevice(deviceId); } catch (e) { /* noop */ }
    if (device && device.status === 'offline') {
      fire({
        deviceId, type: 'command_failed', severity: 'warning',
        message: `Comando "${command}" enviado a ${deviceId}, pero el dispositivo está desconectado`
      });
    }
  }

  return { checkTelemetry, checkOffline, recordCommand, fire };
}

module.exports = { createAlertEngine, readEntityValue };
