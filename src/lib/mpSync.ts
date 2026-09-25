import { supabase } from './supabase';

// Sincroniza as credenciais do Mercado Pago (lidas do banco via RPC master-only)
// para a memória do servidor. Nada sensível fica no código-fonte.
export async function syncMpToServer(): Promise<boolean> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return false;
    const { data: full, error } = await supabase.rpc('mp_master_get_full');
    if (error || !full) return false;
    const r = await fetch('/api/mp/admin-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
      body: JSON.stringify(full),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Qualquer usuário logado (profissional ou master) arma o servidor: a fila do
// WhatsApp, o bloqueio de chamadas e o PIX precisam rodar após cada deploy,
// sem depender de o master estar online. O segredo nunca chega ao navegador.
export async function armServer(): Promise<boolean> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return false;
    const r = await fetch('/api/arm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
      body: '{}',
    });
    return r.ok;
  } catch {
    return false;
  }
}
