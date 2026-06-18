import { $, state, viewCopy } from './state.js';
import { loadAiChat } from './ai.js';
import { loadRules } from './rules.js';

export function switchView(view) {
  if (!state.auth) return;

  const cleanView = view || 'dashboard';
  if (!viewCopy[cleanView]) {
    window.location.hash = 'dashboard';
    return;
  }

  // Verificar si la vista está restringida por permisos (su botón en la barra lateral está oculto)
  const btn = document.querySelector(`.nav-btn[data-view="${cleanView}"]`);
  if (btn && btn.classList.contains('hidden')) {
    window.location.hash = 'dashboard';
    return;
  }

  // Sincronizar el hash en la URL
  if (window.location.hash !== `#${cleanView}`) {
    window.location.hash = cleanView;
    return;
  }

  // Renderizar la vista activa
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${cleanView}`));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.view === cleanView));
  $('view-title').textContent = viewCopy[cleanView] ? viewCopy[cleanView][0] : 'Vista';
  $('view-subtitle').textContent = viewCopy[cleanView] ? viewCopy[cleanView][1] : '';
  
  if (cleanView === 'ai') loadAiChat();
  if (cleanView === 'automations') loadRules();
  // Gemelo digital 3D: import dinámico para aislar la dependencia de Three (CDN).
  if (cleanView === 'dashboard') {
    import('./hud3d.js?v=2').then((m) => m.initHud3d()).catch(() => {});
  }
}
