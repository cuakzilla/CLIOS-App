// netlify/functions/auth.js
// Manejo de autenticacion con Supabase
// Variables requeridas: SUPABASE_URL, SUPABASE_SERVICE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { action, email, password } = JSON.parse(event.body);

    if (!['signup', 'login', 'logout', 'me'].includes(action)) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Accion invalida' }) };
    }

    // Verificar token existente para 'me' y 'logout'
    if (action === 'me' || action === 'logout') {
      const token = event.headers.authorization?.replace('Bearer ', '');
      if (!token) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Token requerido' }) };

      const userResp = await supabaseFetch('/auth/v1/user', 'GET', null, token);
      if (!userResp.ok) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Token invalido' }) };

      if (action === 'logout') {
        await supabaseFetch('/auth/v1/logout', 'POST', null, token);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
      }

      const user = await userResp.json();
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ user }) };
    }

    // Signup / Login
    if (!email || !password) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Email y contrasena requeridos' }) };
    if (password.length < 8)  return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Contrasena minimo 8 caracteres' }) };

    const endpoint = action === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password';
    const resp = await supabaseFetch(endpoint, 'POST', { email, password });
    const data = await resp.json();

    if (!resp.ok) {
      return { statusCode: resp.status, headers: corsHeaders, body: JSON.stringify({ error: data.msg || data.error_description || 'Error de autenticacion' }) };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
        expires_in: data.expires_in,
      })
    };

  } catch (err) {
    console.error('[CLIOS auth]', err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error interno' }) };
  }
};

async function supabaseFetch(path, method, body, token) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

