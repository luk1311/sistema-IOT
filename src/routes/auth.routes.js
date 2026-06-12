module.exports = function(deps) {
  const { readDb, writeDb, verifyPassword, crypto, addHistory, publicUser } = deps;
  const express = require('express');
  const router = express.Router();

  router.post('/login', (req, res) => {
    const db = readDb();
    const body = req.body;
    const user = db.users.find((item) => item.username === body.username && item.active);
    if (!user || !body.password || !verifyPassword(body.password, user)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
    addHistory(db, user, 'auth', 'Inicio de sesión');
    writeDb(db);
    return res.status(200).json({ token, user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const db = readDb();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token && db.sessions[token]) {
      const session = db.sessions[token];
      const user = db.users.find((item) => item.id === session.userId);
      delete db.sessions[token];
      addHistory(db, user, 'auth', 'Cierre de sesión');
      writeDb(db);
    }
    return res.status(200).json({ ok: true });
  });

  return router;
};
