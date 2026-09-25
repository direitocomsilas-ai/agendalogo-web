import React, { useCallback, useEffect, useState } from 'react';
import { Check, Crown, CreditCard, QrCode } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Modal, PageHeader, Stat, cx } from '../../components/ui';
import { SUB_STATUS, brl, fmtDate } from '../../lib/utils';

type Plan = {
  id: string;
  name: string;
  price: number;
  period: string;
  max_professionals: number | null;
  max_clients: number | null;
  max_appointments: number | null;
  features: Record<string, boolean>;
  active: boolean;
  sort: number;
};
type Payment = { id: string; amount: number; status: string; method: string; gateway: string; gateway_ref: string; paid_at: string | null; created_at: string };

const FEATURE_LABELS: Record<string, string> = {
  dashboard: 'Início (Dashboard)',
  clients: 'Clientes',
  services: 'Serviços',
  professionals: 'Profissionais (equipe)',
  commissions: 'Comissões',
  reports: 'Relatórios',
  anamnese: 'Anamnese',
  cashflow: 'Fluxo de caixa',
  link_publico: 'Link público de agendamento',
  catalog: 'Catálogo (menu)',
  produtos: 'Produtos',
  promocoes: 'Promoções',
  pacotes: 'Pacotes',
  pedidos: 'Pedidos',
  orcamentos: 'Orçamentos',
  whatsapp: 'WhatsApp automático',
  call_blocker: 'Bloqueio de chamadas (Call Blocker)',
  integrations: 'Integrações (em breve)',
  google_calendar: 'Google Calendar',
  ambassadors: 'Embaixadores (indicações)',
};

type PixCharge = { payment_id: string; amount: number; qr_code: string; qr_code_base64: string; expires_at: string };

// No app nativo iOS não exibimos compra de assinatura (diretriz 3.1.1 da App Store).
// O profissional vê o status do plano, mas assina/renova pelo site.
const isNativeApp = typeof navigator !== 'undefined' && /AgendaLogoApp/.test(navigator.userAgent);

export default function Plano() {
  const { company, subscription, refreshCompany, toast } = useApp();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [checkout, setCheckout] = useState<Plan | null>(null);
  const [payRef, setPayRef] = useState('');
  const [step, setStep] = useState<'form' | 'waiting' | 'pix' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<PixCharge | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!company) return;
    const [p, pay] = await Promise.all([
      supabase.from('plans').select('*').eq('active', true).order('sort'),
      supabase.from('payments').select('*').eq('company_id', company.id).order('created_at', { ascending: false }).limit(15),
    ]);
    setPlans((p.data ?? []) as Plan[]);
    setPayments((pay.data ?? []) as Payment[]);
  }, [company]);
  useEffect(() => { load(); }, [load]);

  const startCheckout = async (plan: Plan) => {
    setCheckout(plan);
    setStep('form');
  };

  const pay = async () => {
    if (!checkout) return;
    setBusy(true);
    // Plano gratuito: ativação direta, sem cobrança
    if ((checkout.price ?? 0) <= 0) {
      const { data: ref, error } = await supabase.rpc('start_checkout', { p_plan_id: checkout.id, p_gateway: 'simulado' });
      setBusy(false);
      if (error || !ref) { toast('error', 'Erro no checkout: ' + (error?.message ?? '')); return; }
      setPayRef(ref);
      setStep('waiting');
      const { error: err } = await supabase.rpc('confirm_payment', { p_ref: ref });
      if (err) toast('error', 'Erro na ativação: ' + err.message);
      else { setStep('done'); await refreshCompany(); load(); }
      return;
    }
    // Planos pagos: somente PIX via Mercado Pago
    const { data: sess } = await supabase.auth.getSession();
    const r = await fetch('/api/mp/create-pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session?.access_token ?? ''}` },
      body: JSON.stringify({ plan_id: checkout.id }),
    });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok || !data || data.error) {
      const msg = String(data?.error ?? 'Erro ao gerar PIX');
      const hint = /live credentials|teste/i.test(msg)
        ? ' As credenciais do Mercado Pago estão em modo teste — o administrador deve configurar credenciais de produção.'
        : '';
      toast('error', 'Não foi possível gerar o PIX: ' + msg + hint);
      return;
    }
    setPix(data as PixCharge);
    setPayRef(data.payment_id);
    setStep('pix');
  };

  // Polling do PIX: verifica status local e, a cada 3 ciclos, consulta o Mercado Pago diretamente
  useEffect(() => {
    if (step !== 'pix' || !pix) return;
    let cycles = 0;
    const tick = async () => {
      cycles += 1;
      if (cycles % 3 === 0) {
        const { data: sess } = await supabase.auth.getSession();
        await fetch('/api/mp/check-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session?.access_token ?? ''}` },
          body: JSON.stringify({ ref: pix.payment_id }),
        }).catch(() => {});
      }
      const { data } = await supabase.from('payments').select('status').eq('id', pix.payment_id).maybeSingle();
      if (data?.status === 'aprovado') {
        setStep('done');
        await refreshCompany();
        load();
      }
    };
    const t = setInterval(tick, 4000);
    tick();
    return () => clearInterval(t);
  }, [step, pix]);

  const sub = subscription;
  const currentPlan = plans.find((p) => p.id === sub?.plan_id);

  return (
    <div className="fade-up max-w-3xl">
      <PageHeader title="Plano" subtitle="Sua assinatura e histórico de pagamentos" />

      {sub && (
        <Card className="p-6 mb-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-14 h-14 rounded-3xl bg-brand-50 text-brand-600 flex items-center justify-center"><Crown size={26} /></div>
            <div>
              <p className="font-extrabold text-ink text-lg">{currentPlan?.name ?? 'Plano'}</p>
              <p className="text-sm text-sub">{brl(sub.amount)} / mês</p>
            </div>
            <Badge className={cx('ml-auto', SUB_STATUS[sub.status]?.color)}>{SUB_STATUS[sub.status]?.label}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <Stat label="Início" value={fmtDate(sub.starts_at)} />
            <Stat label={sub.status === 'trial' ? 'Trial termina' : 'Vencimento'} value={fmtDate(sub.status === 'trial' ? (sub.trial_ends_at ?? sub.starts_at) : (sub.current_period_end ?? sub.starts_at))} />
            <Stat label="Dias restantes" value={(() => {
              const end = sub.status === 'trial' ? sub.trial_ends_at : sub.current_period_end;
              if (!end) return '—';
              const days = Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
              return days > 0 ? String(days) : '0';
            })()} />
            <Stat label="Pagamentos" value={String(payments.filter((p) => p.status === 'aprovado').length)} />
          </div>
          {(sub.status === 'vencido' || sub.status === 'pendente') && !isNativeApp && (
            <div className="mt-5 rounded-2xl bg-amber-50 border border-amber-100 p-4 flex items-center gap-3 flex-wrap">
              <p className="text-sm font-bold text-amber-700 flex-1">Assinatura vencida — renove para continuar usando o Agenda Logo.</p>
              <Button size="sm" onClick={() => startCheckout(plans.find((p) => p.price > 0) ?? plans[0])}>Renovar agora</Button>
            </div>
          )}
          {(sub.status === 'vencido' || sub.status === 'pendente') && isNativeApp && (
            <div className="mt-5 rounded-2xl bg-amber-50 border border-amber-100 p-4">
              <p className="text-sm font-bold text-amber-700">Assinatura vencida. Acesse o site do Agenda Logo pelo navegador para renovar.</p>
            </div>
          )}
        </Card>
      )}

      {!isNativeApp && (
        <>
          <h2 className="font-extrabold text-ink text-lg mb-3">Escolha um plano</h2>
          <div className="grid gap-3 sm:grid-cols-2 mb-8">
        {plans.map((p) => {
          const isCurrent = sub?.plan_id === p.id && sub.status !== 'bloqueado';
          return (
            <Card key={p.id} className={cx('p-6', isCurrent && 'ring-2 ring-brand-400')}>
              <div className="flex items-center justify-between">
                <p className="font-extrabold text-ink text-lg">{p.name}</p>
                {isCurrent && <Badge className="bg-brand-50 text-brand-700">Atual</Badge>}
              </div>
              <p className="mt-2">
                <span className="text-3xl font-extrabold text-ink">{p.price === 0 ? 'Grátis' : brl(p.price)}</span>
                {p.price > 0 && <span className="text-sm text-sub font-semibold"> /mês</span>}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                <li className="flex items-center gap-2 text-slate-600"><Check size={16} className="text-brand-500" /> {p.max_professionals ?? 'Ilimitados'} profissionais</li>
                <li className="flex items-center gap-2 text-slate-600"><Check size={16} className="text-brand-500" /> {p.max_clients ?? 'Ilimitados'} clientes</li>
                <li className="flex items-center gap-2 text-slate-600"><Check size={16} className="text-brand-500" /> {p.max_appointments ?? 'Ilimitados'} agendamentos/mês</li>
                {Object.entries(FEATURE_LABELS).map(([k, label]) => (
                  <li key={k} className={cx('flex items-center gap-2', p.features?.[k] !== false ? 'text-slate-600' : 'text-slate-300 line-through')}>
                    {p.features?.[k] !== false ? <Check size={16} className="text-brand-500" /> : <span className="w-4" />} {label}
                  </li>
                ))}
              </ul>
              <Button className="w-full mt-5" variant={isCurrent ? 'outline' : 'primary'} disabled={isCurrent} onClick={() => startCheckout(p)}>
                {isCurrent ? 'Plano atual' : p.price === 0 ? 'Utilizar' : 'Assinar'}
              </Button>
            </Card>
          );
        })}
          </div>
        </>
      )}

      <h2 className="font-extrabold text-ink text-lg mb-3">Histórico de pagamentos</h2>
      {payments.length === 0 ? (
        <Empty icon={<CreditCard size={28} />} title="Nenhum pagamento ainda" />
      ) : (
        <Card className="divide-y divide-slate-50">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink">{brl(p.amount)}</p>
                <p className="text-xs text-sub">{fmtDate(p.created_at)} · {p.gateway} · {p.method}</p>
              </div>
              <Badge className={
                p.status === 'aprovado' ? 'bg-brand-50 text-brand-700' : p.status === 'pendente' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-600'
              }>{p.status}</Badge>
            </div>
          ))}
        </Card>
      )}

      <Modal open={!!checkout} onClose={() => setCheckout(null)} title={checkout ? `Assinar ${checkout.name}` : ''}>
        {step === 'form' && (
          <div className="space-y-4">
            <p className="text-sm text-sub">Valor: <b className="text-ink text-lg">{brl(checkout?.price ?? 0)}</b> {(checkout?.price ?? 0) > 0 ? '/mês' : ''}</p>
            <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
              <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center"><QrCode size={22} /></div>
              <div>
                <p className="font-bold text-ink text-sm">{(checkout?.price ?? 0) > 0 ? 'Pagamento via PIX — Mercado Pago' : 'Plano gratuito'}</p>
                <p className="text-xs text-sub">{(checkout?.price ?? 0) > 0 ? 'O QR Code é gerado na próxima etapa. O acesso é liberado automaticamente após a confirmação.' : 'Ativação imediata, sem cobrança.'}</p>
              </div>
            </div>
            <Button size="lg" className="w-full" loading={busy} onClick={pay}>
              <QrCode size={18} /> {(checkout?.price ?? 0) > 0 ? 'Gerar PIX' : 'Ativar plano gratuito'}
            </Button>
          </div>
        )}
        {step === 'waiting' && (
          <div className="text-center py-8">
            <div className="mx-auto w-16 h-16 rounded-full border-4 border-brand-100 border-t-brand-500 animate-spin" />
            <p className="mt-5 font-bold text-ink">Ativando seu plano...</p>
            <p className="text-xs text-sub mt-1">Ref: {payRef}</p>
          </div>
        )}
        {step === 'pix' && pix && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-sub">Pague sua assinatura</p>
            <p className="text-3xl font-extrabold text-ink">{brl(pix.amount)}</p>
            {pix.qr_code_base64 ? (
              <div className="mx-auto w-56 h-56 p-2 bg-white rounded-3xl border border-slate-200">
                <img src={`data:image/png;base64,${pix.qr_code_base64}`} alt="QR Code PIX" className="w-full h-full" />
              </div>
            ) : pix.qr_code ? (
              <p className="text-xs text-sub">Abra o app do banco e escaneie o código copia e cola abaixo.</p>
            ) : (
              <div className="mx-auto w-16 h-16 rounded-full border-4 border-brand-100 border-t-brand-500 animate-spin" />
            )}
            {pix.qr_code && (
              <div>
                <button
                  className="w-full text-left rounded-2xl border border-slate-200 p-3 hover:border-brand-300 transition"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(pix.qr_code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard indisponível */ }
                  }}
                >
                  <p className="text-[11px] font-bold text-sub uppercase tracking-wide mb-1">PIX copia e cola</p>
                  <p className="text-[11px] break-all text-slate-600 line-clamp-2">{pix.qr_code}</p>
                  <p className="text-xs font-bold text-brand-600 mt-1">{copied ? 'Copiado!' : 'Toque para copiar'}</p>
                </button>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-sm text-sub">
              <div className="w-4 h-4 rounded-full border-2 border-brand-100 border-t-brand-500 animate-spin" />
              Aguardando pagamento...
            </div>
            <p className="text-[11px] text-sub">A assinatura é liberada automaticamente quando o PIX for confirmado. Esta tela pode ser fechada.</p>
            <Button variant="outline" className="w-full" onClick={() => setCheckout(null)}>Fechar</Button>
          </div>
        )}
        {step === 'done' && (
          <div className="text-center py-8">
            <div className="mx-auto w-16 h-16 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Check size={30} /></div>
            <p className="mt-5 text-lg font-extrabold text-ink">Pagamento aprovado!</p>
            <p className="text-sm text-sub mt-1">Sua assinatura está ativa e o acesso liberado automaticamente.</p>
            <Button className="mt-6 w-full" onClick={() => setCheckout(null)}>Concluir</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
