module.exports = function(deps) {
  const { readDb, writeDb, requireAuth, addHistory, firestore, crypto, runAutomationInBackend } = deps;
  const express = require('express');
  const router = express.Router();

  router.get('/', (req, res) => {
    const db = readDb();
    return res.status(200).json({ automations: db.automations });
  });

  router.post('/', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const body = req.body;
    if (!body.name || !Array.isArray(body.steps)) return res.status(400).json({ error: 'Automatización inválida' });
    const automation = {
      id: crypto.randomUUID(),
      name: body.name,
      steps: body.steps,
      createdAt: new Date().toISOString()
    };
    db.automations.unshift(automation);
    firestore.collection('automations').doc(automation.id).set(automation).catch(console.error);
    addHistory(db, allowed.user, 'automation', `Guardó automatización ${automation.name}`);
    writeDb(db);
    return res.status(201).json({ automation });
  });

  router.post('/:id/run', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'run_automations');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const automation = db.automations.find((item) => item.id === req.params.id);
    if (!automation) return res.status(404).json({ error: 'Automatización no encontrada' });
    
    // Background execution via Service
    runAutomationInBackend(automation);
    
    addHistory(db, allowed.user, 'automation_run', `Ejecutó automatización ${automation.name}`, { automationId: automation.id });
    writeDb(db);
    return res.status(200).json({ ok: true });
  });

  return router;
};
