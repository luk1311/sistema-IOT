
export const API = '/api';
export const INTERVALO = 40;
export const servoNames = ['Base', 'Hombro', 'Codo', 'Muñeca'];
export const servoKeys = ['base', 'shoulder', 'elbow', 'wrist'];
export const servoIcons = ['ti-rotate-clockwise', 'ti-arrow-up', 'ti-fold-up', 'ti-hand-grab'];
export const roleLabels = { super_admin: 'Super Admin', admin: 'Super Admin', operator: 'Operador', guest: 'Invitado', viewer: 'Invitado' };

export const state = {
  client: null,
  pubTotal: 0,
  mqttTotal: 0,
  ultimoEnvio: [0, 0, 0, 0],
  auth: JSON.parse(localStorage.getItem('tadashy_auth') || 'null'),
  automations: [],
  users: [],
  historyItems: [],
  devices: [],
  currentMode: 'manual',
  deviceTimer: null,
  iotEvents: null,
  voiceRecognition: null,
  voiceEnabled: false,
  handsFreeMode: JSON.parse(localStorage.getItem('tadashy_handsfree') || 'false'),
  voiceSessionId: localStorage.getItem('tadashy_voice_session') || `voice-${Date.now()}`,
  isSpeaking: false,
  pttActive: false,
  aiCallsSaved: 0,
  aiTokensSaved: 0,
  lastLogMsg: '',
  lastLogCount: 1,
  lastLogElement: null,
  lastMqttTopic: '',
  lastMqttPayload: '',
  lastMqttCount: 1,
  lastMqttRow: null,
  refreshDevicesTimer: null
};

export const viewCopy = {
  dashboard: ['Dashboard IoT', 'Estado en tiempo real del sistema y del broker MQTT.'],
  devices: ['Inventario de Dispositivos', 'Monitoreo y control de todo el hardware registrado.'],
  mqtt: ['Explorador y monitor MQTT', 'Conexión, suscripción, publicación y trazas del broker.'],
  automations: ['Automatizaciones', 'Secuencias guardadas con ejecución y registro histórico.'],
  history: ['Historial', 'Eventos de usuario, MQTT, servos y automatizaciones.'],
  users: ['Gestión de usuarios', 'Administración de cuentas, roles y permisos.'],
  ai: ['Asistente TADASHY AI', 'Chatea con la Inteligencia Artificial para consultar y analizar el estado de tu red IoT.']
};

export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
}
