import { $, escapeHtml, state } from './state.js';
import { addLog } from './logger.js';
import { api } from './api.js';

export async function loadHistory() {
  const list = $('history-list');
  if (list) {
    list.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-muted);"><span class="material-symbols-outlined" style="font-size: 32px; animation: pulse 1s infinite;">history</span><div style="margin-top: 12px; font-family: \'Outfit\';">Obteniendo registros...</div></div>';
  }

  // UX delay to show the loading animation clearly
  await new Promise(r => setTimeout(r, 600));

  const data = await api('/history?t=' + Date.now());
  state.historyItems = data.history || [];
  if (list) {
    if (state.historyItems.length === 0) {
      list.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">No hay registros.</div>';
    } else {
      list.innerHTML = state.historyItems.map((item) => `
        <div class="history-row">
          <span class="row-meta">${new Date(item.createdAt).toLocaleString('es-CO')}</span>
          <span class="topic">${escapeHtml(item.type)}</span>
          <span>${escapeHtml(item.detail)}</span>
        </div>`).join('');
    }
  }
}

export async function clearHistory() {
  const list = $('history-list');
  if (list) {
    list.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-muted);"><span class="material-symbols-outlined" style="font-size: 32px; animation: pulse 1s infinite;">delete</span><div style="margin-top: 12px; font-family: \'Outfit\';">Limpiando registros...</div></div>';
  }

  await new Promise(r => setTimeout(r, 400));

  try {
    await api('/history', { method: 'DELETE' });
  } catch (e) {
    console.warn('Backend does not support DELETE /history, clearing locally');
  }

  state.historyItems = [];
  if (list) {
    list.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">No hay registros.</div>';
  }
  addLog('Historial limpiado', 'info');
}
