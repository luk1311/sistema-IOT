import { $, state, roleLabels } from './state.js';
import { api } from './api.js';
import { addLog } from './logger.js';
import { switchView } from './views.js';
import { buildCards } from './robot.js';
import { connectIotEvents } from './devices.js';
import { autoConnectMqtt } from './mqtt.js';
import { loadAll } from './loaders.js';

export function hasPermission(permission) {
  if (permission === 'mqtt_status' && state.auth?.user?.permissions?.includes('mqtt_monitor')) return true;
  if (permission === 'mqtt_publish' && state.auth?.user?.permissions?.includes('mqtt_monitor')) return true;
  return Boolean(state.auth?.user?.permissions?.includes(permission));
}

export function roleLabel(role) {
  return roleLabels[role] || role;
}

export function renderShell() {
  $('login-overlay').style.display = state.auth ? 'none' : 'flex';
  $('main').style.display = state.auth ? 'grid' : 'none';
  if (!state.auth) return;

  $('session-name').textContent = state.auth.user.username;
  const roleEl = document.querySelector('.operator-role');
  if (roleEl) roleEl.textContent = roleLabel(state.auth.user.role);
  document.querySelectorAll('[data-permission]').forEach((el) => {
    el.classList.toggle('hidden', !hasPermission(el.dataset.permission));
  });
  const hash = window.location.hash.slice(1);
  const targetView = hash || 'dashboard';
  const targetBtn = document.querySelector(`.nav-btn[data-view="${targetView}"]`);
  if (targetBtn && !targetBtn.classList.contains('hidden')) {
    switchView(targetView);
  } else {
    switchView('dashboard');
  }
  buildCards();
  loadAll();
  connectIotEvents();
  autoConnectMqtt();
}

export async function login(event) {
  event.preventDefault();
  const username = $('inp-user').value.trim();
  const password = $('inp-pass').value;
  const errEl = $('login-err');
  errEl.style.display = 'none';

  try {
    state.auth = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem('tadashy_auth', JSON.stringify(state.auth));
    addLog(`Sesión iniciada por ${state.auth.user.username}`, 'ok');
    renderShell();
  } catch (error) {
    errEl.textContent = error.message;
    errEl.style.display = 'block';
  }
}

export function logout() {
  if (state.auth?.token) {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
  }
  localStorage.removeItem('tadashy_auth');
  state.auth = null;
  if (state.client) state.client.end(true);
  state.client = null;
  if (state.iotEvents) state.iotEvents.close();
  state.iotEvents = null;
  renderShell();
}
