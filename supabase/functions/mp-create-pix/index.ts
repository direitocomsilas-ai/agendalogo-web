// Cria cobrança PIX via Mercado Pago para o plano do profissional
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
    const { plan_id } = await req.json();
    if (!plan_id) return json({ error: 'plan_id obrigatório' }, 400);

    const sRes = await fetch(`${URL}/rest/v1/rpc/mp_get_settings`, {
      method: 'POST', headers: H, body: JSON.stringify({ p_secret: SECRET }),
    });
    if (!sRes.ok) return json({ error: 'Configuração de pagamento não encontrada' }, 500);
    const cfg = await sRes.json();
    if (!cfg.mp_enabled || !cfg.mp_access_token) {
      return json({ error: 'Mercado Pago não está ativo. Contate o administrador.' }, 400);
    }

    const cRes = await fetch(`${URL}/rest/v1/rpc/mp_create_charge`, {
      method: 'POST', headers: H, body: JSON.stringify({ p_secret: SECRET, p_plan_id: plan_id }),
    });
    if (!cRes.ok) return json({ error: 'Não foi possível criar a cobrança: ' + (await cRes.text()) }, 400);
    const charge = await cRes.json();

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.mp_access_token}`,
        'X-Idempotency-Key': charge.payment_id,
      },
      body: JSON.stringify({
        transaction_amount: Number(charge.amount),
        description: charge.description,
        payment_method_id: 'pix',
        external_reference: charge.payment_id,
        payer: { email: charge.payer_email, first_name: String(charge.payer_email).split('@')[0] },
      }),
    });
    const mp = await mpRes.json();
    if (!mpRes.ok || !mp.point_of_interaction?.transaction_data) {
      return json({ error: mp.message ?? 'Erro ao gerar PIX no Mercado Pago' }, 502);
    }
    const td = mp.point_of_interaction.transaction_data;
    const expires = mp.date_of_expiration ?? new Date(Date.now() + 3600e3).toISOString();
    await fetch(`${URL}/rest/v1/rpc/mp_set_pix`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        p_secret: SECRET, p_ref: charge.payment_id, p_mp_payment_id: String(mp.id),
        p_qr: td.qr_code ?? '', p_qr64: td.qr_code_base64 ?? '', p_expires: expires,
      }),
    });
    return json({ payment_id: charge.payment_id, amount: charge.amount, qr_code: td.qr_code, qr_code_base64: td.qr_code_base64, expires_at: expires });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
