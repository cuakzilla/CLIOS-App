// netlify/functions/sync.js
// Sincronizacion bidireccional de datos CLIOS con Supabase
// Variables requeridas: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  // Autenticar usuario
  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Token requerido' }) };

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
  });
  if (!userResp.ok) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No autorizado' }) };
  const { id: userId } = await userResp.json();

  // GET -- descargar estado del servidor
  if (event.httpMethod === 'GET') {
    const resp = await supabaseQuery(`/rest/v1/user_state?user_id=eq.${userId}&select=key,value,updated_at`);
    const rows = await resp.json();
    // Convertir array de filas a objeto key->value
    const state = {};
    for (const row of rows) {
      try { state[row.key] = JSON.parse(row.value); }
      catch { state[row.key] = row.value; }
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ state, syncedAt: Date.now() }) };
  }

  // POST -- subir operaciones pendientes
  if (event.httpMethod === 'POST') {
    const { operations } = JSON.parse(event.body);
    if (!Array.isArray(operations) || operations.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'operations[] requerido' }) };
    }
    if (operations.length > 100) {
      return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: 'Maximo 100 operaciones por batch' }) };
    }

    // Upsert batch en Supabase
    const rows = operations.map(op => ({
      user_id: userId,
      key: op.key,
      value: JSON.stringify(op.value ?? null),
      updated_at: new Date(op.timestamp || Date.now()).toISOString(),
    }));

    const resp = await supabaseQuery('/rest/v1/user_state', 'POST', rows, {
      'Prefer': 'resolution=merge-duplicates',
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('[CLIOS sync] Supabase error:', err);
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Error guardando en base de datos' }) };
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, synced: operations.length, at: Date.now() }) };
  }

  return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
};

async function supabaseQuery(path, method = 'GET', body = null, extraHeaders = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
