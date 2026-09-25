import React, { useCallback, useEffect, useState } from 'react';
import { Save, Send, MessageCircle, QrCode, ShieldCheck, RefreshCw, PhoneOff, Link2, History, PhoneIncoming, Plus, Trash2, Lock, Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Textarea, Toggle, cx } from '../../components/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { fmtDateTime } from '../../lib/utils';

type Session = {
  id: string; company_id: string; professional_id: string | null;
  phone_number_id: string; display_phone: string; verified_name: string;
  status: string; last_connected_at: string | null; last_error: string; provider?: string;
};
type Template = { id: string; type: string; body: string; active: boolean };
type Msg = { id: string; type: string; phone: string; body: string; status: string; scheduled_at: string | null; sent_at: string | null; attempts: number; last_error: string; created_at: string; clients: { name: string } | null };
type Prof = { id: string; name: string };
type CallSettings = {
  company_id: string; block_voice: boolean; block_video: boolean;
  send_message: boolean; auto_message: string; allow_enabled: boolean;
  allowlist: string[]; dedupe_hours: number;
};
type CallLog = { id: string; call_from: string; kind: string; declined: boolean; message_sent: boolean; note: string; created_at: string };

const TYPES: { value: string; label: string }[] = [
  { value: 'confirmacao', label: 'Confirmação do agendamento' },
  { value: 'lembrete_24h', label: 'Lembrete 24 horas antes' },
  { value: 'lembrete_3h', label: 'Lembrete 3 horas antes' },
  { value: 'confirmado', label: 'Avisar quando confirmado' },
  { value: 'cancelamento', label: 'Avisar quando cancelado' },
  { value: 'reagendamento', label: 'Avisar quando reagendado' },
  { value: 'concluido', label: 'Avisar quando concluído' },
  { value: 'faltou', label: 'Avisar quando não comparecer' },
];

const MSG_LABEL: Record<string, string> = {
  confirmacao: 'Confirmação', lembrete: 'Lembrete', lembrete_24h: 'Lembrete 24h', lembrete_3h: 'Lembrete 3h',
  confirmado: 'Confirmado', cancelamento: 'Cancelamento', reagendamento: 'Reagendamento',
  concluido: 'Concluído', faltou: 'Não compareceu',
};

const STATUS_BADGE: Record<string, string> = {
  pendente: 'bg-amber-50 text-amber-700',
  processando: 'bg-blue-50 text-blue-700',
  enviado: 'bg-brand-50 text-brand-700',
  erro: 'bg-rose-50 text-rose-700',
  cancelado: 'bg-slate-100 text-slate-500',
};

export default function Whatsapp() {
  const { company, toast, planFeatures } = useApp();
  const waLocked = planFeatures['whatsapp'] === false;
  const cbLocked = planFeatures['call_blocker'] === false;
  const [tab, setTab] = useState<'conexao' | 'automacao' | 'chamadas' | 'historico'>('conexao');
  const [callSettings, setCallSettings] = useState<CallSettings | null>(null);
  const [callLog, setCallLog] = useState<CallLog[]>([]);
  const [savingCalls, setSavingCalls] = useState(false);
  const [newAllowed, setNewAllowed] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [qr, setQr] = useState<{ sessionId: string; img: string | null; status: string; phone?: string | null; error?: string | null } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState({ professional_id: '', phone_number_id: '', waba_id: '', access_token: '' });

  const load = useCallback(async () => {
    if (!company) return;
    const [s, p, t, m] = await Promise.all([
      supabase.from('wa_sessions').select('*').eq('company_id', company.id),
      supabase.from('professionals').select('id, name').eq('company_id', company.id).order('name'),
      supabase.from('whatsapp_templates').select('*').eq('company_id', company.id),
      supabase.from('message_queue').select('*, clients ( name )').eq('company_id', company.id).order('created_at', { ascending: false }).limit(100),
    ]);
    setSessions((s.data ?? []) as Session[]);
    setProfs((p.data ?? []) as Prof[]);
    setTemplates((t.data ?? []) as Template[]);
    setMsgs((m.data ?? []) as unknown as Msg[]);
  }, [company]);
  useEffect(() => { load(); }, [load]);

  // ---- Chamadas (Call Blocker) ----
  const loadCalls = useCallback(async () => {
    if (!company) return;
    const [s, l] = await Promise.all([
      supabase.from('wa_call_settings').select('*').eq('company_id', company.id).maybeSingle(),
      supabase.from('wa_call_log').select('*').eq('company_id', company.id).order('created_at', { ascending: false }).limit(50),
    ]);
    if (s.data) setCallSettings(s.data as CallSettings);
    else setCallSettings({
      company_id: company.id, block_voice: true, block_video: true, send_message: true,
      auto_message: 'Olá! No momento não consigo atender ligações. Por favor, envie uma mensagem por aqui e responderei assim que possível. 😊',
      allow_enabled: false, allowlist: [], dedupe_hours: 24,
    });
    setCallLog((l.data ?? []) as CallLog[]);
  }, [company]);
  useEffect(() => { loadCalls(); }, [loadCalls]);

  const saveCalls = async (patch?: Partial<CallSettings>) => {
    if (!company || !callSettings) return;
    setSavingCalls(true);
    const payload = { ...callSettings, ...patch, company_id: company.id };
    const { error } = await supabase
      .from('wa_call_settings')
      .upsert(payload, { onConflict: 'company_id' });
    setSavingCalls(false);
    if (error) toast('error', 'Erro ao salvar: ' + error.message);
    else { setCallSettings(payload); toast('success', 'Configurações de chamadas salvas!'); }
  };

  const addAllowed = async () => {
    const digits = newAllowed.replace(/\D/g, '');
    if (!digits || !callSettings) return;
    if (callSettings.allowlist.includes(digits)) { setNewAllowed(''); return; }
    await saveCalls({ allowlist: [...callSettings.allowlist, digits] });
    setNewAllowed('');
  };

  const removeAllowed = async (n: string) => {
    if (!callSettings) return;
    await saveCalls({ allowlist: callSettings.allowlist.filter((x) => x !== n) });
  };

  const clearCallLog = async () => {
    if (!company) return;
    await supabase.from('wa_call_log').delete().eq('company_id', company.id);
    setCallLog([]);
    toast('success', 'Histórico de chamadas limpo.');
  };

  const fmtPhone = (d: string) => {
    if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
    return `+${d}`;
  };

  const authHeader = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessão expirada');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  };

  const upd = (id: string, patch: Partial<Template>) => setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const saveTemplate = async (t: Template) => {
    setSaving(t.id);
    const { error } = await supabase.from('whatsapp_templates').update({ body: t.body, active: t.active }).eq('id', t.id);
    setSaving(null);
    if (error) toast('error', 'Erro: ' + error.message);
    else toast('success', 'Mensagem salva!');
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const headers = await authHeader();
      const test = await fetch('/api/wa/test-connection', {
        method: 'POST', headers,
        body: JSON.stringify({ phone_number_id: form.phone_number_id.trim(), access_token: form.access_token.trim() }),
      }).then((r) => r.json());
      if (!test.ok) { toast('error', 'Falha na conexão: ' + (test.error ?? 'verifique os dados')); return; }
      const save = await fetch('/api/wa/save-session', {
        method: 'POST', headers,
        body: JSON.stringify({
          phone_number_id: form.phone_number_id.trim(),
          waba_id: form.waba_id.trim(),
          display_phone_number: (test as any).display_phone_number,
          verified_name: (test as any).verified_name,
          access_token: form.access_token.trim(),
          professional_id: form.professional_id || null,
        }),
      }).then((r) => r.json());
      if (save.error) { toast('error', 'Erro ao salvar: ' + save.error); return; }
      toast('success', 'WhatsApp conectado! 🟢');
      setForm({ professional_id: '', phone_number_id: '', waba_id: '', access_token: '' });
      await load();
    } catch (e: any) {
      toast('error', e?.message ?? 'Erro ao conectar');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (sid: string) => {
    try {
      const headers = await authHeader();
      const r = await fetch('/api/wa/disconnect', { method: 'POST', headers, body: JSON.stringify({ session_id: sid }) }).then((r) => r.json());
      if (r.error) { toast('error', 'Erro: ' + r.error); return; }
      toast('success', 'WhatsApp desconectado.');
      await load();
    } catch (e: any) { toast('error', e?.message ?? 'Erro'); }
  };

  // ---- Modo simples: QR Code (um WhatsApp por empresa) ----
  const startQr = async () => {
    try {
      const headers = await authHeader();
      const r = await fetch('/api/wa/qr/start', {
        method: 'POST', headers,
        body: JSON.stringify({}),
      }).then((x) => x.json());
      if (r.error) { toast('error', 'Erro: ' + r.error); return; }
      if (r.status === 'conectado') {
        toast('success', 'WhatsApp conectado! 🟢');
        await load();
        return;
      }
      setQr({ sessionId: r.session_id, img: null, status: 'conectando' });
    } catch (e: any) { toast('error', e?.message ?? 'Erro ao conectar'); }
  };

  useEffect(() => {
    if (!qr || qr.status === 'conectado') return;
    let alive = true;
    const tick = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const r = await fetch(`/api/wa/qr/status?session_id=${qr.sessionId}`, {
          headers: { Authorization: `Bearer ${data.session?.access_token}` },
        }).then((x) => x.json());
        if (!alive) return;
        if (r.status === 'conectado') {
          setQr((q) => (q ? { ...q, status: 'conectado', phone: r.phone } : q));
          toast('success', 'WhatsApp conectado! 🟢');
          await load();
        } else if (r.error) {
          setQr((q) => (q ? { ...q, status: 'desconectado', error: r.error } : q));
        } else {
          setQr((q) => (q ? { ...q, img: r.qr ?? q.img, status: r.status } : q));
        }
      } catch { /* tenta de novo */ }
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(iv); };
  }, [qr?.sessionId, qr?.status === 'conectado', load]);

  const cancelQr = async () => {
    if (qr) await disconnect(qr.sessionId).catch(() => {});
    setQr(null);
  };

  const [testing, setTesting] = useState<string | null>(null);
  const sendTest = async (sid: string) => {
    setTesting(sid);
    try {
      const headers = await authHeader();
      const r = await fetch('/api/wa/test-send', { method: 'POST', headers, body: JSON.stringify({ session_id: sid }) }).then((x) => x.json());
      if (r.error) toast('error', 'Falhou: ' + r.error);
      else toast('success', 'Mensagem de teste enviada! Verifique o WhatsApp. 📲');
    } catch (e: any) { toast('error', e?.message ?? 'Erro'); }
    finally { setTesting(null); }
  };

  const profName = (pid: string | null) => (pid ? (profs.find((x) => x.id === pid)?.name ?? 'Profissional') : 'Número principal (empresa)');

  // Plano não inclui o WhatsApp automático → central bloqueada
  if (waLocked) {
    return (
      <div className="fade-up max-w-3xl">
        <PageHeader title="WhatsApp" subtitle="Central de conexão e mensagens automáticas" />
        <Card className="p-8 text-center opacity-70">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-slate-100 text-slate-400 grid place-items-center mb-4"><Lock size={30} /></div>
          <p className="font-extrabold text-ink text-lg">Recurso não incluído no seu plano</p>
          <p className="text-sm text-sub mt-2 max-w-md mx-auto">
            O WhatsApp automático (confirmações, lembretes e avisos) faz parte de planos superiores.
            Fale com o administrador ou veja os planos disponíveis para liberar este recurso.
          </p>
          <Link to="/app/conta/plano" className="inline-block mt-5">
            <Button><Crown size={16} /> Ver planos</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="fade-up max-w-3xl">
      <PageHeader title="WhatsApp" subtitle="Central de conexão e mensagens automáticas" />

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {([['conexao', 'Conexão', QrCode], ['automacao', 'Automação', MessageCircle], ['chamadas', 'Chamadas', PhoneIncoming], ['historico', 'Histórico', History]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold shrink-0 transition border',
              tab === k ? 'bg-brand-600 text-white border-brand-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300',
              k === 'chamadas' && cbLocked && 'opacity-50 grayscale',
            )}
          >
            {k === 'chamadas' && cbLocked ? <Lock size={14} /> : <Icon size={16} />} {label}
          </button>
        ))}
      </div>

      {tab === 'conexao' && (
        <>
          {sessions.length > 0 && (
            <div className="space-y-3 mb-6">
              {sessions.map((s) => {
                const on = s.status === 'conectado';
                return (
                  <Card key={s.id} className="p-4 flex items-center gap-4">
                    <span className={cx(
                      'w-11 h-11 rounded-2xl flex items-center justify-center shrink-0',
                      on ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400',
                    )}>
                      <MessageCircle size={22} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-ink flex items-center gap-2">
                        {on ? '🟢 Conectado' : '🔴 Desconectado'}
                        {s.display_phone && <span className="text-sm font-extrabold">{s.display_phone}</span>}
                      </p>
                      <p className="text-xs text-sub mt-0.5">
                        {profName(s.professional_id)}
                        {on && s.last_connected_at && <> · conectado em {fmtDateTime(s.last_connected_at)}</>}
                      </p>
                    </div>
                    {on ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" loading={testing === s.id} onClick={() => sendTest(s.id)}>
                          <Send size={14} /> Testar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => disconnect(s.id)}>
                          <PhoneOff size={14} />
                        </Button>
                      </div>
                    ) : s.provider === 'qr' ? (
                      <Button variant="ghost" size="sm" onClick={() => startQr()}>
                        <RefreshCw size={14} /> Reconectar
                      </Button>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}

          <Card className="p-5">
            <p className="font-bold text-ink mb-1">Conectar WhatsApp</p>
            <p className="text-xs text-sub mb-4">
              Escaneie o QR Code uma única vez, como no WhatsApp Web. A conexão fica salva —
              na próxima vez o sistema reconecta sozinho, sem precisar escanear de novo.
            </p>

            {qr && qr.status !== 'conectado' ? (
              <div className="flex flex-col items-center py-2">
                <div className="w-64 h-64 rounded-3xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden mb-4">
                  {qr.img ? (
                    <img src={qr.img} alt="QR Code do WhatsApp" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-xs text-slate-400 animate-pulse">Gerando QR Code...</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-ink text-center">Escaneie com o seu WhatsApp</p>
                <p className="text-xs text-sub text-center mt-1 leading-relaxed">
                  Abra o WhatsApp no celular → <b>Dispositivos conectados</b> →<br />
                  <b>Conectar dispositivo</b> → aponte para este QR Code.
                </p>
                {qr.error && <p className="text-xs text-rose-600 mt-2">{qr.error}</p>}
                <Button variant="ghost" size="sm" className="mt-3" onClick={cancelQr}>Cancelar</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button className="w-full" loading={qr?.status === 'conectando'} onClick={startQr}>
                  <QrCode size={16} /> Conectar WhatsApp
                </Button>
                <p className="text-[11px] text-slate-400 text-center">
                  Todas as mensagens automáticas serão enviadas por este número para os seus clientes.
                </p>
              </div>
            )}
          </Card>

          <div className="mt-4">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-semibold text-slate-500 hover:text-brand-700 inline-flex items-center gap-1.5"
            >
              <ShieldCheck size={14} /> Avançado: conectar via WhatsApp Cloud API (Meta Business)
            </button>
            {showAdvanced && (
              <Card className="p-5 mt-3 bg-brand-50/40 border-brand-100">
                <p className="text-xs text-brand-700/80 mb-4 leading-relaxed">
                  Integração oficial da Meta para empresas com WhatsApp Business Platform.
                  Copie o <b>Phone Number ID</b> e o <b>Access Token</b> no painel de desenvolvedores da Meta e cole abaixo.
                  O token é testado antes de salvar e fica criptografado — nunca é exibido novamente.
                </p>
                <div className="space-y-3">
                  <Field label="Vincular ao profissional">
                    <Select value={form.professional_id} onChange={(e) => setForm({ ...form, professional_id: e.target.value })}>
                      <option value="">Número principal (empresa)</option>
                      {profs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Phone Number ID (Meta Business)">
                    <Input value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} placeholder="Ex.: 123456789012345" />
                  </Field>
                  <Field label="WABA ID (opcional)">
                    <Input value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })} placeholder="ID da conta do WhatsApp Business" />
                  </Field>
                  <Field label="Access Token">
                    <Input type="password" value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })} placeholder="Token permanente gerado no Meta Business" />
                  </Field>
                  <Button className="w-full" loading={connecting} onClick={connect}>
                    <Link2 size={16} /> Testar e conectar
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </>
      )}

      {tab === 'automacao' && (
        <div className="space-y-4">
          <p className="text-xs text-sub">
            Ative ou desative cada mensagem e personalize o texto. Variáveis disponíveis:{' '}
            <code>{'{cliente}'}</code> <code>{'{profissional}'}</code> <code>{'{servico}'}</code>{' '}
            <code>{'{data}'}</code> <code>{'{horario}'}</code> <code>{'{duracao}'}</code> <code>{'{valor}'}</code> <code>{'{empresa}'}</code>
          </p>
          {TYPES.map((ty) => {
            const t = templates.find((x) => x.type === ty.value);
            if (!t) return null;
            return (
              <Card key={t.id} className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <p className="font-bold text-ink flex-1">{ty.label}</p>
                  <Toggle checked={t.active} onChange={(v) => { upd(t.id, { active: v }); saveTemplate({ ...t, active: v }); }} />
                </div>
                <Textarea value={t.body} onChange={(e) => upd(t.id, { body: e.target.value })} rows={5} />
                <div className="flex items-center justify-end mt-3">
                  <Button size="sm" loading={saving === t.id} onClick={() => saveTemplate(t)}><Save size={14} /> Salvar</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === 'chamadas' && cbLocked && (
        <Card className="p-8 text-center opacity-70">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-slate-100 text-slate-400 grid place-items-center mb-4"><Lock size={30} /></div>
          <p className="font-extrabold text-ink text-lg">Call Blocker não incluído no seu plano</p>
          <p className="text-sm text-sub mt-2 max-w-md mx-auto">
            O bloqueio automático de chamadas (voz e vídeo) é um recurso exclusivo de planos superiores.
            Veja os planos disponíveis para liberar.
          </p>
          <Link to="/app/conta/plano" className="inline-block mt-5">
            <Button><Crown size={16} /> Ver planos</Button>
          </Link>
        </Card>
      )}

      {tab === 'chamadas' && !cbLocked && callSettings && (
        <div className="space-y-4">
          <Card className="p-5 bg-brand-50/40 border-brand-100">
            <div className="flex items-center gap-3 mb-1">
              <span className="w-10 h-10 rounded-2xl bg-brand-100 text-brand-700 grid place-items-center shrink-0"><PhoneOff size={20} /></span>
              <div className="flex-1">
                <p className="font-extrabold text-ink">WhatsApp Call Blocker</p>
                <p className="text-xs text-sub">
                  {(callSettings.block_voice || callSettings.block_video) ? '🟢 Bloqueio ativado' : '⚪ Bloqueio desligado'}
                  {' · '}as <b>mensagens continuam funcionando normalmente</b>
                </p>
              </div>
            </div>
            <p className="text-[11px] text-brand-700/80 mt-2 leading-relaxed">
              Quando alguém ligar para o seu número conectado, a chamada é recusada automaticamente
              (e a mensagem automática é enviada, se ativada). Só funciona com o WhatsApp conectado na aba Conexão.
              <b> Nota:</b> o telefone pode tocar um instante antes da recusa automática.
            </p>
          </Card>

          <Card className="p-5">
            <p className="font-bold text-ink mb-3">Chamadas</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Toggle checked={callSettings.block_voice} onChange={(v) => setCallSettings({ ...callSettings, block_voice: v })} />
                <span className="text-sm font-semibold text-sub">📞 Bloquear chamadas de voz</span>
              </div>
              <div className="flex items-center gap-3">
                <Toggle checked={callSettings.block_video} onChange={(v) => setCallSettings({ ...callSettings, block_video: v })} />
                <span className="text-sm font-semibold text-sub">🎥 Bloquear videochamadas</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <p className="font-bold text-ink mb-3">Mensagem automática</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Toggle checked={callSettings.send_message} onChange={(v) => setCallSettings({ ...callSettings, send_message: v })} />
                <span className="text-sm font-semibold text-sub">Enviar mensagem após recusar a chamada</span>
              </div>
              {callSettings.send_message && (
                <>
                  <Textarea value={callSettings.auto_message} onChange={(e) => setCallSettings({ ...callSettings, auto_message: e.target.value })} rows={4} />
                  <div>
                    <p className="text-xs font-bold text-sub mb-1">Não enviar de novo para o mesmo contato por:</p>
                    <Select value={String(callSettings.dedupe_hours)} onChange={(e) => setCallSettings({ ...callSettings, dedupe_hours: Number(e.target.value) })}>
                      <option value="1">1 hora</option>
                      <option value="3">3 horas</option>
                      <option value="6">6 horas</option>
                      <option value="12">12 horas</option>
                      <option value="24">24 horas</option>
                      <option value="0">Desativado (envia sempre)</option>
                    </Select>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <p className="font-bold text-ink flex-1">Contatos que podem ligar</p>
              <Toggle checked={callSettings.allow_enabled} onChange={(v) => setCallSettings({ ...callSettings, allow_enabled: v })} />
            </div>
            <p className="text-xs text-sub mb-3">
              {callSettings.allow_enabled
                ? 'Apenas os números abaixo NÃO terão as chamadas recusadas. Todos os outros serão bloqueados.'
                : 'Desligado: todas as chamadas (voz/vídeo selecionadas) serão recusadas, de qualquer número.'}
            </p>
            {callSettings.allow_enabled && (
              <>
                <div className="flex gap-2 mb-3">
                  <PhoneInput
                    value={newAllowed}
                    onChange={setNewAllowed}
                    placeholder="61 99999-9999"
                  />
                  <Button variant="secondary" onClick={addAllowed}><Plus size={16} /></Button>
                </div>
                {callSettings.allowlist.length > 0 && (
                  <div className="space-y-1.5">
                    {callSettings.allowlist.map((n) => (
                      <div key={n} className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                        <PhoneIncoming size={13} className="text-brand-600 shrink-0" />
                        <span className="text-sm font-bold text-ink">{fmtPhone(n)}</span>
                        <button onClick={() => removeAllowed(n)} className="ml-auto p-1 rounded-full hover:bg-rose-100 text-rose-500"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>

          <Button className="w-full" loading={savingCalls} onClick={() => saveCalls()}>
            <Save size={16} /> Salvar configurações
          </Button>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-extrabold text-ink text-base">Histórico de chamadas bloqueadas</h2>
              {callLog.length > 0 && (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={loadCalls}><RefreshCw size={13} /></Button>
                  <Button variant="ghost" size="sm" className="text-rose-600" onClick={clearCallLog}><Trash2 size={13} /> Limpar</Button>
                </div>
              )}
            </div>
            {callLog.length === 0 ? (
              <Empty icon={<PhoneOff size={26} />} title="Nenhuma chamada bloqueada ainda" subtitle="Quando alguém ligar e a chamada for recusada, aparece aqui." />
            ) : (
              <Card className="divide-y divide-slate-50">
                {callLog.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="text-lg shrink-0">{c.kind === 'video' ? '🎥' : '📞'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink">{fmtPhone(c.call_from)}</p>
                      <p className="text-xs text-slate-400">
                        {fmtDateTime(c.created_at)} · 🚫 {c.declined ? 'Recusada' : 'Falha na recusa'}
                        {c.message_sent ? ' · 💬 Mensagem enviada' : ''}
                      </p>
                      {c.note && <p className="text-xs text-rose-600 mt-0.5">{c.note}</p>}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'historico' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-extrabold text-ink text-lg">Histórico do WhatsApp</h2>
            <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} /> Atualizar</Button>
          </div>
          {msgs.length === 0 ? (
            <Empty icon={<Send size={26} />} title="Nenhuma mensagem ainda" subtitle="As mensagens aparecem automaticamente quando os agendamentos são criados." />
          ) : (
            <Card className="divide-y divide-slate-50">
              {msgs.map((m) => (
                <div key={m.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink">{m.clients?.name ?? 'Cliente'}</p>
                    <p className="text-xs text-slate-400">
                      📱 {m.phone} · {MSG_LABEL[m.type] ?? m.type} · {fmtDateTime(m.sent_at ?? m.scheduled_at ?? m.created_at)}
                    </p>
                    <p className="text-sm text-slate-600 line-clamp-2 mt-1">{m.body}</p>
                    {m.last_error && <p className="text-xs text-rose-600 mt-1">Erro: {m.last_error}</p>}
                  </div>
                  <Badge className={cx('shrink-0', STATUS_BADGE[m.status] ?? 'bg-slate-100 text-slate-500')}>{m.status}</Badge>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
