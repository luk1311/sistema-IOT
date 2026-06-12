module.exports = function(deps) {
  const { readDb, writeDb, verifyPassword, crypto, addHistory, publicUser } = deps;
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const router = express.Router();

  router.post('/login', (req, res) => {
    const db = readDb();
    const body = req.body;
    const user = db.users.find((item) => item.username === body.username && item.active);
    if (!user || !body.password || !verifyPassword(body.password, user)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'tadashy_super_secret_key_12345!',
      { expiresIn: '30d' }
    );
    addHistory(db, user, 'auth', 'Inicio de sesión');
    writeDb(db);
    return res.status(200).json({ token, user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    // Con JWT, el servidor no necesita guardar estado de sesión.
    // El cliente simplemente debe descartar el token.
    return res.status(200).json({ ok: true, message: 'Cierre de sesión local en cliente' });
  });

  return router;
};
