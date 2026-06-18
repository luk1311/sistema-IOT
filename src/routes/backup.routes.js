// Backup / export-import de la configuración IoT (Fase 3).
module.exports = function (deps) {
  const { readDb, requireAuth, getIotStore } = deps;
  const express = require('express');
  const router = express.Router();

  router.get('/export', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_settings');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const store = getIotStore();
    return res.status(200).json({
      version: 1,
      exportedAt: new Date().toISOString(),
      devices: store.listDevices(),
      rules: store.listRules(),
      locations: store.listLocations(),
      groups: store.listGroups()
    });
  });

  router.post('/import', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'manage_settings');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const store = getIotStore();
    const data = req.body || {};
    const counts = { devices: 0, rules: 0, locations: 0, groups: 0 };
    const errors = [];

    for (const d of Array.isArray(data.devices) ? data.devices : []) {
      try { if (d && d.deviceId) { store.registerDevice(d.deviceId, d); counts.devices++; } }
      catch (e) { errors.push(`device ${d && d.deviceId}: ${e.message}`); }
    }
    for (const r of Array.isArray(data.rules) ? data.rules : []) {
      try { store.upsertRule(r); counts.rules++; }
      catch (e) { errors.push(`rule ${r && r.name}: ${e.message}`); }
    }
    for (const l of Array.isArray(data.locations) ? data.locations : []) {
      try { if (l && l.name) { store.upsertLocation(l.name, l); counts.locations++; } } catch (e) { errors.push(`location: ${e.message}`); }
    }
    for (const g of Array.isArray(data.groups) ? data.groups : []) {
      try { if (g && g.name) { store.upsertGroup(g.name, g); counts.groups++; } } catch (e) { errors.push(`group: ${e.message}`); }
    }

    return res.status(200).json({ ok: true, imported: counts, errors });
  });

  return router;
};
