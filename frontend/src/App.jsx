import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MqttProvider } from './context/MqttContext';

import Login from './components/Login';
import MainLayout from './layout/MainLayout';
import Dashboard from './pages/Dashboard';
import MqttTerminal from './pages/MqttTerminal';
import AiChat from './pages/AiChat';
import Devices from './pages/Devices';

// Placeholder for other pages
const Placeholder = ({ title }) => (
  <section className="view active">
    <div className="section-header">
      <h2 className="section-title">{title}</h2>
      <p className="section-subtitle">Página en construcción durante la Fase 2.</p>
    </div>
  </section>
);

function AppRoutes() {
  const { auth, login } = useAuth();

  if (!auth) {
    return (
      <div className="app-layout" style={{ display: 'flex' }}>
        <div className="atmosphere">
          <div className="atmosphere-glow-1"></div>
          <div className="atmosphere-glow-2"></div>
        </div>
        <Login onLogin={login} />
      </div>
    );
  }

  return (
    <MqttProvider>
      <div className="app-layout" style={{ display: 'flex' }}>
        <div className="atmosphere">
          <div className="atmosphere-glow-1"></div>
          <div className="atmosphere-glow-2"></div>
        </div>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="devices" element={<Devices />} />
            <Route path="ai" element={<AiChat />} />
            <Route path="mqtt" element={<MqttTerminal />} />
            <Route path="automations" element={<Placeholder title="Automatizaciones" />} />
            <Route path="history" element={<Placeholder title="Registros" />} />
            <Route path="users" element={<Placeholder title="Usuarios" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Route>
        </Routes>
      </div>
    </MqttProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
