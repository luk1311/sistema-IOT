import { API, $, escapeHtml, state } from './state.js';
import { addLog } from './logger.js';
import { api } from './api.js';
import { hasPermission } from './auth.js';
import { deviceEntitiesHtml, reindexEntities, renderBrazoPanel, hydrateEntityCharts } from './entities.js';
import { showAlert, subscribeToPush } from './notifications.js';

export async function loadDevices() {
  if (!hasPermission('view_dashboard')) return;
  try {
    const data = await api('/devices');
    state.devices = data.devices || [];
    renderDevices();
  } catch (error) {
    addLog(`Inventario IoT no disponible: ${error.message}`, 'err');
  }
}

let areaFilter = '';

function renderAreaFilter() {
  const bar = $('device-filter-bar');
  if (!bar) return;
  const areas = [...new Set((state.devices || []).map((d) => d.area).filter(Boolean))].sort();
  bar.innerHTML = `<select id="device-area-select" class="input-futuristic" style="margin:0; padding:6px 10px;">
    <option value="">Todas las áreas</option>
    ${areas.map((a) => `<option value="${escapeHtml(a)}" ${a === areaFilter ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
  </select>`;
  $('device-area-select').addEventListener('change', (e) => { areaFilter = e.target.value; renderDevices(); });
}

export async function editArea(deviceId) {
  const device = (state.devices || []).find((d) => d.deviceId === deviceId);
  const area = prompt('Área / zona del dispositivo:', device?.area || '');
  if (area === null) return;
  try {
    await api(`/devices/${deviceId}`, { method: 'PATCH', body: JSON.stringify({ area: area.trim() }) });
    await loadDevices();
  } catch (e) {
    addLog('No se pudo asignar el área: ' + e.message, 'err');
  }
}

export function renderDevices() {
  const grid = $('device-grid');
  if (!grid) return;
  const online = state.devices.filter((device) => device.status === 'online').length;
  if ($('device-total')) $('device-total').textContent = state.devices.length;
  if ($('device-online-total')) $('device-online-total').textContent = online;

  renderAreaFilter();

  if (!state.devices.length) {
    grid.innerHTML = '<div class="empty-state">Sin dispositivos descubiertos. Esperando heartbeat en devices/{deviceId}/status o telemetria en devices/{deviceId}/telemetry.</div>';
    return;
  }

  const visible = state.devices.filter((d) => !areaFilter || (d.area || '') === areaFilter);

  grid.innerHTML = visible.map((device) => {
    const lastSeen = device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString('es-CO') : '--';
    const telemetry = device.lastTelemetry
      ? JSON.stringify(device.lastTelemetry).slice(0, 160)
      : 'Sin telemetria reciente';
    const statusClass = device.status === 'online' ? 'online' : 'offline';
    const statusBadge = device.status === 'online'
      ? '<span class="badge badge-dev-on"><i class="ti ti-activity"></i>Online</span>'
      : '<span class="badge badge-dev-off"><i class="ti ti-power"></i>Offline</span>';
    const area = device.area || 'Sin área';

    return `
      <div class="device-card ${statusClass}" data-device-id="${escapeHtml(device.deviceId)}">
        <div class="device-head">
          <div>
            <div class="device-id">${escapeHtml(device.name || device.deviceId)}</div>
            <div class="device-type">${escapeHtml(device.type || 'esp32')} - ${escapeHtml(device.deviceId)}</div>
          </div>
          ${statusBadge}
        </div>
        <div class="device-meta">
          <div><span>Ultimo heartbeat</span><strong>${escapeHtml(lastSeen)}</strong></div>
          <div>
            <span>Área</span>
            <strong>
              <button class="ghost-btn" data-edit-area="${escapeHtml(device.deviceId)}" style="padding:2px 6px; font-size:12px;">${escapeHtml(area)} ✎</button>
              <button class="ghost-btn" data-delete-device="${escapeHtml(device.deviceId)}" style="padding:2px 6px; font-size:12px; color: #ff4d4d; margin-left: 6px;" title="Eliminar dispositivo">🗑</button>
            </strong>
          </div>
        </div>
        ${deviceEntitiesHtml(device)}
        <div class="device-telemetry">${escapeHtml(telemetry)}</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-edit-area]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); editArea(b.dataset.editArea); }));
  grid.querySelectorAll('[data-delete-device]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); deleteDeviceUi(b.dataset.deleteDevice); }));

  // Reconstruir el índice tópico→entidad para resolver MQTT entrante.
  reindexEntities();
  // Render del panel de gauges del brazo desde su modelo de entidades.
  renderBrazoPanel();
  // Gráficas de sensores (histórico de telemetría).
  hydrateEntityCharts();
}

export function refreshDevicesSoon() {
  clearTimeout(state.refreshDevicesTimer);
  state.refreshDevicesTimer = setTimeout(loadDevices, 250);
}

export function upsertDevice(device) {
  if (!device?.deviceId) return;
  const index = state.devices.findIndex((item) => item.deviceId === device.deviceId);
  if (index >= 0) state.devices[index] = device;
  else state.devices.unshift(device);
  renderDevices();
}

export function connectIotEvents() {
  if (!state.auth?.token) return;
  subscribeToPush(); // suscripción a Web Push tras el login (idempotente)
  if (state.iotEvents) return;
  state.iotEvents = new EventSource(`${API}/iot/events?token=${encodeURIComponent(state.auth.token)}`);
  state.iotEvents.addEventListener('device', (event) => {
    const data = JSON.parse(event.data);
    upsertDevice(data.payload);
  });
  state.iotEvents.addEventListener('alert', (event) => {
    try { showAlert(JSON.parse(event.data).payload); } catch (e) { /* noop */ }
  });
  state.iotEvents.addEventListener('telemetry', (event) => {
    const data = JSON.parse(event.data);
    const telemetry = data.payload;
    const device = state.devices.find((item) => item.deviceId === telemetry.deviceId);
    if (device) {
      device.status = 'online';
      device.lastTelemetry = telemetry.payload;
      device.lastSeen = telemetry.receivedAt;
      renderDevices();
    } else {
      refreshDevicesSoon();
    }
  });
  state.iotEvents.onerror = () => {
    if (state.iotEvents) state.iotEvents.close();
    state.iotEvents = null;
    if (state.auth) setTimeout(connectIotEvents, 3000);
  };
}

export async function discoverDevices() {
  if (!hasPermission('manage_devices')) return addLog('No tienes permiso para sincronizar con la nube', 'err');
  const btn = $('discover-devices-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined rotate">sync</span> Sincronizando...';
  }
  try {
    const creds = {
      tuyaClientId: localStorage.getItem('tadashy_tuya_client_id') || '',
      tuyaSecret: localStorage.getItem('tadashy_tuya_secret') || '',
      shellyAuthKey: localStorage.getItem('tadashy_shelly_auth_key') || ''
    };
    await api('/devices/cloud-sync', {
      method: 'POST',
      body: JSON.stringify(creds)
    });
    addLog('Sincronización con la nube completada', 'ok');
    await loadDevices();
  } catch (error) {
    addLog(`Sincronización fallida: ${error.message}`, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">cloud_download</span> Sincronizar Nube';
    }
  }
}

export async function deleteDeviceUi(deviceId) {
  if (!confirm(`¿Estás seguro de que deseas eliminar el dispositivo "${deviceId}"?`)) return;
  try {
    await api(`/devices/${deviceId}`, { method: 'DELETE' });
    addLog(`Dispositivo "${deviceId}" eliminado exitosamente.`, 'ok');
  } catch (e) {
    addLog('No se pudo eliminar el dispositivo: ' + e.message, 'err');
  }
}

export function showCloudConfigModal() {
  if (!hasPermission('manage_devices')) return addLog('No tienes permiso para configurar la nube', 'err');
  $('cloud-tuya-client-id').value = localStorage.getItem('tadashy_tuya_client_id') || '';
  $('cloud-tuya-secret').value = localStorage.getItem('tadashy_tuya_secret') || '';
  $('cloud-shelly-auth-key').value = localStorage.getItem('tadashy_shelly_auth_key') || '';
  $('cloud-config-modal').style.display = 'flex';
}

export function closeCloudConfigModal() {
  $('cloud-config-modal').style.display = 'none';
}

export async function saveCloudConfig() {
  localStorage.setItem('tadashy_tuya_client_id', $('cloud-tuya-client-id').value.trim());
  localStorage.setItem('tadashy_tuya_secret', $('cloud-tuya-secret').value.trim());
  localStorage.setItem('tadashy_shelly_auth_key', $('cloud-shelly-auth-key').value.trim());
  closeCloudConfigModal();
  await discoverDevices();
}

