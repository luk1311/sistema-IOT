import { $, escapeHtml, state } from './state.js';

export function addLog(msg, tipo = 'inf') {
  if (msg === state.lastLogMsg && state.lastLogElement) {
    state.lastLogCount++;
    state.lastLogElement.innerHTML = `<span class="log-ts">${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span class="log-${tipo}">${escapeHtml(msg)} <span style="opacity:0.6">(${state.lastLogCount}x)</span></span>`;
    return;
  }

  state.lastLogMsg = msg;
  state.lastLogCount = 1;
  const ts = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = `<span class="log-ts">${ts}</span><span class="log-${tipo}">${escapeHtml(msg)}</span>`;
  state.lastLogElement = row;

  $('log').prepend(row);
  while ($('log').children.length > 80) $('log').removeChild($('log').lastChild);
}
