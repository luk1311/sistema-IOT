// Servicio de Web Push (Fase 2, Slice B).
// Carga/genera claves VAPID y envía notificaciones de segundo plano a las
// suscripciones almacenadas. Si web-push no está instalado, queda como stub.
const fs = require('fs');
const path = require('path');

let webpush = null;
try { webpush = require('web-push'); } catch (e) { /* dependencia ausente */ }

const STUB = { enabled: false, getPublicKey: () => null, sendToAll: async () => {} };

function createPushService({ dataDir, contactEmail = 'mailto:admin@tadashy.local', getSubscriptions, removeSubscription } = {}) {
  if (!webpush) {
    console.warn('[Push] web-push no instalado; Web Push desactivado.');
    return STUB;
  }

  const vapidPath = path.join(dataDir, 'vapid.json');
  let vapid;
  try {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      // Producción (p. ej. Render con filesystem efímero): claves desde el entorno.
      vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    } else if (fs.existsSync(vapidPath)) {
      vapid = JSON.parse(fs.readFileSync(vapidPath, 'utf8'));
    } else {
      vapid = webpush.generateVAPIDKeys();
      try { fs.writeFileSync(vapidPath, JSON.stringify(vapid, null, 2)); } catch (e) { /* fs solo lectura */ }
      console.log('[Push] Claves VAPID generadas. Para que persistan en producción (Render),');
      console.log('[Push] define estas variables de entorno y redeploya:');
      console.log(`[Push]   VAPID_PUBLIC_KEY=${vapid.publicKey}`);
      console.log(`[Push]   VAPID_PRIVATE_KEY=${vapid.privateKey}`);
    }
    const subject = process.env.VAPID_SUBJECT || contactEmail;
    webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
  } catch (err) {
    console.warn('[Push] No se pudo inicializar VAPID:', err.message);
    return STUB;
  }

  async function sendToAll(payload) {
    const subs = (typeof getSubscriptions === 'function' ? getSubscriptions() : []) || [];
    if (!subs.length) return;
    const data = JSON.stringify(payload);
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, data);
      } catch (err) {
        // Suscripción caducada/inválida: purgar.
        if ((err.statusCode === 404 || err.statusCode === 410) && typeof removeSubscription === 'function') {
          removeSubscription(sub.endpoint);
        }
      }
    }));
  }

  return { enabled: true, getPublicKey: () => vapid.publicKey, sendToAll };
}

module.exports = { createPushService };
