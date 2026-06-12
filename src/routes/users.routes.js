module.exports = function(deps) {
  const { readDb, writeDb, requireAuth, addHistory, firestore, crypto, hashPassword, publicUser, PERMISSIONS } = deps;
  const express = require('express');
  const router = express.Router();

  router.get('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    return res.status(200).json({ users: db.users.map(publicUser) });
  });

  router.post('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const body = req.body;
    if (!body.username || !body.password || !PERMISSIONS[body.role]) return res.status(400).json({ error: 'Datos de usuario inválidos' });
    if (db.users.some((item) => item.username === body.username)) return res.status(409).json({ error: 'El usuario ya existe' });
    const password = hashPassword(body.password);
    const user = {
      id: crypto.randomUUID(),
      username: body.username,
      passwordHash: password.hash,
      salt: password.salt,
      role: body.role,
      active: true,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    firestore.collection('users').doc(user.id).set(user).catch(console.error);
    addHistory(db, allowed.user, 'user', `Creó usuario ${user.username}`, { role: user.role });
    writeDb(db);
    return res.status(201).json({ user: publicUser(user) });
  });

  router.patch('/:id', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const body = req.body;
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (typeof body.active === 'boolean' && !body.active) {
      if (user.id === allowed.user.id) return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
      if (user.role === 'super_admin') {
        const activeSuperAdmins = db.users.filter((u) => u.role === 'super_admin' && u.active);
        if (activeSuperAdmins.length <= 1) return res.status(400).json({ error: 'No puedes desactivar al único Super Admin activo' });
      }
    }
    if (body.role && body.role !== 'super_admin' && user.role === 'super_admin' && user.active) {
      const activeSuperAdmins = db.users.filter((u) => u.role === 'super_admin' && u.active);
      if (activeSuperAdmins.length <= 1) return res.status(400).json({ error: 'No puedes cambiar el rol al único Super Admin activo' });
    }

    if (typeof body.active === 'boolean') user.active = body.active;
    if (body.role && PERMISSIONS[body.role]) user.role = body.role;
    firestore.collection('users').doc(user.id).update({ active: user.active, role: user.role }).catch(console.error);
    addHistory(db, allowed.user, 'user', `Actualizó usuario ${user.username}`);
    writeDb(db);
    return res.status(200).json({ user: publicUser(user) });
  });

  router.delete('/:id', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_users');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const userIndex = db.users.findIndex((item) => item.id === req.params.id);
    if (userIndex === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    const user = db.users[userIndex];
    if (user.id === allowed.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
    if (user.role === 'super_admin') {
      const activeSuperAdmins = db.users.filter((u) => u.role === 'super_admin' && u.active);
      if (activeSuperAdmins.length <= 1) return res.status(400).json({ error: 'No puedes eliminar al único Super Admin' });
    }
    
    db.users.splice(userIndex, 1);
    firestore.collection('users').doc(user.id).delete().catch(console.error);
    addHistory(db, allowed.user, 'user', `Eliminó usuario ${user.username}`);
    writeDb(db);
    return res.status(200).json({ ok: true });
  });

  return router;
};
