const API_BASE = '/api';

export const api = {
  async fetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    
    // Leer auth del storage directo para inyectar token sin ciclos de contexto
    const authData = JSON.parse(localStorage.getItem('tadashy_auth') || 'null');
    if (authData?.token) {
      headers.Authorization = `Bearer ${authData.token}`;
    }
    
    let res;
    try {
      res = await fetch(API_BASE + path, { ...options, headers });
    } catch (netErr) {
      throw new Error('API_OFFLINE');
    }

    let data = {};
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await res.json().catch(() => ({}));
    }
    
    if (res.status === 401 || res.status === 403) {
      if (path !== '/auth/login' && authData) {
        localStorage.removeItem('tadashy_auth'); // Forzar cierre de sesión duro
        window.location.reload(); // Hard reload limpiará estado
        throw new Error('SESSION_EXPIRED');
      }
    }
    
    if (!res.ok) throw new Error(data.error || 'Error de servidor');
    return data;
  }
};
