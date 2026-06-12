const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server.js');
let content = fs.readFileSync(file, 'utf-8');

// 1. Add Express and CORS
if (!content.includes("require('express')")) {
  content = content.replace(
    "const http = require('http');",
    "const http = require('http');\nconst express = require('express');\nconst cors = require('cors');\nconst app = express();"
  );
}

// 2. Add Express Middlewares and update Helpers
const parseBodyRegex = /function parseBody\(req\) \{[\s\S]*?\}\n\}/;
content = content.replace(parseBodyRegex, `
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));

const authMiddleware = (scope) => (req, res, next) => {
  const db = readDb();
  const allowed = requireAuth(req, db, scope);
  if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
  req.user = allowed.user;
  req.db = db;
  next();
};

const rateLimitMiddleware = (limit, windowMs) => (req, res, next) => {
  if (!checkRateLimit(req, limit, windowMs)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes al servidor.' });
  }
  next();
};
`);

// update send helper
const sendRegex = /function send\(res, status, data\) \{[\s\S]*?\n\}/;
content = content.replace(sendRegex, `function send(res, status, data) {
  if (res.headersSent) return;
  res.status(status).json(data);
}`);


// 3. Extract routes from handleApi
// This is complex, we will just wrap handleApi to use Express for now, 
// OR we can replace the http.createServer block!
const createServerRegex = /const server = http\.createServer\(async \(req, res\) => \{[\s\S]*?\}\);/;
content = content.replace(createServerRegex, `
// Montar manejador heredado para no romper todo de golpe
app.all('/api/*', async (req, res, next) => {
  try {
    const url = new URL(req.url, \`http://\${req.headers.host}\`);
    await handleApi(req, res, url);
  } catch (err) {
    next(err);
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err);
  const status = err.status || 500;
  if (!res.headersSent) {
    res.status(status).json({ error: err.message || 'Error interno del servidor' });
  }
});

const server = http.createServer(app);
`);

// 4. In handleApi, remove parseBody and just use req.body
content = content.replace(/const body = await parseBody\(req\);/g, 'const body = req.body;');

fs.writeFileSync(file, content, 'utf-8');
console.log('Refactor script applied part 1!');
