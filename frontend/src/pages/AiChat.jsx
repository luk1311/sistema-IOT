import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../App';
import { Bot, Send, Mic, User } from 'lucide-react';

export default function AiChat() {
  const { token, user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/voice/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          text: userMsg,
          sessionId: 'react_web_ui',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error en Tadashy AI');

      setMessages(prev => [...prev, { role: 'ai', content: data.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: `[Error]: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
      <div className="glass-panel" style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <div style={{ background: 'var(--primary-glow)', padding: '12px', borderRadius: '50%' }}>
          <Bot size={28} color="var(--primary)" />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>Tadashy IA</h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--success)' }}>En línea (Agente Principal)</span>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Bot size={48} opacity={0.2} style={{ marginBottom: '16px' }} />
            <p>Hola {user?.username}, soy Tadashy.<br/>¿En qué puedo ayudarte hoy?</p>
          </div>
        )}
        
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          return (
            <div key={idx} style={{ 
              display: 'flex', 
              gap: '12px', 
              alignItems: 'flex-start',
              flexDirection: isUser ? 'row-reverse' : 'row'
            }}>
              <div style={{ 
                width: '36px', height: '36px', borderRadius: '50%', 
                background: isUser ? 'var(--primary)' : 'rgba(255,255,255,0.1)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}>
                {isUser ? <User size={20} color="#000" /> : <Bot size={20} color="var(--primary)" />}
              </div>
              <div style={{ 
                background: isUser ? 'var(--primary-glow)' : 'rgba(0,0,0,0.3)',
                border: isUser ? '1px solid var(--primary)' : '1px solid var(--glass-border)',
                padding: '12px 16px',
                borderRadius: '12px',
                maxWidth: '75%',
                lineHeight: '1.5'
              }}>
                {msg.content}
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={20} color="var(--text-muted)" />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Procesando...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
        <button type="button" className="btn btn-ghost" style={{ padding: '12px', borderRadius: '50%' }}>
          <Mic size={20} />
        </button>
        <input 
          className="input-glass" 
          value={input} 
          onChange={e => setInput(e.target.value)}
          placeholder="Escribe un comando o pregunta a Tadashy..."
          style={{ flex: 1, padding: '14px 16px', fontSize: '1rem' }}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={!input.trim() || isLoading} style={{ padding: '12px 24px' }}>
          <Send size={20} />
        </button>
      </form>
    </div>
  );
}
