// API pública para integrações externas: Authorization: Bearer API_KEY
// GET /public-api/status | GET /public-api/subscriptions
const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const key = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (!key) return json({ error: 'unauthorized' }, 401);

  const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };
  try {
    const authRes = await fetch(`${URL}/rest/v1/rpc/api_auth`, {
      method: 'POST', headers: H, body: JSON.stringify({ p_key: key }),
    });
    if (!authRes.ok) {
      const msg = await authRes.text();
      if (msg.includes('rate_limited')) return json({ error: 'rate limit: 60 req/min' }, 429);
      return json({ error: 'unauthorized' }, 401);
    }
    const keyInfo = await authRes.json();

    if (path === 'status') {
      return json({ ok: true, key: keyInfo.name, time: new Date().toISOString() });
    }
    if (path === 'subscriptions') {
      const res = await fetch(`${URL}/rest/v1/rpc/api_list_subscriptions`, { method: 'POST', headers: H, body: '{}' });
      if (!res.ok) return json({ error: await res.text() }, 500);
      return json({ ok: true, subscriptions: await res.json() });
    }
    return json({ error: 'not found', endpoints: ['/public-api/status', '/public-api/subscriptions'] }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
