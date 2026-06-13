import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export default function AiChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const isSpeakingRef = useRef(false);

  // Auto-scroll
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isListening]);

  // Enviar mensaje a la API
  const submitMessage = useCallback(async (textToSubmit) => {
    if (!textToSubmit.trim() || loading) return;
    
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: textToSubmit }]);
    setLoading(true);

    try {
      const res = await api.fetch('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: textToSubmit, sessionId: 'tadashy-react-session' })
      });
      
      if (res.response) {
        setMessages(prev => [...prev, { role: 'ai', content: res.response }]);
        if (voiceEnabled) {
          speakText(res.response);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [loading, voiceEnabled]);

  // Manejar el submit del formulario (enter)
  const handleFormSubmit = (e) => {
    e.preventDefault();
    submitMessage(input);
  };

  // --- LOGICA DE SINTESIS DE VOZ (HABLAR) ---
  const speakText = (text) => {
    if (!window.speechSynthesis) return;
    
    // Pausar el microfono para que no se escuche a si misma
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
    
    window.speechSynthesis.cancel(); // Detener audios previos
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-CO';
    utterance.rate = 1.05; // Un poco mas rapido para dar sensacion agil
    
    isSpeakingRef.current = true;

    utterance.onend = () => {
      isSpeakingRef.current = false;
      // Reactivar microfono si manos libres esta encendido
      if (voiceEnabled && recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch(e) {}
      }
    };
    
    utterance.onerror = () => {
      isSpeakingRef.current = false;
      if (voiceEnabled && recognitionRef.current) {
        try { recognitionRef.current.start(); } catch(e) {}
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  // --- LOGICA DE RECONOCIMIENTO DE VOZ (ESCUCHAR) ---
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API no soportada en este navegador');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'es-CO';
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      // Auto submit cuando termina de hablar
      submitMessage(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('Error de reconocimiento de voz:', event.error);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Bucle de manos libres continuo si sigue habilitado y la IA no esta hablando
      if (voiceEnabled && !isSpeakingRef.current) {
        // Timeout para prevenir bucles colisionados inmediatos
        setTimeout(() => {
          if (voiceEnabled && !isSpeakingRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch(e) {}
          }
        }, 300);
      }
    };

    return () => {
      recognition.abort();
    };
  }, [submitMessage, voiceEnabled]);

  // Manejar encendido/apagado manual
  const toggleVoice = () => {
    const nextState = !voiceEnabled;
    setVoiceEnabled(nextState);
    
    if (nextState) {
      // Pedir permisos y prender
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel(); // limpiar cola
        recognitionRef.current?.start();
      } catch(e) {}
    } else {
      // Apagar
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        recognitionRef.current?.stop();
      } catch(e) {}
    }
  };

  return (
    <section className="view active" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="section-header" style={{ marginBottom: '16px' }}>
        <div>
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--accent-ai)' }}>auto_awesome</span>
            Asistente TADASHY AI
          </h2>
          <p className="section-subtitle">Chatea o usa control de voz (Manos Libres) para comandar la red IoT.</p>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '48px', opacity: 0.5, marginBottom: '16px' }}>smart_toy</span>
              <p>Hola, soy TADASHY.</p>
              <p style={{ fontSize: '12px', marginTop: '8px' }}>Escribe o activa el micrófono para modo Manos Libres.</p>
            </div>
          )}
          
          {messages.map((m, i) => (
            <div key={i} className={`ai-message ${m.role}`}>
              <div className="ai-message-bubble">
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="ai-message ai">
              <div className="ai-message-bubble">
                <div className="status-pulse" style={{ background: 'var(--accent-ai)', display: 'inline-block', marginRight: '8px' }}></div>
                Procesando...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Indicador de escucha */}
        {isListening && (
          <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--accent-online)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            ● Escuchando...
          </div>
        )}

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.1)' }}>
          <form className="flex-row" style={{ gap: '12px' }} onSubmit={handleFormSubmit}>
            <button 
              type="button" 
              className={`btn ${voiceEnabled ? 'btn-primary pulse' : ''}`}
              onClick={toggleVoice}
              style={{ 
                padding: '0', width: '44px', height: '44px', borderRadius: '50%', minWidth: '44px', 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: voiceEnabled ? 'rgba(0, 230, 118, 0.2)' : '',
                borderColor: voiceEnabled ? 'var(--accent-online)' : '',
                color: voiceEnabled ? 'var(--accent-online)' : 'var(--text-primary)'
              }}
              title={voiceEnabled ? 'Apagar Manos Libres' : 'Activar Manos Libres'}
            >
              <span className="material-symbols-outlined">{voiceEnabled ? 'mic' : 'mic_off'}</span>
            </button>
            <input 
              type="text" 
              className="input-futuristic" 
              style={{ flex: 1 }} 
              placeholder={isListening ? 'Habla ahora...' : 'Escribe tu comando...'} 
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading || isListening}
            />
            <button type="submit" className="btn" style={{ background: 'rgba(124, 106, 255, 0.2)', color: 'var(--accent-ai)', borderColor: 'rgba(124, 106, 255, 0.4)' }} disabled={loading || isListening}>
              <span className="material-symbols-outlined">send</span>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
