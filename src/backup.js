// Export / import de la configuración IoT (Fase 3).
import { api } from './api.js';
import { addLog } from './logger.js';

export async function exportConfig() {
  try {
    const data = await api('/backup/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tadashy-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    addLog('Configuración exportada', 'ok');
  } catch (e) {
    addLog('Error al exportar: ' + e.message, 'err');
  }
}

export async function importConfig(file) {
  if (!file) return;
  if (!confirm('Importar esta configuración fusionará dispositivos, reglas y áreas. ¿Continuar?')) return;
  try {
    const data = JSON.parse(await file.text());
    const res = await api('/backup/import', { method: 'POST', body: JSON.stringify(data) });
    const c = res.imported || {};
    addLog(`Importado: ${c.devices || 0} dispositivos, ${c.rules || 0} reglas, ${c.locations || 0} ubicaciones`, 'ok');
    if (res.errors && res.errors.length) addLog(`Avisos de importación: ${res.errors.length}`, 'err');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    addLog('Error al importar: ' + e.message, 'err');
  }
}
