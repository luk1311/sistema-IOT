import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import mqtt from 'mqtt';
import { useAuth } from './AuthContext';
import { api } from '../services/api';

const MqttContext = createContext(null);

export function MqttProvider({ children }) {
  const { auth, hasPermission } = useAuth();
  const [client, setClient] = useState(null);
  const [status, setStatus] = useState('offline'); // offline, connecting, online
  const [messages, setMessages] = useState([]);
  const [stats, setStats] = useState({ received: 0, published: 0 });
  const [error, setError] = useState(null);
  
  // Caché de estado de dispositivos rápidos (online/offline)
  const [deviceCache, setDeviceCache] = useState({});

  useEffect(() => {
    if (!auth) {
      if (client) client.end(true);
      setClient(null);
      setStatus('offline');
    }
  }, [auth]);

  const addLog = (msg, type = 'inf') => {
    const ts = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setMessages(prev => [{ ts, msg, type, id: Date.now() + Math.random() }, ...prev].slice(0, 100));
  };

  const connect = useCallback((host, port, username, password) => {
    if (!hasPermission('mqtt_status')) {
      addLog('No tienes permiso para conectar MQTT', 'err');
      return;
    }
    
    if (client) client.end(true);
    setStatus('connecting');
    setError(null);

    const newClient = mqtt.connect(`wss://${host}:${port}/mqtt`, {
      username,
      password,
      clientId: `tadashy_web_${Math.random().toString(16).slice(2, 8)}`,
      connectTimeout: 6000,
      reconnectPeriod: 2000,
      keepalive: 30
    });

    newClient.on('connect', () => {
      setStatus('online');
      addLog('Broker MQTT conectado', 'ok');
      newClient.subscribe('brazo/#');
      newClient.subscribe('devices/#');
    });

    newClient.on('offline', () => {
      setStatus('offline');
      addLog('Broker MQTT desconectado', 'err');
    });

    newClient.on('error', (err) => {
      setStatus('offline');
      setError(err.message);
      addLog(`Error MQTT: ${err.message}`, 'err');
    });

    newClient.on('message', (topic, payloadBuffer) => {
      const payload = payloadBuffer.toString();
      setStats(s => ({ ...s, received: s.received + 1 }));
      addLog(`${topic}: ${payload}`, 'msg');
      
      // Actualizar status rápido de device (si es telemetría o status)
      setDeviceCache(prev => {
        const next = { ...prev };
        next[topic] = payload;
        return next;
      });
    });

    setClient(newClient);
    
    // Save to local storage to auto-connect later
    localStorage.setItem('tadashy_mqtt', JSON.stringify({ host, port, username, password }));
  }, [client, hasPermission]);

  const disconnect = useCallback(() => {
    if (client) client.end(true);
    setClient(null);
    setStatus('offline');
  }, [client]);

  const publish = async (topic, payload) => {
    if (!hasPermission('mqtt_publish')) {
      addLog('No tienes permiso para publicar MQTT', 'err');
      return false;
    }

    if (client && client.connected) {
      client.publish(topic, String(payload));
      setStats(s => ({ ...s, published: s.published + 1 }));
      return true;
    }

    // Fallback al backend HTTP si no estamos conectados directamente
    try {
      const res = await api.fetch('/mqtt/publish', {
        method: 'POST',
        body: JSON.stringify({ topic, payload: String(payload) })
      });
      if (res.success) {
        setStats(s => ({ ...s, published: s.published + 1 }));
        return true;
      }
    } catch (err) {
      addLog(`Error HTTP publicando: ${err.message}`, 'err');
    }
    return false;
  };

  // Autoconnect effect
  useEffect(() => {
    if (auth && !client && status === 'offline') {
      const saved = localStorage.getItem('tadashy_mqtt');
      if (saved) {
        try {
          const { host, port, username, password } = JSON.parse(saved);
          connect(host, port, username, password);
        } catch(e) {}
      }
    }
  }, [auth, client, status, connect]);

  return (
    <MqttContext.Provider value={{ status, messages, stats, error, connect, disconnect, publish, deviceCache, addLog }}>
      {children}
    </MqttContext.Provider>
  );
}

export const useMqtt = () => useContext(MqttContext);
