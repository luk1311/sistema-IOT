import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useMqtt } from '../context/MqttContext';

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const { deviceCache } = useMqtt();

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const data = await api.fetch('/devices');
      setDevices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching devices', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  return (
    <section className="view active">
      <div className="section-header">
        <div>
          <h2 className="section-title">Inventario de Dispositivos</h2>
          <p className="section-subtitle">Monitoreo y control de todo el hardware registrado.</p>
        </div>
        <button className="btn btn-primary" onClick={fetchDevices}>
          <span className="material-symbols-outlined">refresh</span> Actualizar
        </button>
      </div>

      <div className="dashboard-grid">
        <div className="glass-panel panel-p-lg" style={{ gridColumn: '1 / -1' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Cargando dispositivos...</div>
          ) : devices.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No hay dispositivos registrados.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
              {devices.map(dev => {
                const isOnline = deviceCache[`devices/${dev.mac}/status`] === 'online';
                return (
                  <div key={dev.mac} className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="flex-between">
                      <strong className="font-outfit" style={{ fontSize: '18px' }}>{dev.name || 'Dispositivo'}</strong>
                      <span className={`badge ${isOnline ? 'badge-ok' : 'badge-offline'}`}>
                        {isOnline ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>MAC: {dev.mac}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>Tipo: {dev.type || 'Generic ESP32'}</div>
                    <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border-glass)' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>Última IP: {dev.last_ip || 'N/A'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
