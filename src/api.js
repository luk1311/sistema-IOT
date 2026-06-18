import { API, $, state } from './state.js';
import { addLog } from './logger.js';
import { logout } from './auth.js';

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.auth?.token) headers.Authorization = `Bearer ${state.auth.token}`;

  let res;
  try {
    res = await fetch(API + path, { ...options, headers });
    if ($('api-badge')) {
      $('api-badge').className = 'badge badge-online';
      $('api-badge').innerHTML = '<div class="status-pulse" style="background: var(--accent-online);"></div> API Online';
    }
  } catch (netErr) {
    if ($('api-badge')) {
      $('api-badge').className = 'badge badge-offline';
      $('api-badge').innerHTML = '<div class="status-pulse"></div> API Offline';
    }
    throw new Error('API Offline o inalcanzable');
  }

  let data = {};
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json().catch(() => ({}));
  }

  if (res.status === 401 || res.status === 403) {
    if (path !== '/auth/login' && state.auth) {
      logout();
      throw new Error('Sesión expirada. Por favor, inicia sesión de nuevo.');
    }
  }

  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

export async function saveHistory(type, detail, metadata = {}) {
  try {
    await api('/history', {
      method: 'POST',
      body: JSON.stringify({ type, detail, metadata })
    });
  } catch (error) {
    addLog(`Historial no guardado: ${error.message}`, 'err');
  }
}
