// Webhook do Mercado Pago: valida assinatura, consulta o status real e ativa a assinatura
const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SECRET = Deno.env.get('RPC_SECRET')!;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const enc = new TextEncoder();

async function rpc(name: string, args: Record<string, unknown>, auth = `Bearer ${ANON}`) {
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: auth },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name}: ${await res.text()}`);
  return res.json();
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  try {
    const body = await req.json().catch(() => ({}));
    const type = body.type ?? body.topic ?? url.searchParams.get('topic');
    const dataId = String(body.data?.id ?? url.searchParams.get('data.id') ?? '');
    if (!dataId) return json({ received: true });

    const cfg = await rpc('mp_get_settings', { p_secret: SECRET });

    // Validação de assinatura do Mercado Pago + proteção contra replay
    const sig = req.headers.get('x-signature');
    if (cfg.mp_webhook_secret && sig) {
      const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
      const ts = parts.ts;
      const requestId = req.headers.get('x-request-id') ?? '';
      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected = await hmacHex(cfg.mp_webhook_secret, manifest);
      if (expected !== parts.v1) return json({ error: 'invalid signature' }, 401);
      if (Math.abs(Date.now() - Number(ts) * 1000) > 300000) return json({ error: 'expired signature' }, 401);
    }

    const eventType = `${type}:${dataId}`;
    const fresh = await rpc('mp_record_event', {
      p_secret: SECRET, p_external_id: dataId, p_event_type: eventType, p_payload: body,
    });
    if (!fresh) return json({ received: true, duplicate: true });

    if (type === 'payment') {
      const pr = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { Authorization: `Bearer ${cfg.mp_access_token}` },
      });
      if (!pr.ok) return json({ received: true, mp_error: await pr.text() });
      const pay = await pr.json();
      const result = await rpc('mp_confirm_payment', {
        p_secret: SECRET, p_mp_payment_id: String(pay.id), p_status: pay.status, p_amount: pay.transaction_amount,
      });
      await rpc('mp_mark_event_processed', { p_secret: SECRET, p_external_id: dataId, p_event_type: eventType });
      return json({ received: true, result });
    }

    await rpc('mp_mark_event_processed', { p_secret: SECRET, p_external_id: dataId, p_event_type: eventType });
    return json({ received: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
