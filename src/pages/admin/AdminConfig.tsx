import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Textarea, cx } from '../../components/ui';
import { syncMpToServer } from '../../lib/mpSync';

type Settings = { trial_days: number; trial_until: string | null; tolerance_days: number; master_email: string | null; logo_url: string | null };
type MpForm = {
  mp_enabled: boolean;
  mp_environment: string;
  mp_access_token: string;
  mp_public_key: string;
  mp_client_id: string;
  mp_client_secret: string;
  mp_webhook_secret: string;
  webhook_url: string;
};
type ApiKeyRow = { id: string; name: string; key_prefix: string; enabled: boolean; created_at: string; revoked_at: string | null; last_used_at: string | null };

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const WEBHOOK_HINT = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/mercadopago` : '/api/webhooks/mercadopago';

const emptyMp: MpForm = { mp_enabled: false, mp_environment: 'teste', mp_access_token: '', mp_public_key: '', mp_client_id: '', mp_client_secret: '', mp_webhook_secret: '', webhook_url: WEBHOOK_HINT };

export default function AdminConfig() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'geral' | 'pagamentos' | 'gcal' | 'api'>('geral');
  const [form, setForm] = useState<Settings>({ trial_days: 7, trial_until: null, tolerance_days: 3, master_email: '', logo_url: null });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Mercado Pago
  const [mp, setMp] = useState<MpForm>(emptyMp);
  const [mpLoaded, setMpLoaded] = useState(false);
  const [mpSaving, setMpSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [serverArmed, setServerArmed] = useState<boolean | null>(null);

  // API keys
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);

  // Google Agenda (OAuth)
  const [gcalClientId, setGcalClientId] = useState('');
  const [gcalClientSecret, setGcalClientSecret] = useState('');
  const [gcalStatus, setGcalStatus] = useState<{ configured: boolean; client_id_masked?: string } | null>(null);
  const [gcalSaving, setGcalSaving] = useState(false);
  const GCAL_REDIRECT = typeof window !== 'undefined' ? `${window.location.origin}/api/google/callback` : '/api/google/callback';

  // Termos de uso
  const [termsText, setTermsText] = useState<string>('');
  const [termsSaving, setTermsSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single();
    if (data) {
      setForm({ trial_days: data.trial_days, trial_until: data.trial_until ?? null, tolerance_days: data.tolerance_days, master_email: data.master_email ?? '', logo_url: data.logo_url ?? null });
      setTermsText(data.terms_content ?? '');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadMp = useCallback(async () => {
    const { data, error } = await supabase.rpc('mp_master_get');
    if (error) { toast('error', 'Erro ao carregar Mercado Pago: ' + error.message); return; }
    setMp({
      mp_enabled: data.mp_enabled ?? false,
      mp_environment: data.mp_environment ?? 'teste',
      mp_access_token: '',
      mp_public_key: data.mp_public_key ?? '',
      mp_client_id: '',
      mp_client_secret: '',
      mp_webhook_secret: '',
      webhook_url: data.webhook_url ?? WEBHOOK_HINT,
    });
    setMpLoaded(true);
    await syncMpToServer();
    const r = await fetch('/api/mp/armed').catch(() => null);
    const a = r && r.ok ? await r.json().catch(() => null) : null;
    setServerArmed(!!a?.armed);
  }, [toast]);
  useEffect(() => { if (tab === 'pagamentos') loadMp(); }, [tab, loadMp]);

  const loadKeys = useCallback(async () => {
    const { data } = await supabase.from('api_keys').select('id, name, key_prefix, enabled, created_at, revoked_at, last_used_at').order('created_at', { ascending: false });
    setKeys((data ?? []) as ApiKeyRow[]);
  }, []);
  useEffect(() => { if (tab === 'api') loadKeys(); }, [tab, loadKeys]);

  const loadGcal = useCallback(async () => {
    const { data, error } = await supabase.rpc('gcal_oauth_masked');
    if (error) { toast('error', 'Erro ao carregar Google Agenda: ' + error.message); return; }
    setGcalStatus(data ?? { configured: false });
  }, [toast]);
  useEffect(() => { if (tab === 'gcal') loadGcal(); }, [tab, loadGcal]);

  const saveGcal = async () => {
    if (!gcalClientId.trim() || !gcalClientSecret.trim()) {
      toast('error', 'Informe o Client ID e o Client Secret do Google.');
      return;
    }
    setGcalSaving(true);
    const { error } = await supabase.rpc('gcal_oauth_save', {
      p_client_id: gcalClientId.trim(),
      p_client_secret: gcalClientSecret.trim(),
    });
    setGcalSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else {
      toast('success', 'Google Agenda configurado!');
      setGcalClientId('');
      setGcalClientSecret('');
      loadGcal();
    }
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('app_settings').update({ ...form, trial_until: form.trial_until || null }).eq('id', 1);
    setSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else toast('success', 'Configurações salvas!');
  };

  const saveTerms = async (clear = false) => {
    setTermsSaving(true);
    const { error } = await supabase.from('app_settings').update({ terms_content: clear ? null : (termsText.trim() || null) }).eq('id', 1);
    setTermsSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else {
      if (clear) setTermsText('');
      toast('success', clear ? 'Termo de uso restaurado ao padrão!' : 'Termo de uso salvo!');
    }
  };

  const saveMp = async () => {
    setMpSaving(true);
    const { error } = await supabase.rpc('mp_master_save', {
      p_data: {
        mp_enabled: mp.mp_enabled,
        mp_environment: mp.mp_environment,
        mp_access_token: mp.mp_access_token || null,
        mp_public_key: mp.mp_public_key || null,
        mp_client_id: mp.mp_client_id || null,
        mp_client_secret: mp.mp_client_secret || null,
        mp_webhook_secret: mp.mp_webhook_secret || null,
        webhook_url: mp.webhook_url || null,
      },
    });
    setMpSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else {
      toast('success', 'Mercado Pago configurado!');
      setMp((f) => ({ ...f, mp_access_token: '', mp_client_secret: '', mp_webhook_secret: '' }));
      const ok = await syncMpToServer();
      setServerArmed(ok);
      loadMp();
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const r = await fetch('/api/mp/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session?.access_token ?? ''}` },
        body: '{}',
      });
      const data = await r.json().catch(() => null);
      setTesting(false);
      if (!data) { setTestResult({ ok: false, msg: `Servidor respondeu ${r.status}` }); return; }
      setTestResult(data.ok
        ? { ok: true, msg: `Conectado! Conta: ${data.nickname ?? data.user_id} (${data.site_id ?? '-'} · ${data.environment})` }
        : { ok: false, msg: data.error ?? 'Credenciais inválidas' });
    } catch {
      setTesting(false);
      setTestResult({ ok: false, msg: 'Não foi possível falar com o servidor.' });
    }
  };

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast('error', 'Escolha um arquivo de imagem.'); return; }
    if (file.size > MAX_LOGO_BYTES) { toast('error', 'Imagem muito grande. O limite é 2 MB.'); return; }
    setUploading(true);
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'png';
    const path = `admin/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('media').upload(path, file, { contentType: file.type });
    if (upErr) { setUploading(false); toast('error', 'Erro no upload: ' + upErr.message); return; }
    const { data: pub } = supabase.storage.from('media').getPublicUrl(path);
    const { error: dbErr } = await supabase.from('app_settings').update({ logo_url: pub.publicUrl }).eq('id', 1);
    setUploading(false);
    if (dbErr) { toast('error', 'Logo enviada, mas não foi possível salvar: ' + dbErr.message); return; }
    setForm((f) => ({ ...f, logo_url: pub.publicUrl }));
    toast('success', 'Logo atualizada!');
  };

  const removeLogo = async () => {
    setSaving(true);
    const { error } = await supabase.from('app_settings').update({ logo_url: null }).eq('id', 1);
    setSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else { setForm((f) => ({ ...f, logo_url: null })); toast('success', 'Logo removida.'); }
  };

  const generateKey = async () => {
    const name = newKeyName.trim() || 'Integração externa';
    const raw = 'ak_' + Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await supabase.from('api_keys').insert({ name, key_hash: hash, key_prefix: raw.slice(0, 10) });
    if (error) { toast('error', 'Erro: ' + error.message); return; }
    setFreshKey(raw);
    setNewKeyName('');
    loadKeys();
    toast('success', 'API Key gerada! Copie agora — ela não será exibida novamente.');
  };

  const revokeKey = async (id: string) => {
    const { error } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString(), enabled: false }).eq('id', id);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'API Key revogada.'); loadKeys(); }
  };

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'geral', label: 'Geral' },
    { id: 'pagamentos', label: 'Pagamentos' },
    { id: 'gcal', label: 'Google Agenda' },
    { id: 'api', label: 'API' },
  ];

  return (
    <div className="fade-up max-w-2xl">
      <PageHeader title="Configurações" subtitle="Parâmetros globais do SaaS" />
      <div className="flex gap-1 mb-5 bg-slate-100 rounded-2xl p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cx('px-4 py-2 rounded-xl text-sm font-bold transition', tab === t.id ? 'bg-white text-ink shadow-sm' : 'text-sub hover:text-ink')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'geral' && (
        <Card className="p-6">
          <div className="space-y-4">
            <Field label="Logo do painel" hint="Aparece no painel Master e no painel dos profissionais. PNG, JPG, SVG ou WebP até 2 MB.">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {form.logo_url
                    ? <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
                    : <span className="text-xl font-extrabold text-slate-300">A</span>}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
                  <Button variant="ghost" loading={uploading} onClick={() => fileRef.current?.click()}>
                    {form.logo_url ? 'Trocar logo' : 'Enviar logo'}
                  </Button>
                  {form.logo_url && <Button variant="ghost" className="text-rose-600" onClick={removeLogo}>Remover</Button>}
                </div>
              </div>
            </Field>
            <Field label="Trial de novos clientes" hint="Período gratuito de novas empresas. Preencha os dias (7, 14, 30 ou personalizado) OU uma data específica — se a data estiver preenchida, ela tem prioridade e todas as novas contas vencem nela.">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-bold text-sub mb-1">Por dias</p>
                  <Input type="number" value={form.trial_days} onChange={(e) => setForm((f) => ({ ...f, trial_days: Number(e.target.value) }))} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-bold text-sub">Até uma data específica</p>
                    {form.trial_until && (
                      <button type="button" onClick={() => setForm((f) => ({ ...f, trial_until: null }))}
                        className="text-xs font-bold text-rose-600 hover:underline">limpar</button>
                    )}
                  </div>
                  <Input type="date" value={form.trial_until ?? ''} onChange={(e) => setForm((f) => ({ ...f, trial_until: e.target.value || null }))} />
                </div>
              </div>
            </Field>
            <Field label="Dias de tolerância (inadimplência)" hint="Após o vencimento, o cliente mantém acesso por este período antes da suspensão automática.">
              <Input type="number" value={form.tolerance_days} onChange={(e) => setForm((f) => ({ ...f, tolerance_days: Number(e.target.value) }))} />
            </Field>
            <Field label="E-mail do administrador master" hint="Quem cadastrar com este e-mail se torna administrador automaticamente.">
              <Input value={form.master_email ?? ''} onChange={(e) => setForm((f) => ({ ...f, master_email: e.target.value }))} placeholder="admin@seudominio.com" />
            </Field>
            <Button loading={saving} onClick={save}>Salvar configurações</Button>
          </div>
        </Card>
      )}

      {tab === 'geral' && (
        <Card className="p-6 mt-5">
          <p className="font-extrabold text-ink mb-1">Termo de uso</p>
          <p className="text-sm text-sub mb-3">
            Edite o texto exibido na página pública <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/termos</code>.
            Use linhas iniciando com <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded"># título</code> para criar seções;
            uma linha em branco separa parágrafos. Se deixar vazio, o termo padrão do sistema é exibido.
          </p>
          <Textarea rows={14} value={termsText} onChange={(e) => setTermsText(e.target.value)}
            placeholder={'# 1. Sobre o serviço\n\nTexto da seção...\n\n# 2. Aceite dos termos\n\nTexto...'}
            className="text-sm leading-relaxed" />
          <div className="flex gap-2 mt-4">
            <Button loading={termsSaving} onClick={() => saveTerms()}>Salvar termo de uso</Button>
            {termsText.trim() && <Button variant="outline" loading={termsSaving} onClick={() => saveTerms(true)}>Restaurar padrão</Button>}
          </div>
        </Card>
      )}

      {tab === 'pagamentos' && (
        <Card className="p-6">
          {mpLoaded && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 p-4">
                <div>
                  <p className="font-bold text-ink">Mercado Pago</p>
                  <p className="text-xs text-sub">Receba pagamentos das assinaturas via PIX</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={mp.mp_enabled} onChange={(e) => setMp((f) => ({ ...f, mp_enabled: e.target.checked }))} className="w-5 h-5 accent-emerald-600" />
                  <span className="text-sm font-bold text-ink">{mp.mp_enabled ? 'Ativado' : 'Desativado'}</span>
                </label>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                <span className="text-xs font-bold text-sub">Servidor de pagamentos</span>
                {serverArmed === null
                  ? <Badge className="bg-slate-100 text-slate-500">verificando...</Badge>
                  : serverArmed
                    ? <Badge className="bg-brand-50 text-brand-700">conectado</Badge>
                    : <Badge className="bg-amber-50 text-amber-700">aguardando sincronização</Badge>}
              </div>
              <Field label="Ambiente">
                <Select value={mp.mp_environment} onChange={(e) => setMp((f) => ({ ...f, mp_environment: e.target.value }))}>
                  <option value="producao">Produção</option>
                  <option value="teste">Teste / Sandbox</option>
                </Select>
              </Field>
              <Field label="Access Token" hint={mp.mp_access_token === '' && mpLoaded ? 'Salvo e mascarado por segurança. Preencha apenas para substituir.' : 'Nunca é exibido após salvar.'}>
                <Input type="password" value={mp.mp_access_token} onChange={(e) => setMp((f) => ({ ...f, mp_access_token: e.target.value }))} placeholder="APP_USR-..." autoComplete="new-password" />
              </Field>
              <Field label="Public Key">
                <Input value={mp.mp_public_key} onChange={(e) => setMp((f) => ({ ...f, mp_public_key: e.target.value }))} placeholder="APP_USR-..." />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Client ID">
                  <Input value={mp.mp_client_id} onChange={(e) => setMp((f) => ({ ...f, mp_client_id: e.target.value }))} placeholder="Opcional" />
                </Field>
                <Field label="Client Secret">
                  <Input type="password" value={mp.mp_client_secret} onChange={(e) => setMp((f) => ({ ...f, mp_client_secret: e.target.value }))} placeholder="Opcional" autoComplete="new-password" />
                </Field>
              </div>
              <Field label="Webhook Secret" hint="Chave secreta do webhook do Mercado Pago (validação de assinatura).">
                <Input type="password" value={mp.mp_webhook_secret} onChange={(e) => setMp((f) => ({ ...f, mp_webhook_secret: e.target.value }))} autoComplete="new-password" />
              </Field>
              <Field label="URL do Webhook" hint="Cadastre esta URL no painel do Mercado Pago (Suas integrações → Webhooks).">
                <Input value={mp.webhook_url} onChange={(e) => setMp((f) => ({ ...f, webhook_url: e.target.value }))} className="text-xs" />
              </Field>
              {testResult && (
                <div className={cx('rounded-2xl p-4 text-sm font-semibold', testResult.ok ? 'bg-brand-50 text-brand-700' : 'bg-rose-50 text-rose-600')}>
                  {testResult.ok ? 'Conexão OK: ' : 'Falha: '}{testResult.msg}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button loading={mpSaving} onClick={saveMp}>Salvar credenciais</Button>
                <Button variant="outline" loading={testing} onClick={testConnection}>Testar conexão</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'gcal' && (
        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <p className="font-extrabold text-ink">Google Agenda (OAuth)</p>
              <p className="text-sm text-sub mt-1">
                Cada profissional conecta a própria conta Google e os agendamentos do sistema
                passam a aparecer automaticamente no Google Agenda dele.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
              <p className="font-bold text-slate-700">Como configurar (uma vez só):</p>
              <p>1. Acesse o <b>Google Cloud Console</b> → APIs e Serviços → Credenciais.</p>
              <p>2. Crie um <b>ID do cliente OAuth</b> → tipo <b>Aplicativo da Web</b>.</p>
              <p>3. Em <b>URIs de redirecionamento autorizados</b>, cole exatamente:</p>
              <code className="block bg-white border border-slate-200 rounded-lg px-2 py-1 break-all select-all">{GCAL_REDIRECT}</code>
              <p>4. Ative a <b>Google Calendar API</b> em "APIs e Serviços → Biblioteca".</p>
              <p>5. Cole o Client ID e o Client Secret abaixo.</p>
            </div>
            {gcalStatus?.configured && (
              <div className="flex items-center justify-between rounded-2xl bg-brand-50 border border-brand-100 p-3">
                <span className="text-xs font-bold text-brand-700">Credenciais salvas</span>
                <code className="text-xs text-brand-800">{gcalStatus.client_id_masked}</code>
              </div>
            )}
            <Field label="Client ID" hint={gcalStatus?.configured ? 'Salvo. Preencha apenas para substituir.' : 'Ex.: 1234567890-abc.apps.googleusercontent.com'}>
              <Input value={gcalClientId} onChange={(e) => setGcalClientId(e.target.value)} placeholder="Client ID do Google" autoComplete="off" />
            </Field>
            <Field label="Client Secret" hint="Nunca é exibido após salvar.">
              <Input type="password" value={gcalClientSecret} onChange={(e) => setGcalClientSecret(e.target.value)} placeholder="GOCSPX-..." autoComplete="new-password" />
            </Field>
            <Button loading={gcalSaving} onClick={saveGcal}>Salvar credenciais do Google</Button>
          </div>
        </Card>
      )}

      {tab === 'api' && (
        <div className="space-y-5">
          <Card className="p-6">
            <p className="font-extrabold text-ink mb-1">API pública</p>
            <p className="text-sm text-sub mb-4">
              Autenticação: header <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">Authorization: Bearer API_KEY</code>.
              Rate limit de 60 requisições/minuto por chave.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Nome da integração (ex: Meu CRM)" />
              <Button onClick={generateKey}>Gerar API Key</Button>
            </div>
            {freshKey && (
              <div className="rounded-2xl bg-brand-50 border border-brand-100 p-4 mb-4">
                <p className="text-xs font-bold text-brand-700 mb-1">Copie agora — não será exibida novamente:</p>
                <code className="text-xs break-all text-brand-800">{freshKey}</code>
              </div>
            )}
            {keys.length === 0 ? (
              <p className="text-sm text-sub">Nenhuma chave criada.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {keys.map((k) => (
                  <div key={k.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink">{k.name}</p>
                      <p className="text-xs text-sub">{k.key_prefix}•••••••• · {k.last_used_at ? `usada em ${new Date(k.last_used_at).toLocaleString('pt-BR')}` : 'nunca usada'}</p>
                    </div>
                    {k.revoked_at ? <Badge className="bg-rose-50 text-rose-600">revogada</Badge>
                      : <Badge className="bg-brand-50 text-brand-700">ativa</Badge>}
                    {!k.revoked_at && <Button variant="ghost" className="text-rose-600 text-xs" onClick={() => revokeKey(k.id)}>Revogar</Button>}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-6">
            <p className="font-extrabold text-ink mb-3">Endpoints</p>
            <div className="space-y-3 text-sm">
              <div><code className="bg-slate-100 px-2 py-1 rounded text-xs">GET /functions/v1/public-api/status</code><p className="text-xs text-sub mt-1">Verifica autenticação e status da chave.</p></div>
              <div><code className="bg-slate-100 px-2 py-1 rounded text-xs">GET /functions/v1/public-api/subscriptions</code><p className="text-xs text-sub mt-1">Lista assinaturas: empresa, plano, status, vencimento e valor (dados não sensíveis).</p></div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
