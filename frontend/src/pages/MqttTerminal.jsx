import React, { useState } from 'react';
import { useMqtt } from '../context/MqttContext';

export default function MqttTerminal() {
  const { status, connect, disconnect, publish } = useMqtt();
  
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9001');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [pubTopic, setPubTopic] = useState('brazo/servo/1');
  const [pubPayload, setPubPayload] = useState('90');

  const handleConnect = (e) => {
    e.preventDefault();
    connect(host, port, username, password);
  };

  const handlePublish = (e) => {
    e.preventDefault();
    if (pubTopic && pubPayload) {
      publish(pubTopic, pubPayload);
    }
  };

  return (
    <section className="view active">
      <div className="section-header">
        <div>
          <h2 className="section-title">Explorador y monitor MQTT</h2>
          <p className="section-subtitle">Conexión, suscripción, publicación y trazas del broker.</p>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="glass-panel panel-p-lg col-8">
          <h3 style={{ fontSize: '18px', marginBottom: '16px', color: 'var(--text-primary)' }}>Parámetros de Conexión WebSockets</h3>
          <form className="flex-col" onSubmit={handleConnect} style={{ gap: '16px' }}>
            <div className="flex-row" style={{ gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label className="font-outfit" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>Broker Host (WSS)</label>
                <input type="text" className="input-futuristic" placeholder="ej. iot.tadashy.com" value={host} onChange={e => setHost(e.target.value)} required />
              </div>
              <div style={{ width: '120px' }}>
                <label className="font-outfit" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>Puerto</label>
                <input type="number" className="input-futuristic" placeholder="9001" value={port} onChange={e => setPort(e.target.value)} required />
              </div>
            </div>
            
            <div className="flex-row" style={{ gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label className="font-outfit" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>Usuario</label>
                <input type="text" className="input-futuristic" placeholder="admin" value={username} onChange={e => setUsername(e.target.value)} required />
              </div>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label className="font-outfit" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>Contraseña</label>
                <input type="password" className="input-futuristic" placeholder="********" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
            </div>

            <div className="flex-row" style={{ marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={status === 'connecting'}>
                <span className="material-symbols-outlined">link</span> 
                {status === 'connecting' ? 'CONECTANDO...' : 'CONECTAR BROKER'}
              </button>
              <button type="button" className="btn btn-danger" onClick={disconnect} disabled={status === 'offline'}>
                <span className="material-symbols-outlined">link_off</span> DESCONECTAR
              </button>
            </div>
          </form>

          <hr style={{ borderColor: 'var(--border-glass)', margin: '32px 0' }} />

          <h3 style={{ fontSize: '18px', marginBottom: '16px', color: 'var(--text-primary)' }}>Publicador Rápido</h3>
          <form className="flex-row" style={{ gap: '12px', flexWrap: 'wrap' }} onSubmit={handlePublish}>
            <input type="text" className="input-futuristic" style={{ flex: 2, minWidth: '200px' }} placeholder="Tópico (ej. brazo/servo/1)" value={pubTopic} onChange={e => setPubTopic(e.target.value)} required />
            <input type="text" className="input-futuristic" style={{ flex: 1, minWidth: '100px' }} placeholder="Mensaje" value={pubPayload} onChange={e => setPubPayload(e.target.value)} required />
            <button type="submit" className="btn" style={{ borderColor: 'var(--accent-online)', color: 'var(--accent-online)' }}>
              <span className="material-symbols-outlined">send</span> PUBLICAR
            </button>
          </form>
        </div>

        <div className="glass-panel panel-p-md col-4" style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: 'rgba(0,0,0,0.2)' }}>
            <span className="font-outfit" style={{ fontSize: '16px', fontWeight: '600' }}>Terminal MQTT</span>
            <span className="font-outfit" style={{ fontSize: '10px', color: 'var(--accent-online)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              ● RECIBIENDO TRAZAS
            </span>
          </div>
          
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
            <div id="mqtt-log">
              {/* Aquí irían los logs si queremos mostrar los MQTT específicos */}
              <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Los logs unificados de MQTT y Sistema se pueden ver en el Dashboard central.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
