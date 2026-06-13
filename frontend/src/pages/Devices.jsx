import React from 'react';
import { useIoT } from '../context/IoTContext';
import { Power, Settings, WifiOff, Wifi } from 'lucide-react';

export default function Devices() {
  const { devices, publishMqtt } = useIoT();

  const handleCommand = async (deviceId, command) => {
    try {
      await publishMqtt(`devices/${deviceId}/commands`, JSON.stringify({ command, at: new Date().toISOString() }));
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dispositivos IoT</h2>
        <button className="btn btn-primary" onClick={() => handleCommand('broadcast', 'announce')}>Descubrir Dispositivos</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
        {devices.map(device => {
          const isOnline = device.status === 'online';
          return (
            <div key={device.deviceId} className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ 
                    width: '40px', height: '40px', borderRadius: '8px', 
                    background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' 
                  }}>
                    {isOnline ? <Wifi size={20} color="var(--success)" /> : <WifiOff size={20} color="var(--danger)" />}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', margin: 0 }}>{device.name || device.deviceId}</h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{device.type || 'Desconocido'}</span>
                  </div>
                </div>
                <span className={`badge ${isOnline ? 'badge-online' : 'badge-offline'}`}>
                  <div className="status-pulse"></div> {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              {device.lastTelemetry && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontSize: '0.85rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Última Telemetría:</div>
                  <pre style={{ margin: 0, fontFamily: 'monospace', color: 'var(--primary)' }}>
                    {JSON.stringify(device.lastTelemetry, null, 2)}
                  </pre>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                {device.capabilities?.includes('switch') && (
                  <>
                    <button className="btn btn-ghost" style={{ flex: 1, padding: '8px', background: 'rgba(0, 230, 118, 0.1)', color: 'var(--success)' }}
                            onClick={() => handleCommand(device.deviceId, 'ON')}>
                      ON
                    </button>
                    <button className="btn btn-ghost" style={{ flex: 1, padding: '8px', background: 'rgba(255, 23, 68, 0.1)', color: 'var(--danger)' }}
                            onClick={() => handleCommand(device.deviceId, 'OFF')}>
                      OFF
                    </button>
                  </>
                )}
                {device.capabilities?.includes('arm') && (
                  <button className="btn btn-primary" style={{ flex: 1, padding: '8px' }}
                          onClick={() => handleCommand(device.deviceId, 'MOVE_HOME')}>
                    HOME
                  </button>
                )}
                <button className="btn btn-ghost" style={{ padding: '8px' }} title="Configuración">
                  <Settings size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
