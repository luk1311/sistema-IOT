import React, { useState } from 'react';

export default function Login({ onLogin }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Por ahora simular el intento de conexión hasta que importemos la lógica completa
      await onLogin(user, pass);
    } catch (err) {
      setError(err.message || 'Error de autenticación');
    }
  };

  return (
    <div id="login-overlay">
      <form id="login-form" className="glass-panel login-card" onSubmit={handleSubmit}>
        <div className="login-title">
          <img src="/favicon.ico" alt="Tadashy Logo" style={{ width: '36px', height: '36px', borderRadius: '8px' }} />
          <span>TADASHY V3</span>
        </div>
        <p className="font-outfit" style={{ color: 'var(--text-muted)', fontSize: '15px', textAlign: 'center', marginTop: '-10px', marginBottom: '8px' }}>
          Identificación Requerida
        </p>

        <input 
          type="text" 
          id="inp-user" 
          className="input-futuristic" 
          placeholder="Operador ID" 
          autoComplete="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <input 
          type="password" 
          id="inp-pass" 
          className="input-futuristic" 
          placeholder="Código de Acceso"
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />

        <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center', marginTop: '12px', minHeight: '52px', fontSize: '15px', letterSpacing: '0.05em', borderRadius: '12px' }}>
          <span className="material-symbols-outlined">login</span> AUTENTICAR
        </button>

        {error && <div id="login-err" style={{ color: 'var(--accent-offline)', marginTop: '12px', textAlign: 'center', fontSize: '14px' }}>{error}</div>}
      </form>
    </div>
  );
}
