const fs = require('fs');
const path = require('path');

let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

// Extraer el div id="main"
const mainMatch = html.match(/<div id="main"[^>]*>([\s\S]*?)<\/div>\s*<!-- ROBOT CONTROL MODAL -->/);
if (!mainMatch) {
  console.log('No se encontro div#main');
  process.exit(1);
}

let mainContent = '<div id="main" className="app-layout" style={{ display: auth ? "flex" : "none" }}>' + mainMatch[1] + '</div>';

// Reemplazar class= por className=
mainContent = mainContent.replace(/class="/g, 'className="');
// Reemplazar for= por htmlFor=
mainContent = mainContent.replace(/for="/g, 'htmlFor="');
// Reemplazar <!-- --> por {/* */}
mainContent = mainContent.replace(/<!--(.*?)-->/g, '{/* $1 */}');
// Auto-cerrar tags
mainContent = mainContent.replace(/<input([^>]*[^\/])>/g, '<input$1 />');
mainContent = mainContent.replace(/<img([^>]*[^\/])>/g, '<img$1 />');
mainContent = mainContent.replace(/<hr([^>]*[^\/])>/g, '<hr$1 />');
mainContent = mainContent.replace(/<br([^>]*[^\/])>/g, '<br$1 />');

// Convertir inline styles (simplista, solo para los estilos que conocemos en el HTML)
// Usamos una regex mas robusta o simplemente limpiamos los manuales que sabemos:
const styleMap = {
  'display: none;': 'display: "none"',
  'padding: 4px; margin-right: 8px;': 'padding: "4px", marginRight: "8px"',
  'padding: 6px 10px;': 'padding: "6px 10px"',
  'display: flex; flex-direction: column; gap: 4px; padding: 0 16px;': 'display: "flex", flexDirection: "column", gap: "4px", padding: "0 16px"',
  'color: var(--accent-online);': 'color: "var(--accent-online)"',
  'font-size: 20px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;': 'fontSize: "20px", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px"',
  'color: var(--accent-ai);': 'color: "var(--accent-ai)"',
  'background: rgba(0,0,0,0.3); border-radius: var(--radius-md); padding: 16px; font-family: monospace; font-size: 13px; border: 1px solid var(--border-glass);': 'background: "rgba(0,0,0,0.3)", borderRadius: "var(--radius-md)", padding: "16px", fontFamily: "monospace", fontSize: "13px", border: "1px solid var(--border-glass)"',
  'margin-bottom: 12px; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 8px;': 'marginBottom: "12px", borderBottom: "1px dashed rgba(255,255,255,0.1)", paddingBottom: "8px"',
  'color: var(--text-muted);': 'color: "var(--text-muted)"',
  'margin-bottom: 8px;': 'marginBottom: "8px"',
  'margin-bottom: 24px;': 'marginBottom: "24px"',
  'display: flex; flex-direction: column; max-height: 400px;': 'display: "flex", flexDirection: "column", maxHeight: "400px"',
  'margin-bottom: 16px;': 'marginBottom: "16px"',
  'font-size: 16px; font-weight: 600;': 'fontSize: "16px", fontWeight: "600"',
  'padding: 4px 8px;': 'padding: "4px 8px"',
  'font-size: 16px;': 'fontSize: "16px"',
  'flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;': 'flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px"',
  'display: flex; flex-direction: column; height: 600px;': 'display: "flex", flexDirection: "column", height: "600px"',
  'padding: 16px 24px; border-bottom: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: rgba(0,0,0,0.2);': 'padding: "16px 24px", borderBottom: "1px solid var(--border-glass)", display: "flex", justifyContent: "spaceBetween", alignItems: "center", flexWrap: "wrap", gap: "12px", background: "rgba(0,0,0,0.2)"',
  'flex-wrap: wrap;': 'flexWrap: "wrap"',
  'font-size: 10px; color: var(--accent-online); letter-spacing: 0.1em; text-transform: uppercase;': 'fontSize: "10px", color: "var(--accent-online)", letterSpacing: "0.1em", textTransform: "uppercase"',
  'font-size: 11px; color: var(--text-muted);': 'fontSize: "11px", color: "var(--text-muted)"',
  'flex: 1; padding: 24px; overflow-y: auto;': 'flex: 1, padding: "24px", overflowY: "auto"',
  'padding: 16px 24px; border-top: 1px solid var(--border-glass); background: rgba(0,0,0,0.1);': 'padding: "16px 24px", borderTop: "1px solid var(--border-glass)", background: "rgba(0,0,0,0.1)"',
  'position: relative; display: flex; align-items: center;': 'position: "relative", display: "flex", alignItems: "center"',
  'padding-right: 48px; border-radius: var(--radius-md);': 'paddingRight: "48px", borderRadius: "var(--radius-md)"',
  'position: absolute; right: 16px; background: transparent; border: none; color: var(--accent-ai); cursor: pointer;': 'position: "absolute", right: "16px", background: "transparent", border: "none", color: "var(--accent-ai)", cursor: "pointer"',
  'font-size: 32px;': 'fontSize: "32px"',
  'font-size: 18px;': 'fontSize: "18px"',
  'font-size: 11px; color: var(--accent-online); text-transform: uppercase; font-weight: 600;': 'fontSize: "11px", color: "var(--accent-online)", textTransform: "uppercase", fontWeight: "600"',
  'font-size: 12px; color: var(--text-muted); margin-bottom: 8px;': 'fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px"',
  'font-family: monospace; font-size: 11px; color: var(--text-primary); margin-bottom: 24px; word-break: break-all;': 'fontFamily: "monospace", fontSize: "11px", color: "var(--text-primary)", marginBottom: "24px", wordBreak: "break-all"',
  'background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 12px; margin-bottom: 24px;': 'background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-glass)", borderRadius: "var(--radius-md)", padding: "12px", marginBottom: "24px"',
  'font-size: 12px; color: var(--text-muted); margin-bottom: 8px;': 'fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px"',
  'justify-content: space-between; margin-bottom: 4px;': 'justifyContent: "space-between", marginBottom: "4px"',
  'font-size: 13px;': 'fontSize: "13px"',
  'font-weight: 600; color: var(--accent-ai);': 'fontWeight: "600", color: "var(--accent-ai)"',
  'justify-content: space-between;': 'justifyContent: "space-between"',
  'font-weight: 600; color: var(--accent-online);': 'fontWeight: "600", color: "var(--accent-online)"',
  'font-size: 14px; color: var(--text-primary); margin-bottom: 12px; border-bottom: 1px solid var(--border-glass); padding-bottom: 8px;': 'fontSize: "14px", color: "var(--text-primary)", marginBottom: "12px", borderBottom: "1px solid var(--border-glass)", paddingBottom: "8px"',
  'display: flex; flex-direction: column; gap: 8px; max-height: 350px; overflow-y: auto;': 'display: "flex", flexDirection: "column", gap: "8px", maxHeight: "350px", overflowY: "auto"',
  'margin-bottom: 16px; font-size: 18px;': 'marginBottom: "16px", fontSize: "18px"',
  'flex: 1; justify-content: center;': 'flex: 1, justifyContent: "center"',
  'width: 100%; justify-content: center;': 'width: "100%", justifyContent: "center"',
  'padding: 16px; border-bottom: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;': 'padding: "16px", borderBottom: "1px solid var(--border-glass)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px"',
  'font-weight: 600;': 'fontWeight: "600"',
  'padding: 6px 12px; margin: 0; min-width: 150px; flex: 1;': 'padding: "6px 12px", margin: "0", minWidth: "150px", flex: 1',
  'padding: 6px 12px;': 'padding: "6px 12px"',
  'flex: 1; overflow-y: auto; padding: 16px; font-family: monospace; font-size: 12px; background: rgba(0,0,0,0.5);': 'flex: 1, overflowY: "auto", padding: "16px", fontFamily: "monospace", fontSize: "12px", background: "rgba(0,0,0,0.5)"',
  'height: 120px; resize: none;': 'height: "120px", resize: "none"',
  'display: flex; flex-direction: column;': 'display: "flex", flexDirection: "column"',
  'max-height: 600px; overflow-y: auto; padding: 16px;': 'maxHeight: "600px", overflowY: "auto", padding: "16px"',
  'appearance: none; color: var(--text-muted);': 'appearance: "none", color: "var(--text-muted)"',
  'padding: 24px; border-bottom: 1px solid var(--border-glass); background: rgba(0,0,0,0.3); position: relative;': 'padding: "24px", borderBottom: "1px solid var(--border-glass)", background: "rgba(0,0,0,0.3)", position: "relative"',
  'position: absolute; top: 16px; right: 16px; padding: 0; width: 36px; height: 36px; min-height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 10; background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass);': 'position: "absolute", top: "16px", right: "16px", padding: 0, width: "36px", height: "36px", minHeight: "36px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)"',
  'font-size: 20px;': 'fontSize: "20px"',
  'display: flex; flex-direction: column; gap: 16px; width: 100%;': 'display: "flex", flexDirection: "column", gap: "16px", width: "100%"',
  'font-size: 24px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; padding-right: 40px;': 'fontSize: "24px", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", paddingRight: "40px"',
  'color: var(--accent-ai); border-color: rgba(124, 106, 255, 0.5); border-style: solid; border-width: 1px;': 'color: "var(--accent-ai)", borderColor: "rgba(124, 106, 255, 0.5)", borderStyle: "solid", borderWidth: "1px"',
  'padding: 24px;': 'padding: "24px"'
};

for (const [htmlStyle, reactStyle] of Object.entries(styleMap)) {
  mainContent = mainContent.split(`style="${htmlStyle}"`).join(`style={{ ${reactStyle} }}`);
}

// Fallback manual regex para estilos restantes (muy simple)
mainContent = mainContent.replace(/style="([^"]*)"/g, (match, p1) => {
  const parts = p1.split(';').map(s => s.trim()).filter(Boolean);
  const reactStyles = parts.map(p => {
    let [key, val] = p.split(':').map(s => s.trim());
    key = key.replace(/-([a-z])/g, g => g[1].toUpperCase());
    return `${key}: "${val}"`;
  });
  return `style={{ ${reactStyles.join(', ')} }}`;
});

const appJsxContent = `import React, { useState } from 'react';
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
    ${mainContent}
  );
}
`;

fs.writeFileSync(path.join(__dirname, 'frontend/src/App.jsx'), appJsxContent);
console.log("Success");
