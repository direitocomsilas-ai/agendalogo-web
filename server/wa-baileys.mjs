// Gerenciador de sessões WhatsApp via QR Code (modo simples).
// Usa a biblioteca Baileys (protocolo multi-dispositivo) com sessão
// persistida no banco (criptografada) — o profissional escaneia o QR
// uma única vez e o sistema reconecta sozinho após reinícios.

let B = null;
async function lib() {
  if (!B) B = await import('@whiskeysockets/baileys');
  return B;
}

// sessões ativas: id -> { sock, status, qr, phone, error, restoring, retries }
const sessions = new Map();

// hooks injetados pelo index.mjs (acesso ao banco via RPCs secret)
let hooks = { saveCreds: null, getCreds: null, setStatus: null };
export function bindWaHooks(h) { hooks = { ...hooks, ...h }; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Auth state em memória espelhado no banco (criptografado)
async function dbAuthState(sessionId) {
  const { initAuthCreds, BufferJSON } = await lib();
  let stored = null;
  try {
    const raw = await hooks.getCreds(sessionId);
    if (raw) stored = JSON.parse(raw, BufferJSON.reviver);
  } catch { stored = null; }
  let creds = stored?.creds ?? initAuthCreds();
  let keys = stored?.keys ?? {};

  let saveTimer = null;
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      hooks.saveCreds(sessionId, JSON.stringify({ creds, keys }, BufferJSON.replacer)).catch(() => {});
    }, 1500);
  };

  return {
    state: {
      creds,
      keys: {
        get(type, ids) {
          const k = keys[type];
          if (!k) return {};
          return Object.fromEntries(
            (ids ?? []).filter((id) => k[id]).map((id) => [id, k[id]]),
          );
        },
        set(data) {
          for (const type of Object.keys(data)) {
            keys[type] = keys[type] || {};
            Object.assign(keys[type], data[type]);
          }
          persist();
        },
      },
    },
    saveCreds: persist,
  };
}

export function waQrStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { status: 'desconectado', qr: null, phone: null, error: null };
  return { status: s.status, qr: s.qr, phone: s.phone, error: s.error };
}

export async function waQrConnected(sessionId) {
  const s = sessions.get(sessionId);
  return !!s && s.status === 'conectado';
}

async function clearCreds(sessionId) {
  try { await hooks.saveCreds(sessionId, null); } catch { /* noop */ }
}

async function startSocket(sessionId) {
  const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = await lib();
  const { state, saveCreds } = await dbAuthState(sessionId);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Agendez', 'Chrome', '120.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  const entry = { sock, status: 'conectando', qr: null, phone: null, error: null, retries: 0 };
  sessions.set(sessionId, entry);

  sock.ev.on('creds.update', saveCreds);
  // Chamadas recebidas (WhatsApp Call Blocker): repassa para o hook da empresa
  sock.ev.on('call', async (calls) => {
    try {
      for (const c of Array.isArray(calls) ? calls : []) {
        try { Promise.resolve(hooks.callDebug?.(sessionId, c)).catch(() => {}); } catch { /* noop */ }
        // processa apenas ofertas novas de chamada (não 'terminate'/'timeout')
        if (c.status && c.status !== 'offer') continue;
        if (!c.from || !c.id) continue;
        if (c.isGroup) continue;
        Promise.resolve(hooks.callEvent?.(sessionId, { callId: c.id, from: c.from, isVideo: !!c.isVideo }))
          .catch(() => {});
      }
    } catch { /* nunca travar a sessão */ }
  });
  sock.ev.on('connection.update', async (u) => {
    const e = sessions.get(sessionId);
    if (!e) return;

    if (u.qr) {
      e.qr = u.qr;
      e.status = 'conectando';
      e.error = null;
    }

    if (u.connection === 'open') {
      e.status = 'conectado';
      e.qr = null;
      e.error = null;
      e.retries = 0;
      const digits = String(sock.user?.id ?? '').split(':')[0].replace(/\D/g, '');
      e.phone = digits;
      await hooks.setStatus(sessionId, 'conectado', digits, '').catch(() => {});
    }

    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // logout real: limpa credenciais, precisa escanear de novo
        sessions.delete(sessionId);
        await clearCreds(sessionId);
        await hooks.setStatus(sessionId, 'desconectado', null, 'sessão encerrada no celular').catch(() => {});
        return;
      }
      // reconexão automática com backoff simples
      e.qr = null;
      e.status = 'conectando';
      e.retries = (e.retries ?? 0) + 1;
      const delay = Math.min(30_000, 2_000 * e.retries);
      if (e.retries <= 20) {
        await sleep(delay);
        if (sessions.get(sessionId) === e) {
          try { sock.end(undefined); } catch { /* noop */ }
          startSocket(sessionId).catch(() => {});
        }
      } else {
        e.status = 'desconectado';
        e.error = 'Não foi possível reconectar. Gere um novo QR Code.';
        await hooks.setStatus(sessionId, 'desconectado', null, e.error).catch(() => {});
      }
    }
  });

  return sock;
}

// Inicia (ou retoma) uma sessão para exibir o QR / reconectar
export async function waQrStart(sessionId) {
  const existing = sessions.get(sessionId);
  if (existing?.status === 'conectado') {
    return { status: 'conectado', phone: existing.phone };
  }
  if (existing?.sock) {
    try { existing.sock.end(undefined); } catch { /* noop */ }
  }
  await startSocket(sessionId);
  return { status: 'conectando' };
}

// Chamado no boot do servidor: reconecta sessões que estavam conectadas
export async function waQrRestoreAll(list) {
  for (const id of list) {
    try {
      await startSocket(id);
      await sleep(500);
    } catch { /* segue para a próxima */ }
  }
}

export async function waQrLogout(sessionId) {
  const e = sessions.get(sessionId);
  if (e?.sock) {
    try { await e.sock.logout(); } catch { try { e.sock.end(undefined); } catch { /* noop */ } }
  }
  sessions.delete(sessionId);
  await clearCreds(sessionId);
}

// Recusa uma chamada recebida (WhatsApp Call Blocker)
export async function waQrRejectCall(sessionId, callId, from) {
  const e = sessions.get(sessionId);
  if (!e || e.status !== 'conectado' || !e.sock) {
    throw new Error('WhatsApp desconectado');
  }
  await e.sock.rejectCall(callId, from);
}

// Envia texto; normaliza o número para formato internacional (Brasil por padrão)
function waJid(raw) {
  let p = String(raw ?? '').replace(/\D/g, '');
  if (!p) throw new Error('Número inválido');
  while (p.startsWith('55') && p.length > 13) p = p.slice(2); // remove 55 duplicado
  if (p.startsWith('55')) {
    // BR: móvel antigo sem o 9º dígito (55 + DDD + 8 dígitos começando com 9) → corrige
    const local = p.slice(2);
    if (local.length === 10 && local[2] === '9') p = '55' + local.slice(0, 2) + '9' + local.slice(2);
    return `${p}@s.whatsapp.net`;
  }
  if (p.length >= 12) return `${p}@s.whatsapp.net`; // já contém DDI de outro país
  if (p.length === 10 || p.length === 11) {
    // BR sem código do país
    if (p.length === 10 && p[2] === '9') p = p.slice(0, 2) + '9' + p.slice(2);
    p = '55' + p;
  }
  return `${p}@s.whatsapp.net`;
}

export async function waQrSend(sessionId, to, body) {
  const e = sessions.get(sessionId);
  if (!e || e.status !== 'conectado' || !e.sock) {
    throw new Error('WhatsApp desconectado');
  }
  const jid = waJid(to);
  // Valida se o número existe no WhatsApp antes de enviar (evita envio fantasma)
  let check;
  try {
    check = await e.sock.onWhatsApp(jid);
  } catch { check = null; }
  if (Array.isArray(check) && check.length > 0 && !check[0]?.exists) {
    throw new Error('Número ' + jid.split('@')[0] + ' não possui WhatsApp');
  }
  const target = check?.[0]?.jid ?? jid;
  const res = await e.sock.sendMessage(target, { text: body });
  return res?.key?.id ?? null;
}

// Converte o string QR para PNG (data URL) para exibir no navegador
export async function waQrDataUrl(qr) {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(qr, { margin: 1, width: 320 });
}
