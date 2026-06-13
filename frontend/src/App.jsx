import React, { useState } from 'react';
import Login from './components/Login';

export default function App() {
  const [auth, setAuth] = useState(false);
  const [view, setView] = useState('dashboard');
  
  const handleLogin = () => {
    setAuth(true);
  };

  if (!auth) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div id="main" className="app-layout" style={{ display: auth ? "flex" : "none" }}>

    {/*  Top Navigation Bar  */}
    <header className="topbar">
      <div className="brand">
        <button id="mobile-menu-btn" className="btn ghost-btn mobile-only" style={{ padding: "4px", marginRight: "8px" }} aria-label="Abrir menú de navegación">
          <span className="material-symbols-outlined">menu</span>
        </button>
        <span className="material-symbols-outlined logo-icon">psychology</span>
        <h1>TADASHY</h1>
      </div>
      <div className="top-status">
        <span id="api-badge" className="badge badge-offline">
          <div className="status-pulse"></div> API Offline
        </span>
        <span id="conn-badge" className="badge badge-offline">
          <div className="status-pulse"></div> MQTT Offline
        </span>

        <div className="operator-profile">
          <span id="session-name" className="operator-name">USER</span>
          <span className="operator-role">System Operator</span>
        </div>
        <button id="logout-btn" className="btn btn-danger" style={{ padding: "6px 10px" }} aria-label="Cerrar sesión">
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>
    </header>

    {/*  Sidebar Navigation  */}
    <nav className="sidebar">
      <div id="nav-tabs" style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 16px" }}>
        <button className="nav-btn active" data-view="dashboard" data-permission="view_dashboard">
          <span className="material-symbols-outlined">dashboard</span> Dashboard
        </button>
        <button className="nav-btn" data-view="devices" data-permission="view_dashboard">
          <span className="material-symbols-outlined">memory</span> Dispositivos
        </button>
        <button className="nav-btn" data-view="ai" data-permission="ai_chat">
          <span className="material-symbols-outlined">auto_awesome</span> Tadashy IA
        </button>
        <button className="nav-btn" data-view="mqtt" data-permission="mqtt_status">
          <span className="material-symbols-outlined">terminal</span> Consola MQTT
        </button>
        <button className="nav-btn" data-view="automations" data-permission="manage_automations">
          <span className="material-symbols-outlined">account_tree</span> Automatizaciones
        </button>
        <button className="nav-btn" data-view="history" data-permission="view_history">
          <span className="material-symbols-outlined">history</span> Registros
        </button>
        <button className="nav-btn" data-view="users" data-permission="manage_users">
          <span className="material-symbols-outlined">group</span> Usuarios
        </button>
      </div>

    </nav>

    {/*  Main Views Container  */}
    <main className="main-content">
      <div className="section-header">
        <div>
          <h2 id="view-title" className="section-title">Vista</h2>
          <p id="view-subtitle" className="section-subtitle">Descripción de la vista</p>
        </div>
        <div>
          {/*  Reserved for view-specific actions if needed  */}
        </div>
      </div>

      {/*  VIEW: DASHBOARD  */}
      <section id="view-dashboard" className="view active">
        <div className="metric-grid">
          <div className="glass-panel metric-card">
            <span className="metric-title">Dispositivos</span>
            <span className="metric-value" id="device-total">0</span>
          </div>
          <div className="glass-panel metric-card">
            <span className="metric-title">Nodos Online</span>
            <span className="metric-value" id="device-online-total" style={{ color: "var(--accent-online)" }}>0</span>
          </div>
          <div className="glass-panel metric-card">
            <span className="metric-title">Mensajes MQTT</span>
            <span className="metric-value" id="mqtt-total">0</span>
          </div>
          <div className="glass-panel metric-card">
            <span className="metric-title">Automatizaciones</span>
            <span className="metric-value" id="auto-total">0</span>
          </div>
        </div>

        <div className="dashboard-grid">
          {/*  Brazo Robótico Card  */}
          <div className="glass-panel panel-p-lg col-8">
            <div className="flex-between" style={{ marginBottom: "24px" }}>
              <h3 className="font-outfit"
                style={{ fontSize: "20px", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--accent-ai)" }}>precision_manufacturing</span>
                Brazo Robótico v1
              </h3>
              <button className="btn btn-primary" onclick="document.getElementById('robot-modal').classList.add('active')">
                <span className="material-symbols-outlined">tune</span> Panel de Control
              </button>
            </div>

            <div
              style={{ background: "rgba(0,0,0,0.3)", borderRadius: "var(--radius-md)", padding: "16px", fontFamily: "monospace", fontSize: "13px", border: "1px solid var(--border-glass)" }}>
              <div className="flex-between"
                style={{ marginBottom: "12px", borderBottom: "1px dashed rgba(255,255,255,0.1)", paddingBottom: "8px" }}>
                <span style={{ color: "var(--text-muted)" }}>ARTICULACIÓN</span>
                <span style={{ color: "var(--text-muted)" }}>ÁNGULO ACTUAL</span>
              </div>
              <div className="flex-between" style={{ marginBottom: "8px" }}><span>Base (Servo 1)</span><strong id="dash-base"
                  style={{ color: "var(--accent-ai)" }}>90°</strong></div>
              <div className="flex-between" style={{ marginBottom: "8px" }}><span>Hombro (Servo 2)</span><strong
                  id="dash-shoulder" style={{ color: "var(--accent-ai)" }}>90°</strong></div>
              <div className="flex-between" style={{ marginBottom: "8px" }}><span>Codo (Servo 3)</span><strong id="dash-elbow"
                  style={{ color: "var(--accent-ai)" }}>90°</strong></div>
              <div className="flex-between"><span>Muñeca (Servo 4)</span><strong id="dash-wrist"
                  style={{ color: "var(--accent-ai)" }}>90°</strong></div>
            </div>
          </div>

          {/*  Log de Sistema  */}
          <div className="glass-panel panel-p-md col-4" style={{ display: "flex", flexDirection: "column", maxHeight: "400px" }}>
            <div className="flex-between" style={{ marginBottom: "16px" }}>
              <span className="font-outfit" style={{ fontSize: "16px", fontWeight: "600" }}>System Logs</span>
              <button id="clear-log-btn" className="btn" style={{ padding: "4px 8px" }}><span className="material-symbols-outlined"
                  style={{ fontSize: "16px" }}>delete</span></button>
            </div>
            <div id="log" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
              {/*  Logs injected by JS  */}
            </div>
          </div>
        </div>
      </section>

      {/*  VIEW: DEVICES  */}
      <section id="view-devices" className="view">
        <div style={{ marginBottom: "24px" }}>
          <button id="discover-devices-btn" className="btn btn-primary">
            <span className="material-symbols-outlined">radar</span> Buscar Nodos
          </button>
        </div>
        <div id="device-grid" className="device-grid">
          {/*  Devices injected by JS  */}
        </div>
      </section>

      {/*  VIEW: AI CHAT  */}
      <section id="view-ai" className="view">
        <div className="dashboard-grid">
          <div className="col-8">
            <div className="glass-panel" style={{ display: "flex", flexDirection: "column", height: "600px" }}>
              <div
                style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-glass)", display: "flex", justifyContent: "spaceBetween", alignItems: "center", flexWrap: "wrap", gap: "12px", background: "rgba(0,0,0,0.2)" }}>
                <div className="flex-row" style={{ flexWrap: "wrap" }}>
                  <h4 style={{ color: "var(--accent-ai)", fontSize: "16px" }}>TADASHY_AI</h4>
                  <span id="ai-model-badge"
                    style={{ fontSize: "10px", color: "var(--accent-online)", letterSpacing: "0.1em", textTransform: "uppercase" }}>ONLINE</span>
                </div>
                <div className="flex-row" style={{ flexWrap: "wrap" }}>
                  <span id="voice-status" style={{ fontSize: "11px", color: "var(--text-muted)" }}>Voz lista · Hey
                    TADASHY</span>
                  <button id="ptt-btn" className="btn" title="Push-to-Talk (Mantener presionado)"><span
                      className="material-symbols-outlined">mic_external_on</span></button>
                  <button id="voice-toggle-btn" className="btn" title="Escucha Continua"><span
                      className="material-symbols-outlined">mic</span></button>
                  <button id="handsfree-toggle-btn" className="btn" title="Manos Libres"><span
                      className="material-symbols-outlined">headset_mic</span></button>
                </div>
              </div>
              <div id="ai-chat-messages" style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
                {/*  Messages injected by JS  */}
              </div>
              <form id="ai-chat-form"
                style={{ padding: "16px 24px", borderTop: "1px solid var(--border-glass)", background: "rgba(0,0,0,0.1)" }}>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input type="text" id="ai-chat-input" className="input-futuristic"
                    style={{ paddingRight: "48px", borderRadius: "var(--radius-md)" }}
                    placeholder="Escribe un comando a TADASHY..." autocomplete="off" />
                  <button type="submit"
                    style={{ position: "absolute", right: "16px", background: "transparent", border: "none", color: "var(--accent-ai)", cursor: "pointer" }}>
                    <span className="material-symbols-outlined">send</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
          <div className="col-4 flex-column">
            <div className="glass-panel panel-p-lg">
              <div className="flex-row" style={{ marginBottom: "16px" }}>
                <span className="material-symbols-outlined"
                  style={{ color: "var(--accent-ai)", fontSize: "32px" }}>psychology</span>
                <div>
                  <h4 style={{ color: "var(--text-primary)", fontSize: "18px" }}>Información del Nodo</h4>
                  <span id="ai-info-model"
                    style={{ fontSize: "11px", color: "var(--accent-online)", textTransform: "uppercase", fontWeight: "600" }}>Mistral</span>
                </div>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>Endpoint Local:</p>
              <p id="ai-info-endpoint"
                style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-primary)", marginBottom: "24px", wordBreak: "break-all" }}>
                http://localhost:11434</p>

              <div
                style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-glass)", borderRadius: "var(--radius-md)", padding: "12px", marginBottom: "24px" }}>
                <h4 style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>Ahorro por Comandos (LLM
                  Bypassed)</h4>
                <div className="flex-row" style={{ justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "13px" }}>Consultas Evitadas:</span>
                  <span id="ai-calls-saved" style={{ fontWeight: "600", color: "var(--accent-ai)" }}>0</span>
                </div>
                <div className="flex-row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontSize: "13px" }}>Tokens Ahorrados:</span>
                  <span id="ai-tokens-saved" style={{ fontWeight: "600", color: "var(--accent-online)" }}>~0</span>
                </div>
              </div>

              <h4
                style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "12px", borderBottom: "1px solid var(--border-glass)", paddingBottom: "8px" }}>
                Capacidades Integradas</h4>
              <div id="ai-tools-list"
                style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "350px", overflowY: "auto" }}>
                {/*  Tools injected by JS  */}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/*  VIEW: MQTT  */}
      <section id="view-mqtt" className="view">
        <div className="dashboard-grid">
          <div className="col-4 flex-column">
            <form id="mqtt-form" className="glass-panel panel-p-lg">
              <h3 className="font-outfit" style={{ marginBottom: "16px", fontSize: "18px" }}>Configuración Broker</h3>
              <input type="text" id="mqtt-host" className="input-futuristic" placeholder="Host (wss://...)"
                style={{ marginBottom: "12px" }} />
              <input type="number" id="mqtt-port" className="input-futuristic" placeholder="Puerto"
                style={{ marginBottom: "12px" }} />
              <input type="text" id="mqtt-user" className="input-futuristic" placeholder="Usuario"
                style={{ marginBottom: "12px" }} />
              <input type="password" id="mqtt-pass" className="input-futuristic" placeholder="Contraseña"
                style={{ marginBottom: "24px" }} />
              <div className="flex-row">
                <button type="submit" className="btn btn-primary"
                  style={{ flex: 1, justifyContent: "center" }}>Conectar</button>
                <button type="button" id="mqtt-disconnect" className="btn btn-danger"><span
                    className="material-symbols-outlined">power_off</span></button>
              </div>
            </form>
            <form id="publish-form" className="glass-panel panel-p-lg">
              <h3 className="font-outfit" style={{ marginBottom: "16px", fontSize: "18px" }}>Publicador</h3>
              <input type="text" id="pub-topic" className="input-futuristic" placeholder="Tópico (ej. brazo/cmd)" required
                style={{ marginBottom: "12px" }} />
              <input type="text" id="pub-message" className="input-futuristic" placeholder="Payload" required
                style={{ marginBottom: "16px" }} />
              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>Publicar
                Mensaje</button>
            </form>
          </div>
          <div className="col-8 glass-panel" style={{ display: "flex", flexDirection: "column", height: "600px" }}>
            <div
              style={{ padding: "16px", borderBottom: "1px solid var(--border-glass)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <span className="font-outfit" style={{ fontWeight: "600" }}>Terminal MQTT</span>
              <div className="flex-row" style={{ flexWrap: "wrap" }}>
                <input type="text" id="sub-topic" className="input-futuristic" placeholder="Tópico a suscribir..."
                  style={{ padding: "6px 12px", margin: "0", minWidth: "150px", flex: 1 }} />
                <button id="subscribe-btn" className="btn btn-primary" style={{ padding: "6px 12px" }}>Suscribir</button>
              </div>
            </div>
            <div id="mqtt-messages"
              style={{ flex: 1, overflowY: "auto", padding: "16px", fontFamily: "monospace", fontSize: "12px", background: "rgba(0,0,0,0.5)" }}>
              {/*  MQTT Log Items  */}
            </div>
          </div>
        </div>
      </section>

      {/*  VIEW: AUTOMATIONS  */}
      <section id="view-automations" className="view">
        <div className="dashboard-grid">
          <div className="col-4">
            <form id="automation-form" className="glass-panel panel-p-lg">
              <h3 className="font-outfit" style={{ marginBottom: "16px", fontSize: "18px" }}>Nueva Rutina</h3>
              <input type="text" id="auto-name" className="input-futuristic" placeholder="Nombre (ej. Secuencia Alfa)"
                required style={{ marginBottom: "12px" }} />
              <textarea id="auto-steps" className="input-futuristic"
                placeholder="[{&quot;topic&quot;:&quot;brazo/servo/1&quot;,&quot;payload&quot;:&quot;90&quot;,&quot;delay&quot;:1000}]"
                required style={{ marginBottom: "16px", height: "120px", resize: "none" }}></textarea>
              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>Guardar
                Rutina</button>
            </form>
          </div>
          <div className="col-8">
            <div id="automation-list" style={{ display: "flex", flexDirection: "column" }}>
              {/*  Automations injected by JS  */}
            </div>
          </div>
        </div>
      </section>

      {/*  VIEW: HISTORY  */}
      <section id="view-history" className="view">
        <div style={{ marginBottom: "24px" }}>
          <button id="clear-history" className="btn btn-danger">
            <span className="material-symbols-outlined">delete</span> Limpiar
          </button>
        </div>
        <div className="glass-panel" style={{ maxHeight: "600px", overflowY: "auto", padding: "16px" }}>
          <div id="history-list" style={{ display: "flex", flexDirection: "column" }}>
            {/*  History Items injected by JS  */}
          </div>
        </div>
      </section>

      {/*  VIEW: USERS  */}
      <section id="view-users" className="view">
        <div className="dashboard-grid">
          <div className="col-4">
            <form id="user-form" className="glass-panel panel-p-lg">
              <h3 className="font-outfit" style={{ marginBottom: "16px", fontSize: "18px" }}>Nuevo Operador</h3>
              <input type="text" id="new-username" className="input-futuristic" placeholder="Usuario" required
                style={{ marginBottom: "12px" }} />
              <input type="password" id="new-password" className="input-futuristic" placeholder="Contraseña" required
                style={{ marginBottom: "12px" }} />
              <select id="new-role" className="input-futuristic"
                style={{ marginBottom: "24px", appearance: "none", color: "var(--text-muted)" }}>
                <option value="operator">Operador Básico</option>
                <option value="super_admin">Administrador</option>
                <option value="guest">Invitado</option>
              </select>
              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>Crear
                Cuenta</button>
            </form>
          </div>
          <div className="col-8">
            <div id="user-list" style={{ display: "flex", flexDirection: "column" }}>
              {/*  User Cards injected by JS  */}
            </div>
          </div>
        </div>
      </section>

    </main>
  </div>
  );
}
