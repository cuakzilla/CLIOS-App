// netlify/functions/notify.js
// Envio de Web Push Notifications y gestion de suscripciones
// Variables requeridas: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
// Instalar: npm install web-push (en la raiz del proyecto)

// GENERAR VAPID KEYS (una sola vez):
// npx web-push generate-vapid-keys
// -> copiar PUBLIC y PRIVATE a Netlify env vars

const webpush = require('web-push');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'tu@email.com'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No autorizado' }) };

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
  });
  if (!userResp.ok) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Token invalido' }) };
  const { id: userId } = await userResp.json();

  try {
    const { action, subscription, notification } = JSON.parse(event.body);

    // Guardar suscripcion push del dispositivo
    if (action === 'subscribe') {
      if (!subscription?.endpoint) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Suscripcion invalida' }) };

      await supabaseUpsert('/rest/v1/push_subscriptions', {
        user_id: userId,
        endpoint: subscription.endpoint,
        subscription: JSON.stringify(subscription),
        updated_at: new Date().toISOString(),
      });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, message: 'Suscripcion guardada' }) };
    }

    // Eliminar suscripcion
    if (action === 'unsubscribe') {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    // Enviar notificacion a todos los dispositivos del usuario
    if (action === 'send') {
      if (!notification?.title) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'notification.title requerido' }) };

      const subsResp = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}&select=subscription`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const subs = await subsResp.json();

      const results = await Promise.allSettled(
        subs.map(row => {
          const sub = JSON.parse(row.subscription);
          return webpush.sendNotification(sub, JSON.stringify({
            title: notification.title,
            body: notification.body || '',
            icon: '/icon.png',
            badge: '/badge.png',
            tag: notification.tag || 'clios',
            data: { url: notification.url || '/' },
          }));
        })
      );

      const sent = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, sent, failed }) };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Accion desconocida' }) };

  } catch (err) {
    console.error('[CLIOS notify]', err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error interno' }) };
  }
};

async function supabaseUpsert(path, data) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data),
  });
}
