import { API, $, escapeHtml, state } from './state.js';
import { addLog } from './logger.js';
import { api } from './api.js';
import { hasPermission } from './auth.js';

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

export function renderDevices() {
  const grid = $('device-grid');
  if (!grid) return;
  const online = state.devices.filter((device) => device.status === 'online').length;
  $('device-total').textContent = state.devices.length;
  $('device-online-total').textContent = online;

  if (!state.devices.length) {
    grid.innerHTML = '<div class="empty-state">Sin dispositivos descubiertos. Esperando heartbeat en devices/{deviceId}/status o telemetria en devices/{deviceId}/telemetry.</div>';
    return;
  }

  grid.innerHTML = state.devices.map((device) => {
    const lastSeen = device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString('es-CO') : '--';
    const firmware = device.firmware || device.metadata?.firmware || '--';
    const telemetry = device.lastTelemetry
      ? JSON.stringify(device.lastTelemetry).slice(0, 160)
      : 'Sin telemetria reciente';
    const statusClass = device.status === 'online' ? 'online' : 'offline';
    const statusBadge = device.status === 'online'
      ? '<span class="badge badge-dev-on"><i class="ti ti-activity"></i>Online</span>'
      : '<span class="badge badge-dev-off"><i class="ti ti-power"></i>Offline</span>';

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
          <div><span>Firmware</span><strong>${escapeHtml(firmware)}</strong></div>
        </div>
        <div class="device-telemetry">${escapeHtml(telemetry)}</div>
      </div>`;
  }).join('');
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
  if (!state.auth?.token || state.iotEvents) return;
  state.iotEvents = new EventSource(`${API}/iot/events?token=${encodeURIComponent(state.auth.token)}`);
  state.iotEvents.addEventListener('device', (event) => {
    const data = JSON.parse(event.data);
    upsertDevice(data.payload);
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
  if (!hasPermission('manage_devices')) return addLog('No tienes permiso para descubrimiento IoT', 'err');
  try {
    await api('/devices/discover', { method: 'POST' });
    addLog('Solicitud de descubrimiento IoT enviada', 'ok');
  } catch (error) {
    addLog(`Descubrimiento IoT fallido: ${error.message}`, 'err');
  }
}
