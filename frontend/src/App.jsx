import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { LogIn, Activity, Cpu, Bot, Terminal, GitMerge, History, LogOut, Menu } from 'lucide-react';
import { IoTProvider, useIoT } from './context/IoTContext';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import AiChat from './pages/AiChat';
import MqttConsole from './pages/MqttConsole';
import './index.css';

// Contexts
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// --- Auth Provider ---
function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('tadashy_token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('tadashy_user') || 'null'));

  const login = (newToken, newUser) => {
    localStorage.setItem('tadashy_token', newToken);
    localStorage.setItem('tadashy_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('tadashy_token');
    localStorage.removeItem('tadashy_user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// --- Layout Component ---
function Layout({ children }) {
  const { user, logout } = useAuth();
  const { sseStatus } = useIoT();
  const location = useLocation();

  const navItems = [
    { path: '/', icon: Activity, label: 'Dashboard' },
    { path: '/devices', icon: Cpu, label: 'Dispositivos' },
    { path: '/ai', icon: Bot, label: 'Tadashy IA' },
    { path: '/mqtt', icon: Terminal, label: 'Consola MQTT' },
    { path: '/automations', icon: GitMerge, label: 'Automatizaciones' },
    { path: '/history', icon: History, label: 'Registros' }
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside className="glass-panel" style={{ width: '260px', margin: '16px', display: 'flex', flexDirection: 'column', padding: '24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 24px', marginBottom: '32px' }}>
          <Cpu size={28} color="var(--primary)" />
          <h2 style={{ fontSize: '1.25rem', letterSpacing: '0.1em' }}>TADASHY</h2>
        </div>
        
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 16px', flex: 1 }}>
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path} style={{ textDecoration: 'none' }}>
                <button className="btn btn-ghost" style={{ 
                  width: '100%', 
                  justifyContent: 'flex-start', 
                  color: isActive ? 'var(--text-main)' : 'var(--text-muted)', 
                  background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
                  borderRadius: '0 8px 8px 0'
                }}>
                  <item.icon size={20} /> {item.label}
                </button>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 16px 16px 0', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <header className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', marginBottom: '16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-ghost" style={{ padding: '8px' }}><Menu size={20} /></button>
            <span className={`badge ${sseStatus === 'connected' ? 'badge-online' : 'badge-offline'}`}>
              <div className="status-pulse"></div> API {sseStatus === 'connected' ? 'Online' : 'Offline'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user?.username || 'USER'}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user?.role || 'Operator'}</div>
            </div>
            <button className="btn btn-danger" onClick={logout} style={{ padding: '8px 12px' }}>
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </main>
    </div>
  );
}

// --- Login Page Placeholder ---
function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de login');
      login(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <form onSubmit={handleLogin} className="glass-panel" style={{ padding: '40px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '2rem', marginBottom: '8px' }}>TADASHY</h2>
          <p style={{ color: 'var(--text-muted)' }}>Identificación Requerida</p>
        </div>
        <input 
          type="text" 
          className="input-glass" 
          placeholder="Operador ID" 
          value={username} 
          onChange={(e) => setUsername(e.target.value)} 
        />
        <input 
          type="password" 
          className="input-glass" 
          placeholder="Código de Acceso" 
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
        />
        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', textAlign: 'center' }}>{error}</div>}
        <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center', marginTop: '16px', padding: '14px' }}>
          <LogIn size={20} /> AUTENTICAR
        </button>
      </form>
    </div>
  );
}

// --- Dashboard Page Placeholder ---
function DashboardPage() {
  return <Dashboard />;
}

// --- App Router ---
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={
            <RequireGuest><LoginPage /></RequireGuest>
          } />
          <Route path="/*" element={
            <RequireAuth>
              <IoTProvider>
                <Layout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/devices" element={<Devices />} />
                    <Route path="/ai" element={<AiChat />} />
                    <Route path="/mqtt" element={<MqttConsole />} />
                    {/* Placeholder for other routes */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Layout>
              </IoTProvider>
            </RequireAuth>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function RequireAuth({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

function RequireGuest({ children }) {
  const { token } = useAuth();
  return !token ? children : <Navigate to="/" replace />;
}
