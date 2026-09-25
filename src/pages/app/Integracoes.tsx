import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, CreditCard, MessageCircle, Plug, Check, Unlink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, PageHeader, Toggle, cx } from '../../components/ui';

type Integration = { id: string; kind: string; config: Record<string, string>; connected: boolean };
type GcalAccount = { id: string; company_id: string; google_email: string; enabled: boolean; last_sync_at: string | null; last_error: string };

const ITEMS = [
  {
    kind: 'google_calendar', icon: <Calendar size={22} />, name: 'Google Agenda',
    desc: 'Espelhe automaticamente os agendamentos da agenda no seu Google Agenda.',
    tint: 'bg-blue-50 text-blue-600', ready: true,
  },
  {
    kind: 'whatsapp', icon: <MessageCircle size={22} />, name: 'WhatsApp (API oficial)',
    desc: 'Envio automático de confirmações, lembretes e avisos.',
    tint: 'bg-brand-50 text-brand-600', ready: true,
  },
  {
    kind: 'stripe', icon: <CreditCard size={22} />, name: 'Stripe',
    desc: 'Cobrança recorrente internacional de assinaturas.',
    tint: 'bg-violet-50 text-violet-600', ready: true,
  },
  {
    kind: 'asaas', icon: <CreditCard size={22} />, name: 'Asaas',
    desc: 'Cobranças recorrentes brasileiras com split de comissões.',
    tint: 'bg-cyan-50 text-cyan-600', ready: true,
  },
];

export default function Integracoes() {
  const { company, toast } = useApp();
  const [items, setItems] = useState<Integration[]>([]);
  const [gcal, setGcal] = useState<GcalAccount | null>(null);
  const [gcalBusy, setGcalBusy] = useState(false);

  const loadGcal = useCallback(async () => {
    if (!company) return;
    const { data } = await supabase.from('gcal_accounts').select('*').eq('company_id', company.id).maybeSingle();
    setGcal((data as GcalAccount) ?? null);
  }, [company]);

  const load = useCallback(async () => {
    if (!company) return;
    const { data } = await supabase.from('integrations').select('*').eq('company_id', company.id);
    setItems((data ?? []) as Integration[]);
    await loadGcal();
  }, [company, loadGcal]);
  useEffect(() => { load(); }, [load]);

  // Aviso após voltar do OAuth do Google
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const g = p.get('gcal');
    if (g === 'ok') toast('success', 'Google Agenda conectado com sucesso!');
    else if (g === 'erro') toast('error', 'Não foi possível conectar o Google Agenda. Tente novamente.');
    if (g) {
      window.history.replaceState({}, '', '/app/conta/integracoes');
      loadGcal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnectGcal = async () => {
    setGcalBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/google/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: '{}',
    }).catch(() => null);
    await loadGcal();
    setGcalBusy(false);
    toast('success', 'Google Agenda desconectado.');
  };

  const toggle = async (kind: string) => {
    const existing = items.find((i) => i.kind === kind);
    if (existing) {
      const next = { connected: !existing.connected, updated_at: new Date().toISOString() };
      await supabase.from('integrations').update(next).eq('id', existing.id);
      setItems((xs) => xs.map((x) => (x.id === existing.id ? { ...x, ...next } : x)));
    } else {
      const { data } = await supabase
        .from('integrations')
        .insert({ company_id: company!.id, kind, connected: true, config: {} })
        .select('id')
        .single();
      if (data) setItems((xs) => [...xs, { id: data.id, kind, connected: true, config: {} }]);
    }
    toast('success', 'Integração atualizada!');
  };

  return (
    <div className="fade-up max-w-3xl">
      <PageHeader title="Integrações" subtitle="Conecte seu negócio às melhores ferramentas" />
      <div className="space-y-3">
        {/* Google Agenda — pausado: exibido em cinza até ativação */}
        <Card className={cx('p-5', !gcal && 'opacity-50 grayscale')}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-50 text-blue-600"><Calendar size={22} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-bold text-ink">Google Agenda</p>
                {gcal
                  ? <Badge className="bg-brand-50 text-brand-700"><Check size={11} className="mr-1" /> Conectado</Badge>
                  : <Badge className="bg-slate-100 text-slate-500">Em breve</Badge>}
              </div>
              <p className="text-xs text-sub mt-0.5">
                {gcal
                  ? <>Sincronizando com <b>{gcal.google_email || 'sua conta Google'}</b>{gcal.last_sync_at ? ` · última sync ${new Date(gcal.last_sync_at).toLocaleString('pt-BR')}` : ''}</>
                  : 'Sincronização com o Google Agenda em breve. Aguardando ativação.'}
              </p>
              {gcal?.last_error && <p className="text-xs text-rose-600 mt-1">Último erro: {gcal.last_error}</p>}
            </div>
            {gcal && (
              <div className="shrink-0">
                <Button variant="ghost" className="text-rose-600" loading={gcalBusy} onClick={disconnectGcal} title="Desconectar"><Unlink size={16} /></Button>
              </div>
            )}
          </div>
        </Card>

        {ITEMS.filter((it) => it.kind !== 'google_calendar' && it.kind !== 'mercadopago').map((it) => {
          const conn = items.find((i) => i.kind === it.kind)?.connected;
          return (
            <Card key={it.kind} className="p-5 flex items-center gap-4">
              <div className={cx('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', it.tint)}>{it.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-ink">{it.name}</p>
                  {conn && <Badge className="bg-brand-50 text-brand-700"><Check size={11} className="mr-1" /> Conectado</Badge>}
                </div>
                <p className="text-xs text-sub mt-0.5">{it.desc}</p>
              </div>
              <Toggle checked={!!conn} onChange={() => toggle(it.kind)} />
            </Card>
          );
        })}
      </div>
      <Card className="p-5 mt-5 bg-slate-50">
        <p className="text-sm font-semibold text-slate-600 flex items-center gap-2"><Plug size={16} /> Webhooks seguros</p>
        <p className="text-xs text-slate-500 mt-1">
          As confirmações de pagamento e sincronizações são validadas por assinatura do gateway —
          o sistema nunca confia apenas na resposta do navegador para liberar assinaturas.
        </p>
      </Card>
    </div>
  );
}
