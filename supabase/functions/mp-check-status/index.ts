// Consulta o status real de um pagamento PIX no Mercado Pago (fallback do polling do front)
const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SECRET = Deno.env.get('RPC_SECRET')!;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: auth };
  try {
    const { ref } = await req.json();
    if (!ref) return json({ error: 'ref obrigatório' }, 400);
    const sRes = await fetch(`${URL}/rest/v1/rpc/mp_get_settings`, {
      method: 'POST', headers: H, body: JSON.stringify({ p_secret: SECRET }),
    });
    if (!sRes.ok) return json({ error: 'Configuração não encontrada' }, 500);
    const cfg = await sRes.json();

    const pRes = await fetch(`${URL}/rest/v1/rpc/mp_check_payment`, {
      method: 'POST', headers: H, body: JSON.stringify({ p_secret: SECRET, p_ref: ref }),
    });
    if (!pRes.ok) return json({ error: 'Pagamento não encontrado' }, 404);
    const pay = await pRes.json();

    if (!pay.mp_payment_id) return json({ status: pay.status, mp_status: null });
    if (pay.status !== 'pendente' || !cfg.mp_access_token) return json({ status: pay.status, mp_status: null });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${pay.mp_payment_id}`, {
      headers: { Authorization: `Bearer ${cfg.mp_access_token}` },
    });
    if (!mpRes.ok) return json({ status: pay.status, mp_status: null });
    const mp = await mpRes.json();
    if (mp.status === 'approved') {
      await fetch(`${URL}/rest/v1/rpc/mp_confirm_payment`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ p_secret: SECRET, p_mp_payment_id: String(mp.id), p_status: mp.status, p_amount: mp.transaction_amount }),
      });
      return json({ status: 'aprovado', mp_status: mp.status });
    }
    return json({ status: pay.status, mp_status: mp.status });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
