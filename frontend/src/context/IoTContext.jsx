import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from '../App';

const IoTContext = createContext(null);
export const useIoT = () => useContext(IoTContext);

export function IoTProvider({ children }) {
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [history, setHistory] = useState([]);
  const [groups, setGroups] = useState([]);
  const [sseStatus, setSseStatus] = useState('disconnected'); // disconnected, connected, error

  // Initial Fetch
  const fetchInitialData = async () => {
    try {
      const [devRes, histRes, grpRes] = await Promise.all([
        fetch('/api/devices', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/history', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/iot/groups', { headers: { Authorization: `Bearer ${token}` } })
      ]);
      
      if (devRes.ok) {
        const data = await devRes.json();
        setDevices(data.devices || []);
      }
      if (histRes.ok) {
        const data = await histRes.json();
        setHistory(data.history || []);
      }
      if (grpRes.ok) {
        const data = await grpRes.json();
        setGroups(data.groups || []);
      }
    } catch (err) {
      console.error('Error fetching initial data:', err);
    }
  };

  useEffect(() => {
    if (!token) return;
    
    fetchInitialData();
    
    // Setup SSE
    const es = new EventSource(`/api/iot/events?token=${token}`);
    
    es.onopen = () => setSseStatus('connected');
    es.onerror = () => setSseStatus('error');
    
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'device') {
          setDevices(prev => {
            const idx = prev.findIndex(d => d.deviceId === event.payload.deviceId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...event.payload };
              return next;
            }
            return [...prev, event.payload];
          });
        }
        if (event.type === 'telemetry') {
          // You could optionally store global telemetry here or rely on the device component to fetch
          setDevices(prev => prev.map(d => {
            if (d.deviceId === event.payload.deviceId) {
              return { ...d, lastTelemetry: event.payload };
            }
            return d;
          }));
        }
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    return () => es.close();
  }, [token]);

  // Actions
  const publishMqtt = async (topic, payload) => {
    const res = await fetch('/api/mqtt/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ topic, payload })
    });
    if (!res.ok) throw new Error('Error publicando MQTT');
  };

  const updateDevice = async (deviceId, patch) => {
    const res = await fetch(`/api/devices/${deviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error('Error actualizando dispositivo');
  };

  return (
    <IoTContext.Provider value={{ devices, history, groups, sseStatus, publishMqtt, updateDevice, refresh: fetchInitialData }}>
      {children}
    </IoTContext.Provider>
  );
}
