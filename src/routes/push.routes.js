// Rutas de Web Push (Fase 2, Slice B).
module.exports = function (deps) {
  const { readDb, requireAuth, getIotStore, getPushService } = deps;
  const express = require('express');
  const router = express.Router();

  // Clave pública VAPID para que el cliente se suscriba.
  router.get('/vapid', (req, res) => {
    const push = getPushService();
    return res.status(200).json({ publicKey: push ? push.getPublicKey() : null, enabled: Boolean(push && push.enabled) });
  });

  // Guardar una suscripción del navegador.
  router.post('/subscribe', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });

    const sub = req.body && req.body.subscription ? req.body.subscription : req.body;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'Suscripción inválida' });
    }
    getIotStore().addPushSubscription(sub, allowed.user.id);
    return res.status(201).json({ ok: true });
  });

  // Eliminar una suscripción por endpoint.
  router.post('/unsubscribe', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'view_dashboard');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });

    const endpoint = req.body && req.body.endpoint;
    if (endpoint) getIotStore().removePushSubscription(endpoint);
    return res.status(200).json({ ok: true });
  });

  return router;
};
