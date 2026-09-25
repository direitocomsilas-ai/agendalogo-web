// Testa as credenciais do Mercado Pago (chamado pelo painel Master)
const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SECRET = Deno.env.get('RPC_SECRET')!;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: auth };
  try {
    const sRes = await fetch(`${URL}/rest/v1/rpc/mp_get_settings`, {
      method: 'POST', headers: H, body: JSON.stringify({ p_secret: SECRET }),
    });
    if (!sRes.ok) return json({ ok: false, error: 'Configuração não encontrada' }, 500);
    const cfg = await sRes.json();
    if (!cfg.mp_access_token) return json({ ok: false, error: 'Access Token não configurado' });

    const meRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${cfg.mp_access_token}` },
    });
    if (!meRes.ok) {
      const err = await meRes.json().catch(() => ({}));
      return json({ ok: false, error: err.message ?? `Mercado Pago respondeu ${meRes.status}` });
    }
    const me = await meRes.json();
    return json({
      ok: true,
      environment: cfg.mp_environment,
      nickname: me.nickname,
      site_id: me.site_id,
      user_id: me.id,
      enabled: cfg.mp_enabled,
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
