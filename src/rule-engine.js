// Motor de reglas de automatización (Fase 3).
// Evalúa reglas trigger->acción ante telemetría nueva, con edge-detection
// (dispara solo en la transición falso->verdadero) y cooldown. Las acciones se
// ejecutan vía executeAction (inyectado por server.js, publica por MQTT).
const { readEntityValue } = require('./alert-engine');

function compare(op, a, b) {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '==': return a == b; // eslint-disable-line eqeqeq
    case '!=': return a != b; // eslint-disable-line eqeqeq
    default: return false;
  }
}

function createRuleEngine({ iotStore, executeAction, onFire } = {}) {
  const triggerState = new Map(); // ruleId -> último resultado booleano
  const lastFired = new Map();    // ruleId -> ts

  function evaluate(device, topic, payload) {
    if (!device) return;
    const rules = iotStore.listRules().filter(
      (r) => r.enabled && r.trigger && r.trigger.deviceId === device.deviceId
    );
    for (const rule of rules) {
      const entity = (device.entities || []).find((e) => e.id === rule.trigger.entityId);
      if (!entity) continue;
      const raw = readEntityValue(entity, payload);
      if (raw === undefined || raw === null) continue;

      // Comparación numérica si ambos lados son números; si no, comparación de texto.
      let a = raw, b = rule.trigger.value;
      const an = Number(raw), bn = Number(rule.trigger.value);
      if (Number.isFinite(an) && Number.isFinite(bn)) { a = an; b = bn; } else { a = String(raw); b = String(rule.trigger.value); }

      const nowResult = compare(rule.trigger.op, a, b);
      const prev = triggerState.get(rule.id) || false;
      triggerState.set(rule.id, nowResult);

      if (nowResult && !prev) {
        const cd = rule.cooldownMs || 0;
        if (cd && Date.now() - (lastFired.get(rule.id) || 0) < cd) continue;
        lastFired.set(rule.id, Date.now());
        runActions(rule);
      }
    }
  }

  function runActions(rule) {
    for (const action of rule.actions || []) {
      try { if (executeAction) executeAction(action, rule); } catch (e) { /* noop */ }
    }
    try { if (onFire) onFire(rule); } catch (e) { /* noop */ }
  }

  return { evaluate, runActions };
}

module.exports = { createRuleEngine, compare };
