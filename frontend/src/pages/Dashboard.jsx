import React from 'react';
import { useIoT } from '../context/IoTContext';

export default function Dashboard() {
  const { devices, history } = useIoT();
  const onlineCount = devices.filter(d => d.status === 'online').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>Dispositivos Online</h3>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary)' }}>
            {onlineCount} <span style={{fontSize:'1.5rem', color: 'var(--text-muted)'}}>/ {devices.length}</span>
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>Registros Históricos</h3>
          <div style={{ fontSize: '2.5rem', fontWeight: 700 }}>{history.length}</div>
        </div>
      </div>
      
      <div className="glass-panel" style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
        <h3 style={{ marginBottom: '16px' }}>Actividad Reciente</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {history.slice(0, 50).map(h => (
            <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
              <span>{h.detail}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{new Date(h.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {history.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No hay actividad reciente.</p>}
        </div>
      </div>
    </div>
  );
}
