// Rutas de reglas de automatización (Fase 3).
module.exports = function (deps) {
  const { readDb, requireAuth, getIotStore } = deps;
  const express = require('express');
  const router = express.Router();

  router.get('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    return res.status(200).json({ rules: getIotStore().listRules() });
  });

  router.post('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    try {
      const rule = getIotStore().upsertRule(req.body || {});
      return res.status(201).json({ rule });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  });

  router.patch('/:id', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const store = getIotStore();
    const existing = store.getRule(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Regla no encontrada' });
    // Atajo: solo habilitar/deshabilitar.
    if (typeof req.body.enabled === 'boolean' && Object.keys(req.body).length === 1) {
      return res.status(200).json({ rule: store.setRuleEnabled(req.params.id, req.body.enabled) });
    }
    try {
      const rule = store.upsertRule({ ...existing, ...req.body, id: req.params.id });
      return res.status(200).json({ rule });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    getIotStore().deleteRule(req.params.id);
    return res.status(200).json({ ok: true });
  });

  return router;
};
