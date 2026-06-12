const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Mapeo de tipos de documento a Google Docs IDs. 
// EL USUARIO DEBE REEMPLAZAR ESTOS IDs CON LOS SUYOS.
const DOC_IDS = {
  PROJECT_LOG: "1j91xQvzItOdzgdg36lKtWseYl4RFUT5H6623grtUZtU",
  CHANGELOG: "TU_GOOGLE_DOC_ID_PARA_CHANGELOG",
  DECISIONS: "TU_GOOGLE_DOC_ID_PARA_DECISIONS",
  BACKLOG: "TU_GOOGLE_DOC_ID_PARA_BACKLOG",
  IDEAS: "TU_GOOGLE_DOC_ID_PARA_IDEAS",
  TECH_DEBT: "TU_GOOGLE_DOC_ID_PARA_TECH_DEBT",
  ARCHITECTURE: "TU_GOOGLE_DOC_ID_PARA_ARCHITECTURE",
  ROADMAP: "TU_GOOGLE_DOC_ID_PARA_ROADMAP",
};

// URL del Webhook de n8n
// Puedes configurarlo como variable de entorno o reemplazarlo directamente aquí.
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "http://localhost:5678/webhook/tadashy-docs";

/**
 * Función principal para disparar el Webhook de documentación a n8n.
 * 
 * @param {string} docType - Uno de los tipos definidos en DOC_IDS.
 * @param {string} content - El contenido Markdown a añadir al documento.
 */
function sendDocumentation(docType, content) {
  const documentId = DOC_IDS[docType];

  if (!documentId || documentId.includes('TU_GOOGLE_DOC_ID')) {
    console.error(`[X] Error: No has configurado el ID de Google Docs para el tipo '${docType}'.`);
    console.error("Por favor abre scripts/doc_trigger.js y añade tus IDs.");
    process.exit(1);
  }

  if (N8N_WEBHOOK_URL.includes('TU_N8N_URL')) {
    console.error(`[X] Error: No has configurado la URL del Webhook de n8n.`);
    console.error("Por favor define la variable N8N_WEBHOOK_URL o edita scripts/doc_trigger.js");
    process.exit(1);
  }

  const payload = JSON.stringify({
    documentId: documentId,
    content: `\n\n---\n\n${content}` // Asegura separación visual en Google Docs
  });

  const urlObj = new URL(N8N_WEBHOOK_URL);
  const reqModule = urlObj.protocol === 'https:' ? https : http;

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port,
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = reqModule.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[✔] Documentación enviada exitosamente a ${docType} vía n8n.`);
      } else {
        console.error(`[X] Fallo al enviar a n8n. Status: ${res.statusCode}`);
        console.error(`Respuesta: ${data}`);
      }
    });
  });

  req.on('error', (e) => {
    console.error(`[X] Error conectando con n8n: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// Permitir ejecución desde terminal para nosotros los agentes (Antigravity IDE)
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Uso: node doc_trigger.js <TIPO_DOCUMENTO> <ARCHIVO_MARKDOWN_O_TEXTO>");
    console.log("Ejemplo: node doc_trigger.js PROJECT_LOG \"# Resumen del día...\"");
    process.exit(1);
  }

  const docType = args[0].toUpperCase();
  let content = args[1];

  // Si el segundo argumento es un archivo existente, leer el archivo
  if (fs.existsSync(content)) {
    content = fs.readFileSync(content, 'utf8');
  }

  sendDocumentation(docType, content);
}

module.exports = { sendDocumentation, DOC_IDS };
