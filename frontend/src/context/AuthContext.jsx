import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => JSON.parse(localStorage.getItem('tadashy_auth') || 'null'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (auth) {
      localStorage.setItem('tadashy_auth', JSON.stringify(auth));
    } else {
      localStorage.removeItem('tadashy_auth');
    }
  }, [auth]);

  const login = async (username, password) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.fetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      setAuth(data);
      return true;
    } catch (err) {
      setError(err.message === 'API_OFFLINE' ? 'API Offline o inalcanzable' : err.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    if (auth?.token) {
      api.fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    }
    setAuth(null);
  };

  const hasPermission = (permission) => {
    if (!auth?.user) return false;
    if (permission === 'mqtt_status' && auth.user.permissions?.includes('mqtt_monitor')) return true;
    if (permission === 'mqtt_publish' && auth.user.permissions?.includes('mqtt_monitor')) return true;
    return Boolean(auth.user.permissions?.includes(permission));
  };

  return (
    <AuthContext.Provider value={{ auth, login, logout, hasPermission, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
