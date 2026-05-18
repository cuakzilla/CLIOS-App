// netlify/functions/chat.js
// Proxy seguro entre CLIOS y la API de Anthropic
// La API key nunca sale del servidor

exports.handler = async (event) => {

  // Solo POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS -- permite solo tu dominio en produccion
  const allowedOrigins = [
    process.env.ALLOWED_ORIGIN || '*',  // en produccion: 'https://tu-app.netlify.app'
  ];
  const origin = event.headers.origin || '';
  const corsOrigin = allowedOrigins.includes('*') ? '*' : (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Verificar API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'API key no configurada en el servidor' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Validar campos requeridos
    if (!body.messages || !Array.isArray(body.messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'messages requerido' }) };
    }

    // Rate limiting basico por IP (en produccion usar Redis o Upstash)
    // Por ahora limitamos el tamano del payload
    if (event.body.length > 50000) {
      return { statusCode: 413, headers, body: JSON.stringify({ error: 'Payload demasiado grande' }) };
    }

    // Llamada a Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: Math.min(body.max_tokens || 1000, 2000), // limite maximo
        system: body.system || '',
        messages: body.messages.slice(-12), // maximo 12 mensajes de contexto
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || 'Error de API' })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('[CLIOS Function] Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Error interno del servidor' })
    };
  }
};
