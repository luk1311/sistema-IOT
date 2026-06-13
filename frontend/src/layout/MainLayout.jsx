import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMqtt } from '../context/MqttContext';

export default function MainLayout() {
  const { auth, logout, hasPermission } = useAuth();
  const { status: mqttStatus } = useMqtt();

  // Badge Status logic (simplified for local API check - in real use, we might want a global ping)
  const apiBadge = (
    <span id="api-badge" className="badge badge-online">
      <div className="status-pulse" style={{ background: 'var(--accent-online)' }}></div> API Online
    </span>
  );

  const mqttBadge = mqttStatus === 'online' ? (
    <span id="conn-badge" className="badge badge-ok">
      <i className="ti ti-wifi"></i> MQTT conectado
    </span>
  ) : mqttStatus === 'connecting' ? (
    <span id="conn-badge" className="badge badge-warn">
      <div className="status-pulse"></div> Conectando...
    </span>
  ) : (
    <span id="conn-badge" className="badge badge-offline">
      <i className="ti ti-wifi-off"></i> MQTT Offline
    </span>
  );

  return (
    <div id="main" className="app-layout" style={{ display: 'flex' }}>
      <header className="topbar">
        <div className="brand">
          <button id="mobile-menu-btn" className="btn ghost-btn mobile-only" style={{ padding: '4px', marginRight: '8px' }} aria-label="Abrir menú de navegación">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="material-symbols-outlined logo-icon">psychology</span>
          <h1>TADASHY</h1>
        </div>
        <div className="top-status">
          {apiBadge}
          {mqttBadge}
          <div className="operator-profile">
            <span id="session-name" className="operator-name">{auth?.user?.username || 'USER'}</span>
            <span className="operator-role">{auth?.user?.role || 'System Operator'}</span>
          </div>
          <button id="logout-btn" onClick={logout} className="btn btn-danger" style={{ padding: '6px 10px' }} aria-label="Cerrar sesión">
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>

      <nav className="sidebar">
        <div id="nav-tabs" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 16px' }}>
          {hasPermission('view_dashboard') && (
            <NavLink to="/" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
              <span className="material-symbols-outlined">dashboard</span> Dashboard
            </NavLink>
          )}
          {hasPermission('view_dashboard') && (
            <NavLink to="/devices" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
              <span className="material-symbols-outlined">memory</span> Dispositivos
            </NavLink>
          )}
          {hasPermission('ai_chat') && (
            <NavLink to="/ai" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
              <span className="material-symbols-outlined">auto_awesome</span> Tadashy IA
            </NavLink>
          )}
          {hasPermission('mqtt_status') && (
            <NavLink to="/mqtt" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
              <span className="material-symbols-outlined">terminal</span> Consola MQTT
            </NavLink>
          )}
          {hasPermission('manage_automations') && (
            <NavLink to="/automations" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
              <span className="material-symbols-outlined">account_tree</span> Automatizaciones
            </NavLink>
          )}
          {hasPermission('view_history') && (
            <NavLink to="/history" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
              <span className="material-symbols-outlined">history</span> Registros
            </NavLink>
          )}
          {hasPermission('manage_users') && (
            <NavLink to="/users" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
              <span className="material-symbols-outlined">group</span> Usuarios
            </NavLink>
          )}
        </div>
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
