const crypto = require('crypto');
const https = require('https');

module.exports = function({ iotStore, emitIotEvent, getIotMqttClient }) {
  
  // Realiza peticiones HTTPS seguras nativas (evitando dependencias externas como axios/node-fetch)
  function makeHttpsRequest(urlStr, options, postData = '') {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const reqOpts = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const req = https.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          } else {
            reject(new Error(`Petición fallida. Status: ${res.statusCode}. Body: ${data}`));
          }
        });
      });

      req.on('error', (err) => { reject(err); });
      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  // Genera firmas sha256 para Tuya Open API
  function computeTuyaSignature(clientId, secret, accessToken, t, stringToSign) {
    const hash = crypto.createHash('sha256').update('').digest('hex'); // body hash vacío por defecto
    const signStr = clientId + (accessToken || '') + t + stringToSign;
    return crypto.createHmac('sha256', secret).update(signStr).digest('hex').toUpperCase();
  }

  // Sincroniza dispositivos en la nube
  async function syncDevices(credentials = {}) {
    const { tuyaClientId, tuyaSecret, shellyAuthKey } = credentials;

    // Si no hay credenciales, no cargamos nada (se eliminó el mock)
    if (!tuyaClientId && !shellyAuthKey) {
      console.log('[Cloud API] Sincronización omitida: No se proporcionaron credenciales en la petición');
      return [];
    }

    const synced = [];

    // Lógica real para Tuya si vienen credenciales
    if (tuyaClientId && tuyaSecret) {
      try {
        console.log('[Cloud API] Sincronizando desde la API de Tuya...');
        const t = Date.now();
        // 1. Obtener Token de Acceso
        const sign = computeTuyaSignature(tuyaClientId, tuyaSecret, '', t, 'GET\n/v1.0/token?grant_type=1');
        const tokenRes = await makeHttpsRequest('https://openapi.tuyaus.com/v1.0/token?grant_type=1', {
          headers: {
            'client_id': tuyaClientId,
            'sign': sign,
            't': t.toString(),
            'sign_method': 'HMAC-SHA256'
          }
        });

        if (tokenRes.success && tokenRes.result) {
          const accessToken = tokenRes.result.access_token;
          // 2. Obtener lista de dispositivos (usando el token)
          const tList = Date.now();
          const signList = computeTuyaSignature(tuyaClientId, tuyaSecret, accessToken, tList, `GET\n/v1.0/devices`);
          const devListRes = await makeHttpsRequest('https://openapi.tuyaus.com/v1.0/devices', {
            headers: {
              'client_id': tuyaClientId,
              'access_token': accessToken,
              'sign': signList,
              't': tList.toString(),
              'sign_method': 'HMAC-SHA256'
            }
          });

          if (devListRes.success && Array.isArray(devListRes.result)) {
            for (const tDev of devListRes.result) {
              const deviceId = `tuya_${tDev.id}`;
              const entities = [
                {
                  id: 'switch',
                  name: tDev.name || 'Interruptor Tuya',
                  capability: 'switch',
                  mqtt: {
                    state: `tadashy/${deviceId}/switch/state`,
                    set: `tuya/${deviceId}/switch/set`
                  },
                  ui: { icon: 'ti-toggle-right' },
                  onPayload: 'ON',
                  offPayload: 'OFF'
                }
              ];

              const device = iotStore.registerDevice(deviceId, {
                name: tDev.name || deviceId,
                type: 'tuya',
                status: tDev.online ? 'online' : 'offline',
                entities
              });
              synced.push(device);
              if (emitIotEvent) emitIotEvent('device', device);
            }
          }
        }
      } catch (err) {
        console.error('[Cloud API] Error al sincronizar Tuya:', err.message);
      }
    }

    // Lógica real para Shelly Cloud
    if (shellyAuthKey) {
      try {
        console.log('[Cloud API] Sincronizando desde la API de Shelly Cloud...');
        // Consulta dispositivos por API Shelly Cloud (Shelly list de control remoto)
        const listUrl = `https://shelly-37-eu.shelly.cloud/interface/device/list?auth_key=${shellyAuthKey}`;
        const res = await makeHttpsRequest(listUrl, { method: 'GET' });
        if (res.isok && res.data && res.data.devices) {
          for (const [id, sDev] of Object.entries(res.data.devices)) {
            const deviceId = `shelly_${id}`;
            const isLight = sDev.type === 'SHDM-1' || sDev.type === 'SHBD-1';
            const entities = [
              {
                id: 'switch',
                name: 'Encendido',
                capability: 'switch',
                mqtt: { state: `tadashy/${deviceId}/switch/state`, set: `shelly/${deviceId}/switch/set` },
                ui: { icon: isLight ? 'ti-bulb' : 'ti-toggle-right' },
                onPayload: 'ON',
                offPayload: 'OFF'
              }
            ];
            if (isLight) {
              entities.push({
                id: 'brightness',
                name: 'Brillo',
                capability: 'range',
                min: 0, max: 100, step: 1, unit: '%',
                mqtt: { state: `tadashy/${deviceId}/brightness/state`, set: `shelly/${deviceId}/brightness/set` },
                ui: { icon: 'ti-brightness-up' }
              });
            }

            const device = iotStore.registerDevice(deviceId, {
              name: sDev.name || deviceId,
              type: 'shelly',
              status: sDev.online ? 'online' : 'offline',
              entities
            });
            synced.push(device);
            if (emitIotEvent) emitIotEvent('device', device);
          }
        }
      } catch (err) {
        console.error('[Cloud API] Error al sincronizar Shelly:', err.message);
      }
    }

    return synced;
  }

  // Controla un dispositivo nube llamando a su API
  async function controlDeviceEntity(deviceId, entityId, value, credentials = {}) {
    const device = iotStore.getDevice(deviceId);
    if (!device) throw new Error('Dispositivo no encontrado en el inventario.');

    const entity = (device.entities || []).find(e => e.id === entityId);
    if (!entity) throw new Error('Entidad no encontrada en el dispositivo.');

    console.log(`[Cloud API] Controlando ${deviceId}/${entityId} -> ${value} (API REAL)`);

    // --- Control Tuya Real ---
    if (device.type === 'tuya') {
      const { tuyaClientId, tuyaSecret } = credentials;
      if (!tuyaClientId || !tuyaSecret) throw new Error('Faltan credenciales de Tuya para control de dispositivo real.');
      const tDeviceKey = deviceId.replace('tuya_', '');

      // Generar payload de comando Tuya
      let code = 'switch_1';
      let valParsed = value === 'ON' || value === '1' || value === true;
      if (entityId === 'brightness') {
        code = 'bright_value';
        valParsed = Number(value);
      }
      const postData = JSON.stringify({
        commands: [{ code, value: valParsed }]
      });

      const t = Date.now();
      // 1. Obtener Token de Acceso
      const sign = computeTuyaSignature(tuyaClientId, tuyaSecret, '', t, 'GET\n/v1.0/token?grant_type=1');
      const tokenRes = await makeHttpsRequest('https://openapi.tuyaus.com/v1.0/token?grant_type=1', {
        headers: { 'client_id': tuyaClientId, 'sign': sign, 't': t.toString(), 'sign_method': 'HMAC-SHA256' }
      });

      if (tokenRes.success && tokenRes.result) {
        const accessToken = tokenRes.result.access_token;
        const tControl = Date.now();
        // 2. Enviar Comando a Tuya
        const signControl = computeTuyaSignature(tuyaClientId, tuyaSecret, accessToken, tControl, `POST\n/v1.0/devices/${tDeviceKey}/commands`);
        const controlRes = await makeHttpsRequest(`https://openapi.tuyaus.com/v1.0/devices/${tDeviceKey}/commands`, {
          method: 'POST',
          headers: {
            'client_id': tuyaClientId,
            'access_token': accessToken,
            'sign': signControl,
            't': tControl.toString(),
            'sign_method': 'HMAC-SHA256',
            'Content-Type': 'application/json'
          }
        }, postData);

        if (controlRes.success) {
          // Registrar telemetría si la API confirmó
          const topic = entity.mqtt && entity.mqtt.state;
          if (topic) {
            iotStore.addTelemetry(deviceId, topic, value);
            if (emitIotEvent) {
              emitIotEvent('telemetry', { deviceId, topic, payload: value, receivedAt: new Date().toISOString() });
              emitIotEvent('device', iotStore.getDevice(deviceId));
            }
          }
          return { success: true };
        }
      }
      throw new Error('La API de Tuya rechazó el comando.');
    }

    // --- Control Shelly Real ---
    if (device.type === 'shelly') {
      const { shellyAuthKey } = credentials;
      if (!shellyAuthKey) throw new Error('Falta credencial shellyAuthKey para control real.');
      const sDeviceKey = deviceId.replace('shelly_', '');

      let actionParam = '';
      if (entityId === 'switch') {
        actionParam = `turn=${value.toUpperCase() === 'ON' ? 'on' : 'off'}`;
      } else if (entityId === 'brightness') {
        actionParam = `brightness=${value}`;
      }

      const controlUrl = `https://shelly-37-eu.shelly.cloud/device/control?auth_key=${shellyAuthKey}&id=${sDeviceKey}&${actionParam}`;
      const res = await makeHttpsRequest(controlUrl, { method: 'POST' });
      if (res.isok) {
        const topic = entity.mqtt && entity.mqtt.state;
        if (topic) {
          iotStore.addTelemetry(deviceId, topic, value);
          if (emitIotEvent) {
            emitIotEvent('telemetry', { deviceId, topic, payload: value, receivedAt: new Date().toISOString() });
            emitIotEvent('device', iotStore.getDevice(deviceId));
          }
        }
        return { success: true };
      }
      throw new Error('Shelly Cloud rechazó la orden.');
    }

    throw new Error(`Tipo de nube no soportado: ${device.type}`);
  }

  return { syncDevices, controlDeviceEntity };
};
