module.exports = function(deps) {
  const { readDb, writeDb, requireAuth, addHistory, firestore } = deps;
  const express = require('express');
  const router = express.Router();

  router.get('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_history');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    return res.status(200).json({ history: db.history });
  });

  router.post('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db); // auth needed for history post? existing code: addHistory(db, auth.user, body.type...)
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const body = req.body;
    addHistory(db, allowed.user, body.type || 'event', body.detail || 'Evento sin detalle', body.metadata || {});
    writeDb(db);
    return res.status(201).json({ ok: true });
  });

  router.delete('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_history');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    db.history = [];
    firestore.collection('history').get().then(snap => {
      const batch = firestore.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).catch(console.error);
    writeDb(db);
    return res.status(200).json({ ok: true });
  });

  return router;
};
