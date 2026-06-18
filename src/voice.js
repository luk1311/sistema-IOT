import { $, state } from './state.js';
import { api } from './api.js';
import { addLog } from './logger.js';
import { sendAiMessage } from './ai.js';

export function updateVoiceStatus(text, active = state.voiceEnabled) {
  const status = $('voice-status');
  if (status) status.textContent = text;
  $('voice-toggle-btn')?.classList.toggle('active', active);
  $('handsfree-toggle-btn')?.classList.toggle('active', state.handsFreeMode);
}

export function speakAi(text) {
  if (!('speechSynthesis' in window) || !text || (!state.voiceEnabled && !state.handsFreeMode && !state.pttActive)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').slice(0, 800));
  utterance.lang = 'es-CO';
  utterance.rate = 0.96;
  utterance.pitch = 1;

  utterance.onstart = () => {
    state.isSpeaking = true;
    if (state.voiceRecognition) {
      try { state.voiceRecognition.stop(); } catch (e) {}
    }
    updateVoiceStatus('Hablando... (micrófono desactivado)', false);
  };

  utterance.onend = () => {
    state.isSpeaking = false;
    setTimeout(() => {
      if (!state.isSpeaking && (state.voiceEnabled || state.pttActive)) {
        try { state.voiceRecognition.start(); } catch (e) {}
      }
      updateVoiceStatus(state.voiceEnabled ? 'Escuchando · Hey TADASHY' : (state.pttActive ? 'PTT Activo' : 'Voz lista'));
    }, 1000);
  };

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  state.isSpeaking = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  updateVoiceStatus(state.voiceEnabled ? 'Escuchando · Hey TADASHY' : 'Voz lista · Hey TADASHY');
  setTimeout(() => {
    if (state.voiceEnabled || state.pttActive) {
      try { state.voiceRecognition.start(); } catch (e) {}
    }
  }, 500);
}

export function normalizeVoiceText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export async function handleVoiceTranscript(transcript) {
  if (state.isSpeaking) return;
  const raw = String(transcript || '').trim();
  const normalized = normalizeVoiceText(raw);
  if (!raw) return;
  if (normalized.includes('stop talking') || normalized.includes('deja de hablar') || normalized.includes('silencio tadashy')) {
    stopSpeaking();
    return;
  }
  const wakeIndex = normalized.indexOf('hey tadashy');
  if (!state.handsFreeMode && wakeIndex === -1) {
    updateVoiceStatus('Esperando wake word · Hey TADASHY');
    return;
  }
  const command = wakeIndex >= 0 ? raw.slice(wakeIndex + 'hey tadashy'.length).trim() : raw;
  if (!command) return;
  updateVoiceStatus('Procesando voz...');
  const reply = await sendAiMessage(command, { channel: 'voice', sessionId: state.voiceSessionId, speak: true });
  if (reply) speakAi(reply);
  updateVoiceStatus(state.voiceEnabled ? 'Escuchando · Hey TADASHY' : 'Voz lista · Hey TADASHY');
}

export function initVoiceAssistant() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateVoiceStatus('STT no disponible en este navegador', false);
    return;
  }
  if (state.voiceRecognition) return;
  state.voiceRecognition = new SpeechRecognition();
  state.voiceRecognition.lang = 'es-CO';
  state.voiceRecognition.continuous = true;
  state.voiceRecognition.interimResults = false;
  state.voiceRecognition.maxAlternatives = 1;
  state.voiceRecognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if (last?.isFinal) handleVoiceTranscript(last[0].transcript).catch((err) => updateVoiceStatus(`Voz: ${err.message}`, false));
  };
  state.voiceRecognition.onend = () => {
    if ((state.voiceEnabled || state.pttActive) && !state.isSpeaking) {
      try { state.voiceRecognition.start(); } catch (err) {}
    }
  };
  state.voiceRecognition.onerror = (event) => updateVoiceStatus(`Voz: ${event.error || 'error'}`, false);
}

export function toggleVoice() {
  initVoiceAssistant();
  if (!state.voiceRecognition) return;
  state.voiceEnabled = !state.voiceEnabled;
  if (state.voiceEnabled) {
    try { state.voiceRecognition.start(); } catch (err) {}
    updateVoiceStatus('Escuchando · Hey TADASHY', true);
  } else {
    state.voiceRecognition.stop();
    updateVoiceStatus('Voz lista · Hey TADASHY', false);
  }
}

export async function toggleHandsFree() {
  state.handsFreeMode = !state.handsFreeMode;
  localStorage.setItem('tadashy_handsfree', JSON.stringify(state.handsFreeMode));
  updateVoiceStatus(state.handsFreeMode ? 'Manos libres activo' : 'Manos libres apagado');
  try {
    await api('/ai/memory', {
      method: 'PATCH',
      body: JSON.stringify({
        sessionId: state.voiceSessionId,
        memory: { preferences: { handsFree: state.handsFreeMode } }
      })
    });
  } catch (err) {
    addLog(`Preferencia de voz no guardada: ${err.message}`, 'err');
  }
}
