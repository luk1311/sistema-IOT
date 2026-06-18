import { $, viewCopy } from './state.js';
import { loadAiChat } from './ai.js';

export function switchView(view) {
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${view}`));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('view-title').textContent = viewCopy[view] ? viewCopy[view][0] : 'Vista';
  $('view-subtitle').textContent = viewCopy[view] ? viewCopy[view][1] : '';
  if (view === 'ai') loadAiChat();
}
