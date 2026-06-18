// Control del brazo robótico. El render de los gauges vive en entities.js
// (modelo de entidades); aquí queda la lógica de modo/reset y los helpers que
// usan las automatizaciones (irA), publicando a los tópicos del brazo.
import { $, state } from './state.js';
import { addLog } from './logger.js';
import { saveHistory } from './api.js';
import { hasPermission } from './auth.js';
import { publish } from './mqtt.js';
import { optimisticRange } from './entities.js';

const INTERVALO = 40;

// Mapea un número de servo (1..N) al id de entidad del brazo según el orden.
function brazoRangeId(servo) {
  const brazo = (state.devices || []).find((d) => d.deviceId === 'brazo');
  const ranges = (brazo?.entities || [])
    .filter((e) => e.capability === 'range')
    .sort((a, b) => (a.ui?.order ?? 99) - (b.ui?.order ?? 99));
  return ranges[servo - 1]?.id || null;
}

export function mover(servo, valor, force = false) {
  if (!hasPermission('robot_control')) return;
  const ahora = Date.now();
  if (!force && ahora - state.ultimoEnvio[servo - 1] <= INTERVALO) return;
  state.ultimoEnvio[servo - 1] = ahora;
  publish(`brazo/servo/${servo}`, valor);
  const id = brazoRangeId(servo);
  if (id) optimisticRange('brazo', id, valor);
  addLog(`Servo ${servo} -> ${valor}°`, 'ok');
}

export function irA(servo, val) {
  if (!hasPermission('robot_control')) return;
  mover(servo, val, true);
}

export function resetAll() {
  if (!hasPermission('robot_control')) return addLog('No tienes permiso para controlar el brazo', 'err');
  for (let i = 1; i <= 4; i++) irA(i, 90);
  saveHistory('robot', 'Todos los servos centrados a 90°');
}

export function setModo(modo) {
  if (!hasPermission('robot_control')) return addLog('No tienes permiso para cambiar el modo', 'err');
  state.currentMode = modo;
  $('btn-manual')?.classList.toggle('active', modo === 'manual');
  $('btn-auto')?.classList.toggle('active', modo === 'auto');
  publish('brazo/modo', modo);
  saveHistory('robot_mode', `Modo cambiado a ${modo}`);
}
