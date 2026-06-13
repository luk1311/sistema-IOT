import React, { useState, useEffect } from 'react';
import { useIoT } from '../context/IoTContext';
import { Terminal, Settings, Save, RefreshCw } from 'lucide-react';

export default function MqttConsole() {
  const { history, publishMqtt } = useIoT();
  const [topic, setTopic] = useState('devices/+/status');
  const [payload, setPayload] = useState('{}');
  const [logFilter, setLogFilter] = useState('all');

  const filteredHistory = history.filter(h => {
    if (logFilter === 'all') return true;
    if (logFilter === 'mqtt') return h.action.includes('mqtt');
    if (logFilter === 'system') return !h.action.includes('mqtt');
    return true;
  });

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!topic) return;
    try {
      await publishMqtt(topic, payload);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '24px', height: '100%', overflow: 'hidden' }}>
      
      {/* Left Column: MQTT Publisher */}
      <div className="glass-panel" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Terminal size={24} color="var(--primary)" />
          <h2 style={{ margin: 0 }}>Consola MQTT</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Publica comandos o eventos directamente al broker.</p>

        <form onSubmit={handlePublish} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Topic</label>
            <input 
              type="text" 
              className="input-glass" 
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Ej: devices/living/light"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Payload (JSON/Text)</label>
            <textarea 
              className="input-glass" 
              value={payload}
              onChange={e => setPayload(e.target.value)}
              rows={8}
              style={{ fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            Publicar Mensaje
          </button>
        </form>
      </div>

      {/* Right Column: Logs / System Settings */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        <div className="glass-panel" style={{ flex: 2, padding: '24px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Registros del Sistema</h3>
            <select className="input-glass" style={{ width: 'auto', padding: '6px 12px' }} value={logFilter} onChange={e => setLogFilter(e.target.value)}>
              <option value="all">Todos</option>
              <option value="mqtt">Solo MQTT</option>
              <option value="system">Solo Sistema</option>
            </select>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {filteredHistory.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--primary)', flexShrink: 0 }}>[{new Date(h.createdAt).toLocaleTimeString()}]</span>
                <span style={{ color: 'var(--text-muted)', minWidth: '100px' }}>{h.action}</span>
                <span style={{ color: 'var(--text-main)' }}>{h.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ flex: 1, padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <Settings size={20} color="var(--primary)" />
            <h3 style={{ margin: 0 }}>Configuración de Red</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Event Stream (SSE)</span>
                <span className="badge badge-online">Activo</span>
             </div>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>MQTT Watchdog Timeout</span>
                <span style={{ color: 'var(--text-main)' }}>30000 ms</span>
             </div>
          </div>
        </div>

      </div>

    </div>
  );
}
