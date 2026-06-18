import { $, state } from './state.js';
import { addLog } from './logger.js';
import { login, logout } from './auth.js';
import { switchView } from './views.js';
import { resetAll, mover, irA, setModo } from './robot.js';
import { conectarMqtt, disconnectMqtt, publish, hydrateMqttForm } from './mqtt.js';
import { discoverDevices, showCloudConfigModal, closeCloudConfigModal, saveCloudConfig, showMicroWizard, closeMicroWizard, generateArduinoCode, copyMicroCode, downloadMicroCode } from './devices.js';
import { createUser, toggleUser, deleteUser } from './users.js';
import { createAutomation, runAutomation, addVisualStep, handleStepActionChange } from './automations.js';
import { clearHistory } from './history.js';
import { sendAiMessage, executeBotAction } from './ai.js';
import { toggleVoice, toggleHandsFree, stopSpeaking, initVoiceAssistant, updateVoiceStatus } from './voice.js';
import { renderShell } from './auth.js';
import { initEntityControls } from './entities.js';
import { initNotifications } from './notifications.js';
import { exportConfig, importConfig } from './backup.js';

// Handlers requeridos por HTML generado dinámicamente (onclick/onchange inline)
window.executeBotAction = executeBotAction;
window.handleStepActionChange = handleStepActionChange;
window.sendAiMessage = sendAiMessage;

function bindEvents() {
  $('login-form').addEventListener('submit', login);
  $('logout-btn').addEventListener('click', logout);
  $('clear-log-btn').addEventListener('click', () => { $('log').innerHTML = ''; });
  $('reset-btn').addEventListener('click', resetAll);
  $('mqtt-form').addEventListener('submit', conectarMqtt);
  $('mqtt-disconnect').addEventListener('click', disconnectMqtt);
  $('publish-form').addEventListener('submit', (event) => {
    event.preventDefault();
    publish($('pub-topic').value.trim(), $('pub-message').value);
  });
  $('subscribe-btn').addEventListener('click', () => {
    if (state.client?.connected) {
      state.client.subscribe($('sub-topic').value.trim());
      addLog(`Suscrito a ${$('sub-topic').value.trim()}`, 'ok');
    }
  });
  $('automation-form').addEventListener('submit', createAutomation);
  $('user-form').addEventListener('submit', createUser);
  $('clear-history').addEventListener('click', clearHistory);
  $('discover-devices-btn').addEventListener('click', discoverDevices);
  $('cloud-config-btn')?.addEventListener('click', showCloudConfigModal);
  $('close-cloud-config-modal')?.addEventListener('click', closeCloudConfigModal);
  $('cancel-cloud-config-btn')?.addEventListener('click', closeCloudConfigModal);
  $('save-cloud-config-btn')?.addEventListener('click', saveCloudConfig);
  $('add-micro-btn')?.addEventListener('click', showMicroWizard);
  $('close-micro-wizard-modal')?.addEventListener('click', closeMicroWizard);
  $('micro-name-input')?.addEventListener('input', generateArduinoCode);
  $('micro-wifi-ssid')?.addEventListener('input', generateArduinoCode);
  $('micro-wifi-pass')?.addEventListener('input', generateArduinoCode);
  $('copy-micro-btn')?.addEventListener('click', copyMicroCode);
  $('download-micro-btn')?.addEventListener('click', downloadMicroCode);
  $('export-config-btn')?.addEventListener('click', exportConfig);
  $('import-config-input')?.addEventListener('change', (event) => {
    importConfig(event.target.files[0]);
    event.target.value = '';
  });
  $('voice-toggle-btn')?.addEventListener('click', toggleVoice);
  $('handsfree-toggle-btn')?.addEventListener('click', toggleHandsFree);
  $('stop-speaking-btn')?.addEventListener('click', stopSpeaking);
  $('ai-chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('ai-chat-input');
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    sendAiMessage(txt);
  });

  if ($('ptt-btn')) {
    const startPtt = () => {
      initVoiceAssistant();
      state.pttActive = true;
      try { state.voiceRecognition.start(); } catch (e) {}
      updateVoiceStatus('🎙️ Escuchando...', true);
    };
    const stopPtt = () => {
      state.pttActive = false;
      if (state.voiceRecognition && !state.voiceEnabled) {
        state.voiceRecognition.stop();
      }
      updateVoiceStatus(state.voiceEnabled ? 'Escuchando · Hey TADASHY' : 'Voz lista');
    };
    $('ptt-btn').addEventListener('mousedown', startPtt);
    $('ptt-btn').addEventListener('mouseup', stopPtt);
    $('ptt-btn').addEventListener('mouseleave', stopPtt);
    $('ptt-btn').addEventListener('touchstart', (e) => { e.preventDefault(); startPtt(); });
    $('ptt-btn').addEventListener('touchend', (e) => { e.preventDefault(); stopPtt(); });
  }

  $('nav-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-btn');
    if (button) window.location.hash = button.dataset.view;
  });

  window.addEventListener('hashchange', () => {
    const view = window.location.hash.slice(1);
    switchView(view);
  });

  const mobileMenuBtn = $('mobile-menu-btn');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      document.querySelector('.sidebar').classList.toggle('open');
    });
  }

  document.addEventListener('input', (event) => {
    if (event.target.matches('input[type=range][data-servo]')) mover(Number(event.target.dataset.servo), event.target.value);
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('input[type=range][data-servo]')) mover(Number(event.target.dataset.servo), event.target.value, true);
  });

  document.addEventListener('click', (event) => {
    // Cierre del sidebar en movil si se hace click fuera
    const sidebar = document.querySelector('.sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    if (sidebar && sidebar.classList.contains('open')) {
      if (!sidebar.contains(event.target) && !mobileBtn.contains(event.target)) {
        sidebar.classList.remove('open');
      }
    }

    const preset = event.target.closest('[data-servo][data-angle]');
    if (preset) irA(Number(preset.dataset.servo), Number(preset.dataset.angle));

    const mode = event.target.closest('[data-mode]');
    if (mode) setModo(mode.dataset.mode);

    if (event.target.closest('#btn-manual')) setModo('manual');
    if (event.target.closest('#btn-auto')) setModo('auto');
    if (event.target.closest('#reset-btn')) resetAll();
    if (event.target.closest('#btn-vision')) window.open('Brazo_vision.html', '_blank');

    const run = event.target.closest('[data-run-auto]');
    if (run) runAutomation(run.dataset.runAuto);

    const toggle = event.target.closest('[data-toggle-user]');
    if (toggle) toggleUser(toggle.dataset.toggleUser);

    const delUser = event.target.closest('[data-delete-user]');
    if (delUser) deleteUser(delUser.dataset.deleteUser);

    const deviceCard = event.target.closest('.device-card');
    if (deviceCard && !event.target.closest('.entity-widget')) {
      const deviceId = deviceCard.dataset.deviceId || '';
      if (deviceId.toLowerCase().includes('brazo')) {
        $('robot-modal').style.display = 'flex';
      }
    }
  });

  const closeRobotBtn = $('close-robot-modal');
  if (closeRobotBtn) {
    closeRobotBtn.addEventListener('click', () => {
      $('robot-modal').style.display = 'none';
    });
  }
}

// --- Arranque ---
bindEvents();
initEntityControls();
initNotifications();
hydrateMqttForm();
updateVoiceStatus(state.handsFreeMode ? 'Manos libres activo' : 'Voz lista · Hey TADASHY');
renderShell();

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('add-step-btn');
  if (btn) btn.addEventListener('click', addVisualStep);
  // Añadir el primer paso por defecto
  if (document.getElementById('visual-steps-container')) {
    addVisualStep();
  }
});
