import { createClient } from 'npm:@supabase/supabase-js@2';

const PRODUCTION_ORIGIN = 'https://abv-global.github.io';

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin') || '';
  if (origin === PRODUCTION_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return PRODUCTION_ORIGIN;
}

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const origin = request.headers.get('origin') || '';
    if (origin !== PRODUCTION_ORIGIN && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers });
    }

    const { action = 'register', subscription, endpoint: requestedEndpoint, language = 'es' } = await request.json();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    if (action === 'unregister') {
      if (typeof requestedEndpoint !== 'string' || !requestedEndpoint.startsWith('https://')) {
        return new Response(JSON.stringify({ error: 'Invalid endpoint' }), { status: 400, headers });
      }
      const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', requestedEndpoint);
      if (error) throw error;
      return new Response(JSON.stringify({ registered: false }), { status: 200, headers });
    }
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid subscription' }), { status: 400, headers });
    }

    const safeLanguage = ['es', 'en', 'pt-BR'].includes(language) ? language : 'es';
    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint,
      p256dh,
      auth,
      language: safeLanguage,
      user_agent: (request.headers.get('user-agent') || '').slice(0, 500),
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error) throw error;

    return new Response(JSON.stringify({ registered: true }), { status: 200, headers });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Unable to register subscription' }), { status: 500, headers });
  }
});
