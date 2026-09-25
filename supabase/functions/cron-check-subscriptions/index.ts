// Rotina periódica de vencimento de assinaturas: GET /cron-check-subscriptions?secret=...
const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SECRET = Deno.env.get('RPC_SECRET')!;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== SECRET) return json({ error: 'forbidden' }, 403);
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/cron_run_subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ p_secret: SECRET }),
    });
    if (!res.ok) return json({ error: await res.text() }, 500);
    return json({ ok: true, ran_at: new Date().toISOString() });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
