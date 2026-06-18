module.exports = function(deps) {
  const { readDb, writeDb, requireAuth, requireEventAuth, addHistory, getIotStore, getIotMqttClient, emitIotEvent, validDeviceId, validateDevicePatch, eventClients, recordCommand, getCloudApis } = deps;
  const express = require('express');
  const router = express.Router();

  router.get('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    return res.status(200).json({ devices: getIotStore().listDevices() });
  });

  router.get('/events', (req, res) => {
    const db = readDb();
    const auth = requireEventAuth(req, db, 'view_dashboard');
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
  });

  router.post('/discover', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const mqttClient = getIotMqttClient();
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish('devices/broadcast/commands', JSON.stringify({ action: 'announce', at: new Date().toISOString() }));
    }
    addHistory(db, allowed.user, 'iot_discovery', 'Descubrimiento IoT solicitado');
    writeDb(db);
    return res.status(202).json({ ok: true });
  });

  router.get('/alerts/list', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    return res.status(200).json({ alerts: getIotStore().listAlerts(Number(req.query.limit) || 50) });
  });

  router.get('/:id', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const device = getIotStore().getDevice(req.params.id);
    if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    return res.status(200).json({ device });
  });

  router.patch('/:id', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    if (!validDeviceId(req.params.id)) return res.status(400).json({ error: 'deviceId invalido' });
    
    const body = req.body;
    const device = getIotStore().updateDevice(req.params.id, validateDevicePatch(body));
    if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    
    addHistory(db, allowed.user, 'iot_device', `Actualizó dispositivo ${device.deviceId}`);
    writeDb(db);
    emitIotEvent('device', device);
    return res.status(200).json({ device });
  });

  router.get('/:id/telemetry', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    return res.status(200).json({
      telemetry: getIotStore().listTelemetry(req.params.id, req.query.limit || 50)
    });
  });

  router.post('/:id/commands', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    if (!validDeviceId(req.params.id)) return res.status(400).json({ error: 'deviceId invalido' });
    
    const body = req.body;
    const command = String(body.command || '').trim();
    if (!command || command.length > 80) return res.status(400).json({ error: 'Comando invalido' });
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    
    const record = getIotStore().addCommand(req.params.id, command, payload);
    if (!record) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    
    const mqttClient = getIotMqttClient();
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(`devices/${record.deviceId}/commands`, JSON.stringify({ command, payload, at: record.createdAt }));
    }
    
    addHistory(db, allowed.user, 'iot_command', `Comando ${command} enviado a ${record.deviceId}`, { deviceId: record.deviceId });
    writeDb(db);
    emitIotEvent('command', record);
    if (typeof recordCommand === 'function') recordCommand(record.deviceId, command);
    return res.status(202).json({ command: record });
  });

  router.post('/cloud-sync', async (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });

    try {
      const devices = await getCloudApis().syncDevices(req.body);
      addHistory(db, allowed.user, 'cloud_sync', 'Sincronización de dispositivos en la nube completada');
      writeDb(db);
      return res.status(200).json({ success: true, devices });
    } catch (err) {
      console.error('[Cloud Sync Route Error]:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/entities/:entityId/control', async (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'robot_control');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    if (!validDeviceId(req.params.id)) return res.status(400).json({ error: 'deviceId invalido' });

    try {
      const device = getIotStore().getDevice(req.params.id);
      if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado' });
      const entity = (device.entities || []).find(e => e.id === req.params.entityId);
      if (!entity) return res.status(404).json({ error: 'Entidad no encontrada' });

      if (device.type === 'tuya' || device.type === 'shelly') {
        const credentials = {
          tuyaClientId: req.body.tuyaClientId,
          tuyaSecret: req.body.tuyaSecret,
          shellyAuthKey: req.body.shellyAuthKey
        };
        const result = await getCloudApis().controlDeviceEntity(device.deviceId, entity.id, req.body.value, credentials);
        addHistory(db, allowed.user, 'cloud_control', `Accionó ${entity.id} de ${device.deviceId} -> ${req.body.value}`);
        writeDb(db);
        return res.status(200).json(result);
      } else {
        // Dispositivo local (MQTT)
        const setTopic = entity.mqtt && entity.mqtt.set;
        if (setTopic) {
          const mqttClient = getIotMqttClient();
          if (mqttClient && mqttClient.connected) {
            mqttClient.publish(setTopic, String(req.body.value));
          }
          getIotStore().addTelemetry(device.deviceId, entity.mqtt.state || setTopic, req.body.value);
          emitIotEvent('telemetry', { deviceId: device.deviceId, topic: entity.mqtt.state || setTopic, payload: req.body.value, receivedAt: new Date().toISOString() });
          emitIotEvent('device', getIotStore().getDevice(device.deviceId));
          
          addHistory(db, allowed.user, 'iot_control', `Accionó local ${entity.id} de ${device.deviceId} -> ${req.body.value}`);
          writeDb(db);
          return res.status(200).json({ success: true });
        }
        return res.status(400).json({ error: 'La entidad no tiene configurado tópico de comando (set).' });
      }
    } catch (err) {
      console.error('[Cloud Control Route Error]:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_devices');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    if (!validDeviceId(req.params.id)) return res.status(400).json({ error: 'deviceId invalido' });

    const deviceId = req.params.id;
    const success = getIotStore().deleteDevice(deviceId);
    if (!success) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    addHistory(db, allowed.user, 'iot_device_delete', `Eliminó dispositivo ${deviceId}`);
    writeDb(db);
    emitIotEvent('device', { deviceId, removed: true });
    return res.status(200).json({ success: true });
  });

  return router;
};
