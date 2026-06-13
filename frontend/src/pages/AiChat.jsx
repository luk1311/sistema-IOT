import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';

export default function AiChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const chatEndRef = useRef(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await api.fetch('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: userMsg, sessionId: 'tadashy-react-session' })
      });
      
      if (res.response) {
        setMessages(prev => [...prev, { role: 'ai', content: res.response }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
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
          <p className="section-subtitle">Chatea con la Inteligencia Artificial para consultar y analizar el estado de tu red IoT.</p>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '48px', opacity: 0.5, marginBottom: '16px' }}>smart_toy</span>
              <p>Hola, soy TADASHY. Pregúntame sobre el estado de la casa o envía comandos.</p>
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
              <div className="ai-message-bubble">Escribiendo...</div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.1)' }}>
          <form className="flex-row" style={{ gap: '12px' }} onSubmit={handleSubmit}>
            <button 
              type="button" 
              className={`btn ${voiceEnabled ? 'btn-primary pulse' : ''}`}
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              style={{ padding: '0', width: '44px', height: '44px', borderRadius: '50%', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span className="material-symbols-outlined">{voiceEnabled ? 'mic' : 'mic_off'}</span>
            </button>
            <input 
              type="text" 
              className="input-futuristic" 
              style={{ flex: 1 }} 
              placeholder="Escribe tu comando..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading}
            />
            <button type="submit" className="btn" style={{ background: 'rgba(124, 106, 255, 0.2)', color: 'var(--accent-ai)', borderColor: 'rgba(124, 106, 255, 0.4)' }} disabled={loading}>
              <span className="material-symbols-outlined">send</span>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
