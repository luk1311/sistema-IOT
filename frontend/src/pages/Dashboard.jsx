import React, { useState, useEffect } from 'react';
import { useMqtt } from '../context/MqttContext';
import ServoCard from '../components/ServoCard';

export default function Dashboard() {
  const { messages, stats, deviceCache } = useMqtt();
  const [modalOpen, setModalOpen] = useState(false);

  const servos = [
    { name: 'Base', icon: 'ti-rotate-clockwise' },
    { name: 'Hombro', icon: 'ti-arrow-up' },
    { name: 'Codo', icon: 'ti-fold-up' },
    { name: 'Muñeca', icon: 'ti-hand-grab' }
  ];

  return (
    <section className="view active">
      <div className="section-header">
        <div>
          <h2 className="section-title">Dashboard IoT</h2>
          <p className="section-subtitle">Estado en tiempo real del sistema y del broker MQTT.</p>
        </div>
      </div>

      <div className="metric-grid">
        <div className="glass-panel metric-card">
          <span className="metric-title">Dispositivos</span>
          <span className="metric-value">1</span>
        </div>
        <div className="glass-panel metric-card">
          <span className="metric-title">Nodos Online</span>
          <span className="metric-value" style={{ color: 'var(--accent-online)' }}>1</span>
        </div>
        <div className="glass-panel metric-card">
          <span className="metric-title">Mensajes MQTT</span>
          <span className="metric-value">{stats.received}</span>
        </div>
        <div className="glass-panel metric-card">
          <span className="metric-title">Automatizaciones</span>
          <span className="metric-value">0</span>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Brazo Robótico Card */}
        <div className="glass-panel panel-p-lg col-8">
          <div className="flex-between" style={{ marginBottom: '24px' }}>
            <h3 className="font-outfit" style={{ fontSize: '20px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--accent-ai)' }}>precision_manufacturing</span>
              Brazo Robótico v1
            </h3>
            <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
              <span className="material-symbols-outlined">tune</span> Panel de Control
            </button>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-md)', padding: '16px', fontFamily: 'monospace', fontSize: '13px', border: '1px solid var(--border-glass)' }}>
            <div className="flex-between" style={{ marginBottom: '12px', borderBottom: '1px dashed rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-muted)' }}>ARTICULACIÓN</span>
              <span style={{ color: 'var(--text-muted)' }}>ÁNGULO ACTUAL</span>
            </div>
            {servos.map((s, i) => (
              <div key={i} className="flex-between" style={{ marginBottom: i < 3 ? '8px' : '0' }}>
                <span>{s.name} (Servo {i + 1})</span>
                <strong style={{ color: 'var(--accent-ai)' }}>{deviceCache[`brazo/servo/feedback/${i+1}`] || '90'}°</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Log de Sistema */}
        <div className="glass-panel panel-p-md col-4" style={{ display: 'flex', flexDirection: 'column', maxHeight: '400px' }}>
          <div className="flex-between" style={{ marginBottom: '16px' }}>
            <span className="font-outfit" style={{ fontSize: '16px', fontWeight: '600' }}>System Logs</span>
            <button className="btn" style={{ padding: '4px 8px' }} onClick={() => {}}><span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span></button>
          </div>
          <div id="log" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {messages.slice(0, 50).map(m => (
              <div key={m.id} className="log-row">
                <span className="log-ts">{m.ts}</span>
                <span className={`log-${m.type}`}>{m.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modalOpen && (
        <div id="robot-modal" className="active" style={{ display: 'flex' }}>
          <div className="glass-panel modal-content">
            <div style={{ padding: '24px', borderBottom: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.3)', position: 'relative' }}>
              <button className="btn" onClick={() => setModalOpen(false)} style={{ position: 'absolute', top: '16px', right: '16px', padding: 0, width: '36px', height: '36px', minHeight: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
              </button>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
                <h2 className="font-outfit" style={{ fontSize: '24px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '40px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent-ai)' }}>precision_manufacturing</span>
                  Control Maestro
                </h2>
                <div className="flex-row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn-primary">Modo Manual</button>
                  <button className="btn">Automático</button>
                  <button className="btn" style={{ color: 'var(--accent-ai)', borderColor: 'rgba(124, 106, 255, 0.5)', borderStyle: 'solid', borderWidth: '1px' }}>
                    <span className="material-symbols-outlined">visibility</span> Visión IA
                  </button>
                  <button className="btn btn-danger">
                    <span className="material-symbols-outlined">restart_alt</span> Reset
                  </button>
                </div>
              </div>
            </div>

            <div style={{ padding: '24px' }}>
              <div className="servo-grid">
                {servos.map((s, i) => (
                  <ServoCard key={i} index={i+1} name={s.name} iconKey={s.icon} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
