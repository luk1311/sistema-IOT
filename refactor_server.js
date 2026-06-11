const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// 1. Add Firebase imports at the top
code = code.replace(
  "const crypto = require('crypto');",
  "const crypto = require('crypto');\nconst { initializeApp, cert } = require('firebase-admin/app');\nconst { getFirestore } = require('firebase-admin/firestore');\nconst serviceAccount = require('./firebase-key.json');\ninitializeApp({ credential: cert(serviceAccount) });\nconst firestore = getFirestore();"
);

// 2. Replace DB caching logic
const oldDbLogic = /let dbCache = null;[\s\S]*?function verifyPassword\(password, user\) {/m;
const newDbLogic = `let dbCache = { users: [], sessions: {}, history: [], automations: [], devices: [] };

async function loadDbFromFirebase() {
  console.log('[DB] Descargando datos desde Firebase Firestore...');
  const collections = ['users', 'history', 'automations', 'devices'];
  for (const coll of collections) {
    const snap = await firestore.collection(coll).get();
    dbCache[coll] = snap.docs.map(d => d.data());
  }
  
  // Si no hay admin, inyectar uno temporal en memoria para poder entrar
  if (!dbCache.users.some(u => u.role === 'super_admin' || u.role === 'admin')) {
    const adminPassword = hashPassword('admin123');
    const defaultAdmin = {
      id: crypto.randomUUID(),
      username: 'admin',
      passwordHash: adminPassword.hash,
      salt: adminPassword.salt,
      role: 'super_admin',
      active: true,
      createdAt: new Date().toISOString()
    };
    dbCache.users.push(defaultAdmin);
    firestore.collection('users').doc(defaultAdmin.id).set(defaultAdmin).catch(console.error);
    console.log('[DB] Se ha creado un usuario admin por defecto.');
  }
  console.log('[DB] Firebase sincronizado correctamente.');
}

function readDb() {
  return dbCache;
}

function writeDb(db, forceSync = false) {
  dbCache = db;
  // Local file write completely removed. Data persistence is handled via direct Firestore calls in the endpoints.
}

function verifyPassword(password, user) {`;

code = code.replace(oldDbLogic, newDbLogic);

// 3. Update addHistory
const oldAddHistory = /function addHistory\(db, user, type, detail, metadata = \{\}\) \{[\s\S]*?db\.history = db\.history\.slice\(0, 500\);\n\}/m;
const newAddHistory = `function addHistory(db, user, type, detail, metadata = {}) {
  const doc = {
    id: crypto.randomUUID(),
    type,
    detail,
    metadata,
    userId: user?.id || null,
    username: user?.username || 'sistema',
    createdAt: new Date().toISOString()
  };
  db.history.unshift(doc);
  db.history = db.history.slice(0, 500);
  // Async write to Firestore
  firestore.collection('history').doc(doc.id).set(doc).catch(err => console.error('[Firestore Error]', err));
}`;

code = code.replace(oldAddHistory, newAddHistory);

// 4. Find all API write handlers and inject Firestore calls

// a. POST /api/users
code = code.replace(
  /db\.users\.push\(newUser\);\n\s*writeDb\(db\);/g,
  "db.users.push(newUser);\n      firestore.collection('users').doc(newUser.id).set(newUser).catch(console.error);\n      writeDb(db);"
);

// b. PUT /api/users
code = code.replace(
  /db\.users\[index\] = \{ \.\.\.user, \.\.\.body \};\n\s*if \(body\.password\) \{[\s\S]*?\}\n\s*writeDb\(db\);/m,
  (match) => match.replace("writeDb(db);", "firestore.collection('users').doc(db.users[index].id).set(db.users[index]).catch(console.error);\n      writeDb(db);")
);

// c. DELETE /api/users
code = code.replace(
  /db\.users\.splice\(index, 1\);\n\s*addHistory[\s\S]*?writeDb\(db\);/m,
  (match) => match.replace("writeDb(db);", "firestore.collection('users').doc(id).delete().catch(console.error);\n      writeDb(db);")
);

// d. POST /api/automations
code = code.replace(
  /db\.automations\.push\(newAuto\);\n\s*addHistory[\s\S]*?writeDb\(db\);/m,
  (match) => match.replace("writeDb(db);", "firestore.collection('automations').doc(newAuto.id).set(newAuto).catch(console.error);\n      writeDb(db);")
);

// e. PUT /api/automations
code = code.replace(
  /db\.automations\[index\] = \{ \.\.\.auto, \.\.\.body, id, createdAt: auto\.createdAt \};\n\s*addHistory[\s\S]*?writeDb\(db\);/m,
  (match) => match.replace("writeDb(db);", "firestore.collection('automations').doc(id).set(db.automations[index]).catch(console.error);\n      writeDb(db);")
);

// f. DELETE /api/automations
code = code.replace(
  /db\.automations\.splice\(index, 1\);\n\s*addHistory[\s\S]*?writeDb\(db\);/m,
  (match) => match.replace("writeDb(db);", "firestore.collection('automations').doc(id).delete().catch(console.error);\n      writeDb(db);")
);

// g. DELETE /api/history (Limpiar)
code = code.replace(
  /db\.history = \[\];\n\s*addHistory\(db, user, 'system', 'Historial borrado manualmente'\);\n\s*writeDb\(db\);/m,
  `db.history = [];
    addHistory(db, user, 'system', 'Historial borrado manualmente');
    writeDb(db);
    // Borrado asíncrono masivo en Firestore
    firestore.collection('history').get().then(snap => {
      const batch = firestore.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).catch(console.error);`
);

// 5. Make server start await Firebase load
code = code.replace(
  /\(async function start\(\) \{/,
  `(async function start() {
  await loadDbFromFirebase();`
);

// 6. Remove the ensureDb call
code = code.replace("ensureDb();", "");

fs.writeFileSync('server.js', code);
console.log("Refactor applied successfully.");
