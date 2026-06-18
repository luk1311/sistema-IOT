// Alertas proactivas en el frontend (Fase 2, Slice A).
// Muestra toasts + Notification del navegador (primer plano) al recibir el
// evento SSE 'alert'. La suscripción a Web Push (segundo plano) se añade en Slice B.
import { $, escapeHtml } from './state.js';
import { api } from './api.js';
import { addLog } from './logger.js';

const ICONS = { warning: 'ti-alert-triangle', info: 'ti-circle-check', critical: 'ti-alert-octagon' };
let toastContainer = null;

function ensureContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showAlert(alert) {
  if (!alert || !alert.message) return;
  const severity = alert.severity || 'warning';

  // Toast en pantalla.
  const container = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${severity}`;
  el.innerHTML = `
    <i class="ti ${ICONS[severity] || ICONS.warning}"></i>
    <div class="toast-body">
      <strong>${escapeHtml(alert.deviceId || 'Sistema')}</strong>
      <span>${escapeHtml(alert.message)}</span>
    </div>
    <button class="toast-close" aria-label="Cerrar">&times;</button>`;
  container.appendChild(el);
  const remove = () => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); };
  el.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, 7000);

  // Registro en el log.
  addLog(`Alerta: ${alert.message}`, severity === 'info' ? 'inf' : 'err');

  // Notificación nativa del navegador (primer plano).
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`TADASHY · ${alert.deviceId || 'Alerta'}`, {
        body: alert.message,
        tag: `alert-${alert.type}-${alert.deviceId}`
      });
    }
  } catch (e) { /* noop */ }
}

export async function initNotifications() {
  // Pedir permiso de notificaciones (se espera para poder suscribir al push después).
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
  } catch (e) { /* noop */ }
}

let pushSubscribed = false;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Suscribe el navegador a Web Push (segundo plano). Idempotente; requiere sesión.
export async function subscribeToPush() {
  if (pushSubscribed) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const vap = await api('/push/vapid');
    if (!vap.enabled || !vap.publicKey) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vap.publicKey)
      });
    }
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
    pushSubscribed = true;
    addLog('Notificaciones de segundo plano activadas', 'ok');
  } catch (e) { /* push opcional: el primer plano sigue funcionando */ }
}
