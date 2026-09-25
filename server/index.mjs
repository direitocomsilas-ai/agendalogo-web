// Agendez — servidor fullstack: serve o SPA e expõe a API do Mercado Pago.
// As credenciais do Mercado Pago NUNCA ficam no código-fonte: o navegador do
// administrador master as lê do banco (RPC master-only) e sincroniza com este
// servidor via POST autenticado. Elas vivem apenas na memória do processo.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://supabase-api-prod.verdent.ai/p/p8d37ef6e47f7b9f972a3';
const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTA0NDk3MjExLCJpYXQiOjE3ODg4NzgwMTEsImlzcyI6InN1cGFiYXNlIiwicHJvamVjdF9yZWYiOiJwOGQzN2VmNmU0N2Y3YjlmOTcyYTMiLCJyb2xlIjoiYW5vbiJ9.3aRtpdhB3YJT0fC0UlKirV3_jtrMT6BOe5wPL7StuIU';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Estado em memória (armado pelo master) ----------
let armed = null; // { mp_enabled, mp_environment, mp_access_token, mp_webhook_secret, rpc_secret, synced_at }

// Persiste o estado armado em disco para sobreviver a reinícios do processo
const ARMED_FILE = path.join(__dirname, '.armed.json');
try {
  const raw = fs.readFileSync(ARMED_FILE, 'utf8');
  const saved = JSON.parse(raw);
  if (saved?.rpc_secret) {
    armed = saved;
    console.log('Estado armado restaurado do disco.');
  }
} catch { /* primeira execução */ }

// Arme via usuário autenticado: QUALQUER usuário logado (profissional ou master)
// pode armar o servidor ao abrir o app. O segredo viaja apenas servidor <-> banco
// (com o JWT do usuário) e nunca retorna ao navegador.
async function selfArm(jwt) {
  if (armed?.rpc_secret) return true;
  try {
    const data = await restRpc('server_arm_get_for_user', {}, jwt);
    if (data?.rpc_secret) {
      armed = data;
      console.log('Estado armado via banco (usuário autenticado).');
      setTimeout(() => { restoreWaQr().catch(() => {}); }, 1000);
    }
  } catch (e) { console.error('selfArm:', e.message); }
  return !!armed?.rpc_secret;
}

// ---------- Helpers ----------
async function restRpc(name, paramsObj, jwt) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SB_ANON,
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(paramsObj),
  });
  if (!res.ok) throw Object.assign(new Error(`rpc ${name}: ${await res.text()}`), { status: 500 });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function requireUser(req) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('unauthorized'), { status: 401 });
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: auth },
  });
  if (!res.ok) throw Object.assign(new Error('unauthorized'), { status: 401 });
  const user = await res.json();
  if (!user?.id) throw Object.assign(new Error('unauthorized'), { status: 401 });
  return { ...user, jwt: auth.slice(7).trim() };
}

async function requireMaster(req) {
  const user = await requireUser(req);
  const isMaster = await restRpc('am_i_master', {}, user.jwt);
  if (!isMaster) throw Object.assign(new Error('forbidden'), { status: 403 });
  return user;
}

function mpReady() {
  return !!armed?.mp_enabled && !!armed?.mp_access_token;
}

const jsonErr = (res, e) => {
  const status = e?.status ?? 500;
  if (status >= 500) console.error(e);
  res.status(status).json({ error: String(e?.message ?? e) });
};

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// ---------- Sincronização (master) ----------
app.post('/api/mp/admin-sync', async (req, res) => {
  try {
    await requireMaster(req);
    const b = req.body ?? {};
    armed = {
      mp_enabled: !!b.mp_enabled,
      mp_environment: b.mp_environment ?? 'teste',
      mp_access_token: b.mp_access_token ?? null,
      mp_webhook_secret: b.mp_webhook_secret ?? null,
      rpc_secret: b.rpc_secret ?? null,
      synced_at: new Date().toISOString(),
    };
    console.log(`MP sync: enabled=${armed.mp_enabled} env=${armed.mp_environment} token=${armed.mp_access_token ? 'presente' : 'ausente'}`);
    try { fs.writeFileSync(ARMED_FILE, JSON.stringify(armed)); } catch { /* best effort */ }
    // Sessões QR podem ter ficado sem socket após um novo deploy — reconecta agora
    setTimeout(() => { restoreWaQr().catch(() => {}); }, 1000);
    res.json({ ok: true, armed: mpReady() });
  } catch (e) { jsonErr(res, e); }
});

app.get('/api/mp/armed', (_req, res) => {
  // rpc_armed: booleano NÃO sensível — o front usa para rearmar o servidor após um deploy
  res.json({ armed: mpReady(), environment: armed?.mp_environment ?? null, synced_at: armed?.synced_at ?? null, rpc_armed: !!armed?.rpc_secret, build: 'wa-call-4' });
});

// Arme por qualquer usuário autenticado (o segredo NÃO volta na resposta)
app.post('/api/arm', async (req, res) => {
  try {
    const user = await requireUser(req);
    const ok = await selfArm(user.jwt);
    res.json({ ok, rpc_armed: !!armed?.rpc_secret });
  } catch (e) { jsonErr(res, e); }
});

// ---------- Rotas de manutenção (master only) ----------
app.get('/api/maintenance/old-appointments', async (req, res) => {
  try {
    const user = await requireMaster(req);
    const days = Math.max(1, parseInt(req.query.days ?? '365', 10));
    const count = await restRpc('count_old_appointments', { p_days: days }, user.jwt);
    res.json({ days, count: Number(count ?? 0) });
  } catch (e) { jsonErr(res, e); }
});

app.post('/api/maintenance/old-appointments/delete', async (req, res) => {
  try {
    const user = await requireMaster(req);
    const days = Math.max(1, parseInt(req.body?.days ?? '365', 10));
    const deleted = await restRpc('delete_old_appointments', { p_days: days }, user.jwt);
    res.json({ days, deleted: Number(deleted ?? 0) });
  } catch (e) { jsonErr(res, e); }
});

// ---------- Rotas Mercado Pago ----------

// Cria cobrança PIX para o plano do profissional autenticado
app.post('/api/mp/create-pix', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!mpReady()) return res.status(503).json({ error: 'not_armed', message: 'Mercado Pago temporariamente indisponível. O administrador foi notificado.' });
    const { plan_id } = req.body ?? {};
    if (!plan_id) return res.status(400).json({ error: 'plan_id obrigatório' });

    const charge = await restRpc('mp_create_charge_u', { p_plan_id: plan_id }, user.jwt);

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${armed.mp_access_token}`,
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
    const mp = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok || !mp.point_of_interaction?.transaction_data) {
      return res.status(502).json({ error: mp.message ?? 'Erro ao gerar PIX no Mercado Pago' });
    }
    const td = mp.point_of_interaction.transaction_data;
    const expires = mp.date_of_expiration ?? new Date(Date.now() + 3600e3).toISOString();
    // Grava QR/ID no pagamento (RLS: o usuário só altera pagamentos da própria empresa)
    const patch = await fetch(`${SB_URL}/rest/v1/payments?id=eq.${charge.payment_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: `Bearer ${user.jwt}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ mp_payment_id: String(mp.id), qr_code: td.qr_code ?? '', qr_code_base64: td.qr_code_base64 ?? '', charge_expires_at: expires }),
    });
    if (!patch.ok) throw Object.assign(new Error('Falha ao registrar PIX: ' + (await patch.text())), { status: 500 });
    res.json({ payment_id: charge.payment_id, amount: charge.amount, qr_code: td.qr_code, qr_code_base64: td.qr_code_base64, expires_at: expires });
  } catch (e) { jsonErr(res, e); }
});

// Consulta o status local e, se pendente, pergunta ao Mercado Pago
app.post('/api/mp/check-status', async (req, res) => {
  try {
    const user = await requireUser(req);
    const { ref } = req.body ?? {};
    if (!ref) return res.status(400).json({ error: 'ref obrigatório' });
    const local = await restRpc('mp_check_payment_u', { p_ref: ref }, user.jwt);
    if (!local?.mp_payment_id || local.status !== 'pendente') return res.json(local);
    if (!mpReady()) return res.json(local);
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${local.mp_payment_id}`, {
      headers: { Authorization: `Bearer ${armed.mp_access_token}` },
    });
    if (!mpRes.ok) return res.json(local);
    const mp = await mpRes.json();
    if (mp.status === 'approved') {
      await restRpc('mp_confirm_payment', { p_secret: armed.rpc_secret, p_mp_payment_id: String(mp.id), p_status: mp.status, p_amount: mp.transaction_amount }, SB_ANON);
      return res.json({ ...local, status: 'aprovado', mp_status: mp.status });
    }
    res.json({ ...local, mp_status: mp.status });
  } catch (e) { jsonErr(res, e); }
});

// Testa as credenciais do Mercado Pago (apenas master)
app.post('/api/mp/test-connection', async (req, res) => {
  try {
    await requireMaster(req);
    if (!mpReady()) return res.json({ ok: false, error: 'Credenciais ainda não sincronizadas com o servidor. Salve e aguarde a sincronização.' });
    const meRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${armed.mp_access_token}` },
    });
    if (!meRes.ok) {
      const err = await meRes.json().catch(() => ({}));
      return res.json({ ok: false, error: err.message ?? `Mercado Pago respondeu ${meRes.status}` });
    }
    const me = await meRes.json();
    res.json({ ok: true, environment: armed.mp_environment, nickname: me.nickname, site_id: me.site_id, user_id: me.id, enabled: armed.mp_enabled });
  } catch (e) { jsonErr(res, e); }
});

// ---------- OAuth do profissional (Marketplace/Split) ----------

function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}`;
  }
  // O app público roda atrás de HTTPS; o proxy pode repassar proto http internamente.
  return `https://${host}`;
}

async function mpOAuthCreds() {
  if (!armed?.rpc_secret) return null;
  return await restRpc('mp_oauth_creds', { p_secret: armed.rpc_secret }, SB_ANON);
}

// Tokens do profissional (renova automaticamente se estiver perto de expirar)
async function profToken(ownerId) {
  const c = await restRpc('mp_connect_get', { p_secret: armed.rpc_secret, p_owner: ownerId }, SB_ANON);
  if (!c?.access_token) return null;
  if (new Date(c.expires_at).getTime() > Date.now() + 60e3) return c;
  const creds = await mpOAuthCreds();
  if (!creds?.client_id || !creds?.client_secret) return null;
  const tokRes = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: 'refresh_token', refresh_token: c.refresh_token }),
  });
  if (!tokRes.ok) return null;
  const tok = await tokRes.json();
  const expiresAt = new Date(Date.now() + (tok.expires_in ?? 21600) * 1e3).toISOString();
  await restRpc('mp_connect_save', { p_secret: armed.rpc_secret, p_owner: ownerId, p_mp_user_id: String(tok.user_id ?? c.mp_user_id), p_refresh: tok.refresh_token, p_access: tok.access_token, p_expires: expiresAt }, SB_ANON);
  return { mp_user_id: String(tok.user_id ?? c.mp_user_id), access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: expiresAt };
}

// Envia o profissional para autorizar a plataforma no Mercado Pago
app.get('/api/mp/connect', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!mpReady() || !armed.rpc_secret) return res.status(503).send('Mercado Pago ainda não configurado pelo administrador.');
    const creds = await mpOAuthCreds();
    if (!creds?.client_id || !creds?.client_secret) return res.status(503).send('Integração Marketplace ainda não configurada. O administrador precisa informar Client ID/Secret.');
    const exp = Date.now() + 10 * 60e3;
    const state = `${user.id}.${exp}.${hmacHex(armed.rpc_secret, `${user.id}.${exp}`)}`;
    const url = new URL('https://auth.mercadopago.com/authorization');
    url.searchParams.set('client_id', creds.client_id);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('scope', 'offline_access read write');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', `${originOf(req)}/api/mp/callback`);
    res.redirect(url.toString());
  } catch (e) { jsonErr(res, e); }
});

// Callback: troca o código pelos tokens e criptografa no banco
app.get('/api/mp/callback', async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const code = url.searchParams.get('code');
    const state = String(url.searchParams.get('state') ?? '');
    const [uid, exp, sig] = state.split('.');
    if (!code || !uid || !exp || !sig || Number(exp) < Date.now() || hmacHex(armed.rpc_secret, `${uid}.${exp}`) !== sig) {
      return res.status(400).send('Estado inválido ou expirado. Volte ao app e tente conectar novamente.');
    }
    const creds = await mpOAuthCreds();
    const tokRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: creds.client_id, client_secret: creds.client_secret, code, redirect_uri: `${originOf(req)}/api/mp/callback`, grant_type: 'authorization_code' }),
    });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token) {
      return res.status(502).send('Falha ao autorizar o Mercado Pago: ' + (tok.message ?? tokRes.status));
    }
    await restRpc('mp_connect_save', {
      p_secret: armed.rpc_secret, p_owner: uid, p_mp_user_id: String(tok.user_id ?? tok.public_user_id ?? ''),
      p_refresh: tok.refresh_token, p_access: tok.access_token,
      p_expires: new Date(Date.now() + (tok.expires_in ?? 21600) * 1e3).toISOString(),
    }, SB_ANON);
    res.redirect('/app/conta/integracoes?mp=ok');
  } catch (e) { jsonErr(res, e); }
});

// Desconecta o Mercado Pago do profissional
app.post('/api/mp/disconnect', async (req, res) => {
  try {
    const user = await requireUser(req);
    if (!armed?.rpc_secret) return res.status(503).json({ error: 'not_armed' });
    await restRpc('mp_connect_clear', { p_secret: armed.rpc_secret, p_owner: user.id }, SB_ANON);
    res.json({ ok: true });
  } catch (e) { jsonErr(res, e); }
});

// ---------- Sinal do agendamento (link público) ----------

let platformUidCache = null;
async function platformUserId() {
  if (platformUidCache) return platformUidCache;
  if (!mpReady()) return null;
  const me = await fetch('https://api.mercadopago.com/users/me', {
    headers: { Authorization: `Bearer ${armed.mp_access_token}` },
  });
  if (!me.ok) return null;
  platformUidCache = String((await me.json()).id);
  return platformUidCache;
}

// Cria a cobrança PIX do sinal (público — cliente final agendando)
app.post('/api/booking-pay', async (req, res) => {
  try {
    const { slug, appointment_id, client_name, client_whatsapp } = req.body ?? {};
    if (!slug || !appointment_id) return res.status(400).json({ error: 'dados inválidos' });
    if (!mpReady()) return res.status(503).json({ error: 'not_armed' });

    const cRes = await fetch(`${SB_URL}/rest/v1/companies?slug=eq.${encodeURIComponent(slug)}&public_enabled=eq.true&select=id,owner_id,name,deposit_enabled,deposit_amount`, { headers: { apikey: SB_ANON } });
    const companies = await cRes.json().catch(() => []);
    const company = Array.isArray(companies) ? companies[0] : null;
    if (!company) return res.status(404).json({ error: 'empresa não encontrada' });
    if (!company.deposit_enabled || !Number(company.deposit_amount)) return res.status(400).json({ error: 'no_deposit' });

    const prof = await profToken(company.owner_id);
    if (!prof?.mp_user_id) return res.status(400).json({ error: 'pro_not_connected' });

    const charge = await restRpc('bp_create', { p_secret: armed.rpc_secret, p_company: company.id, p_appointment: appointment_id, p_client_name: client_name ?? '', p_client_whatsapp: client_whatsapp ?? '' }, SB_ANON);
    if (charge?.status === 'aprovado') return res.json({ status: 'aprovado' });

    const sponsor = await platformUserId();
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${prof.access_token}`,
        'X-Idempotency-Key': charge.ref,
      },
      body: JSON.stringify({
        transaction_amount: Number(charge.amount),
        description: charge.description,
        payment_method_id: 'pix',
        external_reference: charge.ref,
        application_fee: Number(charge.fee),
        collector_id: Number(prof.mp_user_id),
        sponsor_id: sponsor ? Number(sponsor) : undefined,
        payer: { email: 'cliente@agendez.app', first_name: charge.client_name || 'Cliente' },
      }),
    });
    const mp = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok || !mp.point_of_interaction?.transaction_data) {
      return res.status(502).json({ error: mp.message ?? 'Erro ao gerar PIX no Mercado Pago' });
    }
    const td = mp.point_of_interaction.transaction_data;
    const expires = mp.date_of_expiration ?? new Date(Date.now() + 3600e3).toISOString();
    await restRpc('bp_set_pix', { p_secret: armed.rpc_secret, p_ref: charge.ref, p_mp_id: String(mp.id), p_qr: td.qr_code ?? '', p_qr64: td.qr_code_base64 ?? '', p_expires: expires }, SB_ANON);
    res.json({ ref: charge.ref, amount: charge.amount, status: 'pendente', qr_code: td.qr_code, qr_code_base64: td.qr_code_base64, expires_at: expires });
  } catch (e) { jsonErr(res, e); }
});

// Status do sinal (público — polling da tela de pagamento)
app.post('/api/booking-pay/status', async (req, res) => {
  try {
    const { ref } = req.body ?? {};
    if (!ref) return res.status(400).json({ error: 'ref obrigatório' });
    const local = await restRpc('bp_by_ref', { p_secret: armed.rpc_secret, p_ref: ref }, SB_ANON);
    if (!local) return res.status(404).json({ error: 'não encontrado' });
    if (local.status !== 'pendente' || !local.mp_payment_id) return res.json({ status: local.status });
    const prof = await profToken(local.owner_id);
    if (!prof) return res.json({ status: local.status });
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${local.mp_payment_id}`, {
      headers: { Authorization: `Bearer ${prof.access_token}` },
    });
    if (!mpRes.ok) return res.json({ status: local.status });
    const mp = await mpRes.json();
    if (['approved', 'cancelled', 'rejected', 'refunded'].includes(mp.status)) {
      const st = await restRpc('bp_confirm', { p_secret: armed.rpc_secret, p_mp_payment_id: String(mp.id), p_status: mp.status, p_amount: mp.transaction_amount }, SB_ANON);
      return res.json({ status: st });
    }
    res.json({ status: local.status, mp_status: mp.status });
  } catch (e) { jsonErr(res, e); }
});

// ---------- Webhook do Mercado Pago ----------
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const body = req.body ?? {};
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const type = body.type ?? body.topic ?? url.searchParams.get('topic');
    const dataId = String(body.data?.id ?? url.searchParams.get('data.id') ?? '');
    if (!dataId) return res.json({ received: true });
    if (!mpReady() || !armed.rpc_secret) return res.status(503).json({ error: 'not_armed' });

    // Validação de assinatura (HMAC) + proteção contra replay
    const sig = req.headers['x-signature'];
    if (armed.mp_webhook_secret && sig) {
      const parts = Object.fromEntries(String(sig).split(',').map((p) => p.trim().split('=')));
      const requestId = req.headers['x-request-id'] ?? '';
      const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
      if (hmacHex(armed.mp_webhook_secret, manifest) !== parts.v1) return res.status(401).json({ error: 'invalid signature' });
      if (Math.abs(Date.now() - Number(parts.ts) * 1000) > 300000) return res.status(401).json({ error: 'expired signature' });
    }

    const eventType = `${type}:${dataId}`;
    const fresh = await restRpc('mp_record_event', { p_secret: armed.rpc_secret, p_external_id: dataId, p_event_type: eventType, p_payload: body }, SB_ANON);
    if (!fresh) return res.json({ received: true, duplicate: true });

    if (type === 'payment') {
      // Sinal do agendamento: pagamento criado com o token do PROFISSIONAL
      // (split). Consultar antes do fluxo de assinatura (token da plataforma).
      const bp = await restRpc('bp_by_mp_id', { p_secret: armed.rpc_secret, p_mp_id: dataId }, SB_ANON).catch(() => null);
      if (bp?.owner_id) {
        const prof = await profToken(bp.owner_id);
        if (!prof) return res.json({ received: true, note: 'sinal: token do profissional indisponível' });
        const pr = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
          headers: { Authorization: `Bearer ${prof.access_token}` },
        });
        if (!pr.ok) return res.json({ received: true, mp_error: await pr.text() });
        const pay = await pr.json();
        if (['approved', 'cancelled', 'rejected', 'refunded'].includes(pay.status)) {
          const st = await restRpc('bp_confirm', { p_secret: armed.rpc_secret, p_mp_payment_id: String(pay.id), p_status: pay.status, p_amount: pay.transaction_amount }, SB_ANON);
          await restRpc('mp_mark_event_processed', { p_secret: armed.rpc_secret, p_external_id: dataId, p_event_type: eventType }, SB_ANON);
          return res.json({ received: true, sinal: st });
        }
        await restRpc('mp_mark_event_processed', { p_secret: armed.rpc_secret, p_external_id: dataId, p_event_type: eventType }, SB_ANON);
        return res.json({ received: true, sinal: pay.status });
      }
      // Assinatura da plataforma (token da plataforma)
      const pr = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { Authorization: `Bearer ${armed.mp_access_token}` },
      });
      if (!pr.ok) return res.json({ received: true, mp_error: await pr.text() });
      const pay = await pr.json();
      const result = await restRpc('mp_confirm_payment', { p_secret: armed.rpc_secret, p_mp_payment_id: String(pay.id), p_status: pay.status, p_amount: pay.transaction_amount }, SB_ANON);
      await restRpc('mp_mark_event_processed', { p_secret: armed.rpc_secret, p_external_id: dataId, p_event_type: eventType }, SB_ANON);
      return res.json({ received: true, result });
    }
    await restRpc('mp_mark_event_processed', { p_secret: armed.rpc_secret, p_external_id: dataId, p_event_type: eventType }, SB_ANON);
    res.json({ received: true });
  } catch (e) { jsonErr(res, e); }
});

// ---------- Cron de vencimento ----------
app.get('/api/cron/check-subscriptions', async (req, res) => {
  try {
    if (!armed?.rpc_secret || req.query.secret !== armed.rpc_secret) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await restRpc('process_subscriptions', {}, SB_ANON);
    // Libera comissões de embaixadores que saíram do prazo de segurança
    let released = 0;
    try {
      released = await restRpc('amb_release_due', { p_secret: armed.rpc_secret }, SB_ANON);
    } catch (e) { console.error('amb_release_due:', e.message); }
    res.json({ ok: true, ran_at: new Date().toISOString(), amb_commissions_released: Number(released ?? 0) });
  } catch (e) { jsonErr(res, e); }
});

// ---------- API pública (API Keys) ----------
app.get('/api/public-api/:path', async (req, res) => {
  try {
    const auth = req.headers.authorization ?? '';
    const key = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!key) return res.status(401).json({ error: 'unauthorized' });
    try {
      await restRpc('api_auth', { p_key: key }, SB_ANON);
    } catch (e) {
      if (String(e.message).includes('rate_limited')) return res.status(429).json({ error: 'rate limit: 60 req/min' });
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (req.params.path === 'status') return res.json({ ok: true, time: new Date().toISOString() });
    if (req.params.path === 'subscriptions') {
      const subs = await restRpc('api_list_subscriptions', {}, SB_ANON);
      return res.json({ ok: true, subscriptions: subs });
    }
    res.status(404).json({ error: 'not found', endpoints: ['/api/public-api/status', '/api/public-api/subscriptions'] });
  } catch (e) { jsonErr(res, e); }
});

// ---------- Central do WhatsApp (WhatsApp Cloud API oficial) ----------

import * as waQr from './wa-baileys.mjs';

// Hooks do modo QR: persistência da sessão no banco (criptografada)
waQr.bindWaHooks({
  saveCreds: (sessionId, data) =>
    armed?.rpc_secret
      ? restRpc('wa_save_qr_creds', { p_secret: armed.rpc_secret, p_session_id: sessionId, p_data: data }, SB_ANON)
      : Promise.resolve(),
  getCreds: (sessionId) =>
    armed?.rpc_secret
      ? restRpc('wa_get_qr_creds', { p_secret: armed.rpc_secret, p_session_id: sessionId }, SB_ANON)
      : Promise.resolve(null),
  setStatus: (sessionId, status, phone, error) => {
    if (!armed?.rpc_secret) return Promise.resolve();
    const p = restRpc('wa_set_qr_status', { p_secret: armed.rpc_secret, p_session_id: sessionId, p_status: status, p_phone: phone, p_error: error }, SB_ANON);
    // Ao (re)conectar, mensagens que falharam por "não conectado" voltam para a fila
    if (status === 'conectado') {
      waCompanyId(sessionId)
        .then((companyId) => companyId && restRpc('wa_requeue_disconnected', { p_secret: armed.rpc_secret, p_company_id: companyId }, SB_ANON))
        .catch(() => {});
    }
    return p;
  },
  callEvent: (sessionId, call) => {
    handleWaCall(sessionId, call).catch((e) => console.error('wa call:', e.message));
  },
  // Diagnóstico: registra TODO evento de chamada (offer/terminate/timeout) no log
  callDebug: (sessionId, call) => {
    if (!armed?.rpc_secret) return;
    waCompanyId(sessionId)
      .then((companyId) => {
        if (!companyId) return;
        const digits = String(call?.from ?? '').split('@')[0].replace(/\D/g, '');
        return restRpc('wa_call_log_insert', {
          p_secret: armed.rpc_secret, p_company_id: companyId, p_call_from: digits || 'desconhecido',
          p_kind: call?.isVideo ? 'video' : 'voz', p_declined: false, p_message_sent: false,
          p_note: `debug: status=${call?.status ?? 'sem-status'} offline=${call?.offline ?? '?'}`,
        }, SB_ANON);
      })
      .catch(() => {});
  },
});

// ---------- WhatsApp Call Blocker (recusa automática de chamadas) ----------
const callSettingsCache = new Map(); // company_id -> { s, at }
const sessionCompanyCache = new Map(); // session_id (wa_sessions.id) -> company_id
const planFeaturesCache = new Map(); // company_id -> { f, at }

// Recursos do plano atual da empresa (cache 5 min)
async function waPlanFeatures(companyId) {
  const hit = planFeaturesCache.get(companyId);
  if (hit && Date.now() - hit.at < 300_000) return hit.f;
  let f = {};
  try {
    f = (await restRpc('wa_company_features', { p_secret: armed.rpc_secret, p_company_id: companyId }, SB_ANON)) ?? {};
  } catch { /* sem plano → sem recursos */ }
  planFeaturesCache.set(companyId, { f, at: Date.now() });
  return f;
}

// O id da sessão QR é wa_sessions.id e NÃO o company_id — resolve (e cacheia) o dono.
async function waCompanyId(sessionId) {
  const hit = sessionCompanyCache.get(sessionId);
  if (hit) return hit;
  const cid = await restRpc('wa_qr_company_id', { p_secret: armed.rpc_secret, p_session_id: sessionId }, SB_ANON);
  if (cid) sessionCompanyCache.set(sessionId, cid);
  return cid;
}

async function waCallSettings(companyId) {
  const hit = callSettingsCache.get(companyId);
  if (hit && Date.now() - hit.at < 30_000) return hit.s;
  const s = await restRpc('wa_call_settings_get', { p_secret: armed.rpc_secret, p_company_id: companyId }, SB_ANON);
  callSettingsCache.set(companyId, { s, at: Date.now() });
  return s;
}

async function handleWaCall(sessionId, call) {
  if (!armed?.rpc_secret) return;
  const companyId = await waCompanyId(sessionId);
  if (!companyId) return;
  // Plano manda: sem o recurso 'call_blocker', nenhuma chamada é recusada
  const feats = await waPlanFeatures(companyId);
  if (feats.call_blocker !== true) return;
  const s = await waCallSettings(companyId);
  if (!s) return;
  const kind = call.isVideo ? 'video' : 'voz';
  const shouldBlock = call.isVideo ? s.block_video !== false : s.block_voice !== false;
  if (!shouldBlock) return;

  const digits = String(call.from ?? '').split('@')[0].replace(/\D/g, '');
  if (!digits) return;

  // Contatos autorizados: chamada não é recusada
  if (s.allow_enabled && Array.isArray(s.allowlist) && s.allowlist.length) {
    const allow = s.allowlist.map((n) => String(n ?? '').replace(/\D/g, '')).filter(Boolean);
    if (allow.some((n) => digits.endsWith(n) || n.endsWith(digits))) return;
  }

  let declined = false;
  let note = '';
  try {
    await waQr.waQrRejectCall(sessionId, call.callId, call.from);
    declined = true;
  } catch (e) {
    note = 'recusa falhou: ' + e.message;
  }

  // Mensagem automática (com janela anti-duplicação por contato)
  let msgSent = false;
  if (!declined) {
    note = (note ? note + '; ' : '') + 'mensagem não enviada: chamada não foi recusada';
  } else if (s.send_message === false) {
    note = (note ? note + '; ' : '') + 'mensagem não enviada: envio automático desativado';
  } else if (!s.auto_message || !String(s.auto_message).trim()) {
    note = (note ? note + '; ' : '') + 'mensagem não enviada: texto automático vazio';
  } else {
    const hours = Number.isFinite(+s.dedupe_hours) ? +s.dedupe_hours : 24;
    let recent = false;
    if (hours > 0) {
      try {
        recent = await restRpc('wa_call_recent_msg', { p_secret: armed.rpc_secret, p_company_id: companyId, p_call_from: digits, p_hours: hours }, SB_ANON) === true;
      } catch { recent = false; }
    }
    if (recent) {
      note = (note ? note + '; ' : '') + `mensagem não enviada: já enviada para este contato nas últimas ${hours}h`;
    } else {
      try {
        // Pequena pausa após recusar a chamada para o socket estabilizar
        await sleep(1200);
        const msgId = await waQr.waQrSend(sessionId, digits, s.auto_message);
        msgSent = !!msgId;
        if (!msgSent) note = (note ? note + '; ' : '') + 'mensagem retornou sem ID';
      } catch (e) {
        note = (note ? note + '; ' : '') + 'mensagem falhou: ' + e.message;
      }
    }
  }

  try {
    await restRpc('wa_call_log_insert', {
      p_secret: armed.rpc_secret, p_company_id: companyId, p_call_from: digits,
      p_kind: kind, p_declined: declined, p_message_sent: msgSent, p_note: note,
    }, SB_ANON);
  } catch (e) { console.error('wa call log:', e.message); }
}

// Restauração das sessões QR no boot (reconexão automática sem novo QR)
async function restoreWaQr() {
  if (!armed?.rpc_secret) return;
  try {
    const ids = await restRpc('wa_qr_list', { p_secret: armed.rpc_secret }, SB_ANON);
    if (Array.isArray(ids) && ids.length) {
      let restored = 0;
      for (const id of ids) {
        if (await waQr.waQrConnected(id)) continue;
        try { await waQr.waQrStart(id); restored++; } catch { /* segue */ }
      }
      if (restored) console.log(`WA QR: ${restored} sessão(ões) reconectada(s)`);
    }
  } catch (e) { console.error('wa restore:', e.message); }
}
setTimeout(() => { restoreWaQr().catch(() => {}); }, 3000);
// Conciliador: garante que sessões 'conectado' no banco tenham socket vivo
setInterval(() => { restoreWaQr().catch(() => {}); }, 60000);


// Normaliza o telefone para formato internacional (Brasil por padrão)
function waPhone(raw) {
  let p = String(raw ?? '').replace(/\D/g, '');
  if (!p) return '';
  while (p.startsWith('55') && p.length > 13) p = p.slice(2); // remove 55 duplicado
  if (p.startsWith('55')) return p;
  if (p.length >= 12) return p; // já contém DDI de outro país
  if (p.length === 10 || p.length === 11) return '55' + p; // BR: DDD + número
  return p;
}

// Envia uma mensagem pela Cloud API
async function waSend(phone_number_id, token, to, body) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waPhone(to),
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? `Graph API respondeu ${res.status}`;
    throw Object.assign(new Error(msg), { graph: data });
  }
  return data?.messages?.[0]?.id ?? null;
}

// Worker da fila: reclama mensagens vencidas, envia e reporta o resultado.
// Roda a cada 30s enquanto o servidor estiver ligado. Idempotente: o banco
// marca 'processando' antes do envio, e mensagens travadas são recuperadas.
async function waDispatch() {
  if (!armed?.rpc_secret) return;
  let msgs;
  try {
    msgs = await restRpc('wa_claim_due', { p_secret: armed.rpc_secret, p_limit: 30 }, SB_ANON);
  } catch (e) {
    console.error('wa_claim_due:', e.message);
    return;
  }
  if (!Array.isArray(msgs) || msgs.length === 0) return;
  console.log(`WA dispatch: ${msgs.length} mensagem(ns)`);
  await Promise.all(msgs.map(async (m) => {
    try {
      let providerId = null;
      if (m.provider === 'qr') {
        providerId = await waQr.waQrSend(m.session_id, m.phone, m.body);
      } else {
        if (!m.phone_number_id || !m.token) throw new Error('sessão sem credenciais');
        providerId = await waSend(m.phone_number_id, m.token, m.phone, m.body);
      }
      await restRpc('wa_report_result', { p_secret: armed.rpc_secret, p_id: m.id, p_ok: true, p_provider_id: providerId }, SB_ANON);
    } catch (e) {
      await restRpc('wa_report_result', { p_secret: armed.rpc_secret, p_id: m.id, p_ok: false, p_error: String(e.message ?? e) }, SB_ANON).catch(() => {});
    }
  }));
}
setInterval(() => { waDispatch().catch((e) => console.error('waDispatch:', e)); }, 30000);
setTimeout(() => { waDispatch().catch(() => {}); }, 8000);

// Envia uma mensagem de teste pelo próprio número conectado
app.post('/api/wa/test-send', async (req, res) => {
  try {
    const user = await requireUser(req);
    const { session_id } = req.body ?? {};
    if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });
    const rows = await fetch(`${SB_URL}/rest/v1/wa_sessions?select=id,provider,display_phone,phone_number_id,status&id=eq.${session_id}`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${user.jwt}` },
    }).then((r) => (r.ok ? r.json() : []));
    const s = rows?.[0];
    if (!s) return res.status(404).json({ error: 'Sessão não encontrada' });
    if (s.status !== 'conectado') return res.status(400).json({ error: 'WhatsApp desconectado' });
    const to = String(s.display_phone ?? '').replace(/\D/g, '');
    if (!to) return res.status(400).json({ error: 'Sessão sem número' });
    const body = '✅ Conexão com o Agenda Logo funcionando!\n\nAs mensagens automáticas (confirmação, lembretes 24h e 3h) serão enviadas por este número. 💚';
    if (s.provider === 'qr') {
      await waQr.waQrSend(s.id, to, body);
    } else {
      const token = await restRpc('wa_get_token', { p_secret: armed?.rpc_secret, p_session_id: s.id }, SB_ANON);
      if (!token || !s.phone_number_id) throw new Error('Sessão sem credenciais');
      await waSend(s.phone_number_id, token, to, body);
    }
    res.json({ ok: true });
  } catch (e) { jsonErr(res, e); }
});

// Testa as credenciais Cloud API do profissional (token nunca toca o front além do dono)
app.post('/api/wa/test-connection', async (req, res) => {
  try {
    await requireUser(req);
    const { phone_number_id, access_token } = req.body ?? {};
    if (!phone_number_id || !access_token) return res.status(400).json({ ok: false, error: 'Informe Phone Number ID e Access Token' });
    const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phone_number_id)}?fields=id,display_phone_number,verified_name,quality_rating`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) {
      return res.json({ ok: false, error: data?.error?.message ?? `Meta respondeu ${r.status}` });
    }
    res.json({ ok: true, id: data.id, display_phone_number: data.display_phone_number ?? '', verified_name: data.verified_name ?? '' });
  } catch (e) { jsonErr(res, e); }
});

// Salva a sessão conectada (token criptografado no banco, nunca é lido de volta)
app.post('/api/wa/save-session', async (req, res) => {
  try {
    const user = await requireUser(req);
    const { phone_number_id, waba_id, display_phone_number, verified_name, access_token, professional_id } = req.body ?? {};
    if (!phone_number_id || !access_token) return res.status(400).json({ error: 'Informe Phone Number ID e Access Token' });
    const sid = await restRpc('wa_save_session', {
      p_phone_number_id: phone_number_id,
      p_waba_id: waba_id ?? '',
      p_display_phone: display_phone_number ?? '',
      p_verified_name: verified_name ?? '',
      p_token: access_token,
      p_professional_id: professional_id ?? null,
    }, user.jwt);
    res.json({ ok: true, session_id: sid });
  } catch (e) { jsonErr(res, e); }
});

// Desconecta e apaga as credenciais da sessão
app.post('/api/wa/disconnect', async (req, res) => {
  try {
    const user = await requireUser(req);
    const { session_id } = req.body ?? {};
    if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });
    const rows = await fetch(`${SB_URL}/rest/v1/wa_sessions?select=provider&id=eq.${session_id}`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${user.jwt}` },
    }).then((r) => (r.ok ? r.json() : []));
    if (rows?.[0]?.provider === 'qr') {
      await waQr.waQrLogout(session_id);
    }
    await restRpc('wa_disconnect', { p_session_id: session_id }, user.jwt);
    res.json({ ok: true });
  } catch (e) { jsonErr(res, e); }
});

// ---- Modo simples: conexão via QR Code ----

// Inicia a sessão e gera o QR Code
app.post('/api/wa/qr/start', async (req, res) => {
  try {
    const user = await requireUser(req);
    const { professional_id } = req.body ?? {};
    const sid = await restRpc('wa_qr_start', { p_professional_id: professional_id ?? null }, user.jwt);
    const started = await waQr.waQrStart(sid);
    res.json({ ok: true, session_id: sid, status: started.status, phone: started.phone ?? null });
  } catch (e) { jsonErr(res, e); }
});

// Status da conexão (o front faz polling; QR vai junto enquanto estiver conectando)
app.get('/api/wa/qr/status', async (req, res) => {
  try {
    const user = await requireUser(req);
    const sessionId = String(req.query.session_id ?? '');
    if (!sessionId) return res.status(400).json({ error: 'session_id obrigatório' });
    const rows = await fetch(`${SB_URL}/rest/v1/wa_sessions?select=status,display_phone,professional_id&id=eq.${sessionId}`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${user.jwt}` },
    }).then((r) => (r.ok ? r.json() : []));
    if (!rows?.length) return res.status(404).json({ error: 'Sessão não encontrada' });
    const st = waQr.waQrStatus(sessionId);
    const dbStatus = rows[0].status;
    // Sem socket vivo (ex.: logo após um deploy): mostra 'conectando' enquanto o servidor
    // reconecta automaticamente, em vez de exibir 'conectado' do banco sem conexão real.
    let status;
    if (st.status === 'conectando' || st.status === 'conectado') status = st.status;
    else if (dbStatus === 'conectado') status = 'conectando';
    else status = dbStatus;
    if (status === 'conectado' && !st.phone && rows[0].display_phone) {
      return res.json({ ok: true, status: 'conectado', phone: rows[0].display_phone, qr: null });
    }
    let qrDataUrl = null;
    if (status === 'conectando' && st.qr) {
      qrDataUrl = await waQr.waQrDataUrl(st.qr);
    }
    res.json({ ok: true, status, phone: st.phone ?? rows[0].display_phone ?? null, qr: qrDataUrl, error: st.error });
  } catch (e) { jsonErr(res, e); }
});

// Força nova tentativa de conexão (reconectar)
app.post('/api/wa/qr/reconnect', async (req, res) => {
  try {
    const user = await requireUser(req);
    const { session_id } = req.body ?? {};
    if (!session_id) return res.status(400).json({ error: 'session_id obrigatório' });
    const rows = await fetch(`${SB_URL}/rest/v1/wa_sessions?select=id,provider&id=eq.${session_id}`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${user.jwt}` },
    }).then((r) => (r.ok ? r.json() : []));
    if (!rows?.length || rows[0].provider !== 'qr') return res.status(404).json({ error: 'Sessão não encontrada' });
    const started = await waQr.waQrStart(session_id);
    res.json({ ok: true, status: started.status });
  } catch (e) { jsonErr(res, e); }
});

// Webhook do Meta: verificação (GET) e status de entrega (POST)
app.get('/api/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && armed?.rpc_secret && token === armed.rpc_secret) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});
app.post('/api/webhooks/whatsapp', async (req, res) => {
  try {
    res.json({ received: true });
    const entry = req.body?.entry;
    if (!Array.isArray(entry)) return;
    for (const e of entry) {
      for (const ch of e.changes ?? []) {
        const statuses = ch.value?.statuses;
        if (!Array.isArray(statuses)) continue;
        for (const st of statuses) {
          if (st.status === 'failed') {
            await restRpc('wa_mark_provider_failed', { p_secret: armed?.rpc_secret, p_provider_id: st.id, p_error: st.errors?.[0]?.title ?? 'falha na entrega' }, SB_ANON).catch(() => {});
          }
        }
      }
    }
  } catch (e) { jsonErr(res, e); }
});

// ---------- GOOGLE CALENDAR ----------
// OAuth por empresa: o profissional conecta a própria conta Google e os
// agendamentos são espelhados no Google Agenda pelo worker (gcalSync).

async function gcalOauthCreds() {
  if (!armed?.rpc_secret) return null;
  return await restRpc('gcal_oauth_for_server', { p_secret: armed.rpc_secret }, SB_ANON);
}

function gcalRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${proto}://${host}/api/google/callback`;
}

// Inicia o fluxo OAuth: o navegador do profissional é redirecionado ao Google
app.get('/api/google/auth', async (req, res) => {
  try {
    const user = await requireUser(req);
    const creds = await gcalOauthCreds();
    if (!creds) return res.status(400).json({ error: 'Google Agenda não foi configurado pelo administrador ainda.' });
    const state = `${user.id}.${hmacHex(armed.rpc_secret, user.id)}`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', creds.client_id);
    url.searchParams.set('redirect_uri', gcalRedirectUri(req));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    res.json({ ok: true, url: url.toString() });
  } catch (e) { jsonErr(res, e); }
});

app.get('/api/google/callback', async (req, res) => {
  const front = (ok) => res.redirect(`/app/conta/integracoes?gcal=${ok ? 'ok' : 'erro'}`);
  try {
    const code = String(req.query.code ?? '');
    const [userId, sig] = String(req.query.state ?? '').split('.');
    if (!code || !userId || !armed?.rpc_secret || sig !== hmacHex(armed.rpc_secret, userId)) return front(false);
    const creds = await gcalOauthCreds();
    if (!creds) return front(false);

    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        redirect_uri: gcalRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token || !tok.refresh_token) {
      console.error('gcal callback token:', tok.error_description ?? tok.error ?? tokRes.status);
      return front(false);
    }
    const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const ui = await uiRes.json().catch(() => ({}));
    const email = ui.email ?? '';
    const expiresAt = new Date(Date.now() + (Number(tok.expires_in ?? 3600) - 60) * 1000).toISOString();
    await restRpc('gcal_save_tokens_svc', {
      p_secret: armed.rpc_secret, p_user_id: userId, p_email: email,
      p_access: tok.access_token, p_refresh: tok.refresh_token, p_expires_at: expiresAt,
    }, SB_ANON);
    front(true);
  } catch (e) {
    console.error('gcal callback:', e);
    front(false);
  }
});

app.post('/api/google/disconnect', async (req, res) => {
  try {
    const user = await requireUser(req);
    await restRpc('gcal_disconnect', {}, user.jwt);
    res.json({ ok: true });
  } catch (e) { jsonErr(res, e); }
});

// Força um ciclo de sincronização imediato
app.post('/api/google/sync-now', async (req, res) => {
  try {
    await requireUser(req);
    gcalSyncNow();
    res.json({ ok: true });
  } catch (e) { jsonErr(res, e); }
});

// Token de acesso sempre válido (renova com o refresh_token quando perto de expirar)
const gcalTokenCache = new Map(); // company_id -> { access, expiresAtMs }
async function gcalAccessToken(companyId) {
  const cached = gcalTokenCache.get(companyId);
  if (cached && cached.expiresAtMs > Date.now() + 60000) return cached.access;
  const creds = await restRpc('gcal_get_creds', { p_secret: armed.rpc_secret, p_company_id: companyId }, SB_ANON);
  if (!creds) return null;
  const expiresAtMs = new Date(creds.expires_at).getTime();
  if (expiresAtMs > Date.now() + 60000) {
    gcalTokenCache.set(companyId, { access: creds.access_token, expiresAtMs });
    return creds.access_token;
  }
  const oauth = await gcalOauthCreds();
  if (!oauth) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauth.client_id,
      client_secret: oauth.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) throw new Error(`renovação de token falhou: ${tok.error_description ?? tok.error ?? res.status}`);
  const newExp = Date.now() + (Number(tok.expires_in ?? 3600) - 60) * 1000;
  await restRpc('gcal_token_update', {
    p_secret: armed.rpc_secret, p_company_id: companyId,
    p_access: tok.access_token, p_expires_at: new Date(newExp).toISOString(),
  }, SB_ANON);
  gcalTokenCache.set(companyId, { access: tok.access_token, expiresAtMs: newExp });
  return tok.access_token;
}

function gcalEventBody(a) {
  const desc = [
    a.professional ? `Profissional: ${a.professional}` : null,
    a.notes ? `Observações: ${a.notes}` : null,
    a.price ? `Valor: R$ ${Number(a.price).toFixed(2).replace('.', ',')}` : null,
    'Agendado via Agenda Logo',
  ].filter(Boolean).join('\n');
  return {
    summary: `${a.service} — ${a.client}`,
    description: desc,
    start: { dateTime: new Date(a.starts_at).toISOString() },
    end: { dateTime: new Date(a.ends_at).toISOString() },
  };
}

async function gcalApi(token, calId, method, path, body) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 410 || (res.status === 404 && method === 'DELETE')) return { gone: true };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Google respondeu ${res.status}`);
  return data;
}

let gcalRunning = false;
async function gcalSync() {
  if (!armed?.rpc_secret || gcalRunning) return;
  gcalRunning = true;
  try {
    const due = await restRpc('gcal_claim_due', { p_secret: armed.rpc_secret, p_limit: 60 }, SB_ANON);
    if (!Array.isArray(due) || !due.length) return;
    const byCompany = new Map();
    for (const a of due) {
      if (!byCompany.has(a.company_id)) byCompany.set(a.company_id, []);
      byCompany.get(a.company_id).push(a);
    }
    for (const [companyId, appts] of byCompany) {
      let lastErr = '';
      let token = null;
      try { token = await gcalAccessToken(companyId); } catch (e) { lastErr = e.message; }
      if (!token) {
        await restRpc('gcal_account_ping', { p_secret: armed.rpc_secret, p_company_id: companyId, p_error: lastErr || 'sem credenciais' }, SB_ANON).catch(() => {});
        continue;
      }
      const creds = await restRpc('gcal_get_creds', { p_secret: armed.rpc_secret, p_company_id: companyId }, SB_ANON);
      const calId = creds?.calendar_id || 'primary';
      for (const a of appts) {
        try {
          if (a.op === 'delete') {
            await gcalApi(token, calId, 'DELETE', `/${a.event_id}`);
            await restRpc('gcal_report', { p_secret: armed.rpc_secret, p_id: a.id, p_ok: true }, SB_ANON);
          } else if (a.op === 'update') {
            await gcalApi(token, calId, 'PATCH', `/${a.event_id}`, gcalEventBody(a));
            await restRpc('gcal_report', { p_secret: armed.rpc_secret, p_id: a.id, p_ok: true, p_event_id: a.event_id }, SB_ANON);
          } else {
            const ev = await gcalApi(token, calId, 'POST', '', gcalEventBody(a));
            await restRpc('gcal_report', { p_secret: armed.rpc_secret, p_id: a.id, p_ok: true, p_event_id: ev.id }, SB_ANON);
          }
        } catch (e) {
          lastErr = e.message;
          await restRpc('gcal_report', { p_secret: armed.rpc_secret, p_id: a.id, p_ok: false }, SB_ANON).catch(() => {});
        }
      }
      await restRpc('gcal_account_ping', { p_secret: armed.rpc_secret, p_company_id: companyId, p_error: lastErr }, SB_ANON).catch(() => {});
    }
  } catch (e) {
    console.error('gcalSync:', e.message);
  } finally {
    gcalRunning = false;
  }
}
function gcalSyncNow() { gcalSync().catch((e) => console.error('gcalSync:', e)); }
setInterval(() => { gcalSyncNow(); }, 60000);
setTimeout(() => { gcalSyncNow(); }, 10000);

// ---------- Digital Asset Links (Android TWA / Apple AASA) ----------
// Publica server/assetlinks.json (Play Store) e server/apple-app-site-association
// (Apple) em /.well-known/. Basta criar o arquivo com o fingerprint de assinatura.
const wellKnown = (file) => (req, res) => {
  const p = path.join(__dirname, file);
  if (fs.existsSync(p)) return res.type('application/json').sendFile(p);
  res.status(404).json({ error: `${file} ainda não configurado` });
};
app.get('/.well-known/assetlinks.json', wellKnown('assetlinks.json'));
app.get('/.well-known/apple-app-site-association', wellKnown('apple-app-site-association.json'));

// ---------- SPA ----------
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile('index.html', { root: dist }, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Agendez server on :${PORT}`);
});
