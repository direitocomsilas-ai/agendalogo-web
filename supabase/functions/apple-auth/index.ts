// Login com Apple (iCloud): recebe o identity token emitido pela Apple
// (web via Apple JS SDK ou nativo via ASAuthorization), valida a assinatura
// contra o JWKS oficial da Apple, localiza/cria o usuário e devolve uma
// sessão Supabase (access_token + refresh_token) para o cliente.
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Audiences aceitas: bundle do app nativo iOS + Services ID da web (quando configurado).
const ALLOWED_AUDS = new Set<string>(['com.agendalogo.app']);
const webClientId = Deno.env.get('APPLE_WEB_CLIENT_ID');
if (webClientId) ALLOWED_AUDS.add(webClientId);

const ALLOWED_ORIGINS = new Set([
  'https://agendalogo.com',
  'https://www.agendalogo.com',
  'https://agendez-estetica-pobno0o.verdent.app',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function json(body: unknown, status = 200, origin?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type AppleKey = { kid: string; kty: string; n: string; e: string; alg?: string; use?: string };
let jwksCache: { keys: AppleKey[]; at: number } | null = null;

async function getAppleKeys(force = false): Promise<AppleKey[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch('https://appleid.apple.com/auth/keys');
  if (!res.ok) throw new Error('JWKS da Apple indisponível');
  const data = await res.json();
  jwksCache = { keys: data.keys ?? [], at: Date.now() };
  return jwksCache.keys;
}

async function verifyAppleToken(token: string): Promise<{ sub: string; email?: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('token malformado');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('algoritmo inválido');

  let jwk = (await getAppleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getAppleKeys(true)).find((k) => k.kid === header.kid); // rotacionou chave
  if (!jwk) throw new Error('chave da Apple não encontrada');

  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, alg: 'RS256', ext: true } as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sig = b64urlDecode(parts[2]);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!ok) throw new Error('assinatura inválida');

  if (payload.iss !== 'https://appleid.apple.com') throw new Error('emissor inválido');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new Error('token expirado');
  if (!ALLOWED_AUDS.has(payload.aud)) throw new Error('aplicação não autorizada');
  if (!payload.sub) throw new Error('usuário Apple ausente');
  return { sub: String(payload.sub), email: payload.email ? String(payload.email) : undefined };
}

async function authFetch(path: string, init: RequestInit, key: string): Promise<Response> {
  return fetch(`${SUPA_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
  });
}

// Localiza/cria o usuário pelo e-mail da Apple e troca por uma sessão real
// (magic link gerado no admin e verificado com a chave pública/anon).
async function getSessionForEmail(email: string, meta: Record<string, unknown>) {
  const create = await authFetch(
    '/auth/v1/admin/users',
    { method: 'POST', body: JSON.stringify({ email, email_confirm: true, user_metadata: meta }) },
    SERVICE,
  );
  if (!create.ok) {
    const t = await create.text();
    if (!/already|exist|registered|duplicate/i.test(t)) throw new Error(`createUser: ${t}`);
  }

  const link = await authFetch(
    '/auth/v1/admin/generate_link',
    { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) },
    SERVICE,
  );
  if (!link.ok) throw new Error(`generateLink: ${await link.text()}`);
  const data = await link.json();
  // Compatibilidade: versões do GoTrue devolvem os campos no nível superior
  // ou aninhados em `properties`.
  const props = data.properties ?? data;
  if (!props.action_link) throw new Error('magic link ausente');

  // Segue o magic link como se o usuário tivesse clicado (fluxo implícito):
  // o servidor responde 303 com os tokens da sessão no fragmento da URL.
  const r = await fetch(props.action_link, { redirect: 'manual', headers: { apikey: ANON } });
  const loc = r.headers.get('location') ?? '';
  const frag = loc.includes('#') ? loc.split('#')[1] : (loc.split('?')[1] ?? '');
  const params = new URLSearchParams(frag);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) throw new Error('sessão não retornada');
  return {
    access_token,
    refresh_token,
    token_type: params.get('token_type') ?? 'bearer',
    expires_in: Number(params.get('expires_in') ?? 0),
    expires_at: Number(params.get('expires_at') ?? 0),
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : ALLOWED_ORIGINS.values().next().value!,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      },
    });
  }
  if (req.method !== 'POST') return json({ error: 'método não suportado' }, 405, origin);

  try {
    const body = await req.json().catch(() => ({}));
    const idToken = String(body.idToken ?? body.id_token ?? '');
    if (!idToken) return json({ error: 'idToken obrigatório' }, 400, origin);

    let apple: { sub: string; email?: string };
    try {
      apple = await verifyAppleToken(idToken);
    } catch (e) {
      return json({ error: `Token Apple inválido: ${e instanceof Error ? e.message : e}` }, 401, origin);
    }

    const email = apple.email || `${apple.sub}@appleid.agendalogo.app`;
    const name = [body.firstName, body.lastName].filter(Boolean).join(' ') || body.name || '';
    const meta: Record<string, unknown> = { apple_sub: apple.sub, apple: true };
    if (name) meta.name = name;

    const session = await getSessionForEmail(email, meta);
    return json({ session }, 200, origin);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, origin);
  }
});
