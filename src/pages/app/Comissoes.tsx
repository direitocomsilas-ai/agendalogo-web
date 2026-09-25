import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle2, Clock, CalendarRange } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Stat, cx } from '../../components/ui';
import { brl, fmtDate, fmtDateTime } from '../../lib/utils';

type Prof = { id: string; name: string; commission: number };
type Appt = { id: string; professional_id: string | null; price: number; status: string; starts_at: string; services: { name: string } | null };
type Payment = { id: string; professional_id: string | null; amount: number; paid_at: string; reference: string | null };

export default function Comissoes() {
  const { company, toast } = useApp();
  const [profs, setProfs] = useState<Prof[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'mes' | 'semana'>('mes');
  const [refDate, setRefDate] = useState(() => toInputMonth(new Date()));
  const [payFor, setPayFor] = useState<{ prof: Prof; amount: number } | null>(null);
  const [payRef, setPayRef] = useState('');
  const [saving, setSaving] = useState(false);

  const [range, setRange] = useState<{ start: Date; end: Date }>(() => monthRange(new Date()));

  function toInputMonth(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function monthRange(d: Date) {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }
  function weekRange(d: Date) {
    const s = new Date(d);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59);
    return { start: s, end: e };
  }

  useEffect(() => {
    const d = new Date(refDate + 'T12:00:00');
    setRange(period === 'mes' ? monthRange(d) : weekRange(d));
  }, [period, refDate]);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const [p, a, pay] = await Promise.all([
      supabase.from('professionals').select('id,name,commission').eq('company_id', company.id).order('name'),
      supabase
        .from('appointments')
        .select('id,professional_id,price,status,starts_at,services(name)')
        .eq('company_id', company.id)
        .gte('starts_at', range.start.toISOString())
        .lte('starts_at', range.end.toISOString())
        .eq('status', 'concluido'),
      supabase.from('commission_payments').select('*').eq('company_id', company.id).gte('paid_at', range.start.toISOString()).lte('paid_at', range.end.toISOString()),
    ]);
    setProfs((p.data ?? []) as Prof[]);
    setAppts(((a.data ?? []) as unknown) as Appt[]);
    setPayments((pay.data ?? []) as Payment[]);
    setLoading(false);
  }, [company, range]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    return profs.map((p) => {
      const mine = appts.filter((a) => a.professional_id === p.id);
      const vendido = mine.reduce((s, a) => s + a.price, 0);
      const comissao = (vendido * p.commission) / 100;
      const pago = payments.filter((x) => x.professional_id === p.id).reduce((s, x) => s + x.amount, 0);
      return { prof: p, qtd: mine.length, vendido, comissao, pago, pendente: Math.max(0, comissao - pago), appts: mine };
    });
  }, [profs, appts, payments]);

  const totais = useMemo(() => ({
    vendido: rows.reduce((s, r) => s + r.vendido, 0),
    comissao: rows.reduce((s, r) => s + r.comissao, 0),
    pago: rows.reduce((s, r) => s + r.pago, 0),
    pendente: rows.reduce((s, r) => s + r.pendente, 0),
  }), [rows]);

  const registrarPagamento = async () => {
    if (!payFor) return;
    setSaving(true);
    const { error } = await supabase.from('commission_payments').insert({
      company_id: company!.id,
      professional_id: payFor.prof.id,
      amount: payFor.amount,
      reference: payRef,
    });
    setSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Pagamento de comissão registrado!'); setPayFor(null); setPayRef(''); load(); }
  };

  return (
    <div className="fade-up">
      <PageHeader title="Comissões" subtitle="Acompanhe os ganhos da sua equipe" />

      <Card className="p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="flex bg-slate-100 rounded-2xl p-1">
          {(['mes', 'semana'] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={cx('px-4 h-9 rounded-xl text-sm font-bold capitalize', period === p ? 'bg-white shadow text-brand-700' : 'text-slate-500')}>
              {p === 'mes' ? 'Mês' : 'Semana'}
            </button>
          ))}
        </div>
        {period === 'mes' ? (
          <Input type="month" value={refDate} onChange={(e) => setRefDate(e.target.value)} className="!w-44" />
        ) : (
          <Input type="date" value={refDate + '-01'} onChange={(e) => setRefDate(e.target.value.slice(0, 7))} className="!w-44" />
        )}
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat icon={<Wallet size={19} />} label="Vendido" value={brl(totais.vendido)} />
        <Stat icon={<CalendarRange size={19} />} label="Comissões" value={brl(totais.comissao)} accent="text-blue-600 bg-blue-50" />
        <Stat icon={<CheckCircle2 size={19} />} label="Pago" value={brl(totais.pago)} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<Clock size={19} />} label="Pendente" value={brl(totais.pendente)} accent="text-amber-600 bg-amber-50" />
      </div>

      {loading ? (
        <p className="text-sm text-sub py-10 text-center">Carregando...</p>
      ) : rows.length === 0 ? (
        <Empty title="Nenhum profissional cadastrado" />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.prof.id} className="p-5">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center font-extrabold">
                  {r.prof.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-ink">{r.prof.name}</p>
                  <p className="text-xs text-sub">{r.qtd} serviços concluídos · comissão {r.prof.commission}%</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {r.pendente > 0 && <Badge className="bg-amber-50 text-amber-700">Pendente {brl(r.pendente)}</Badge>}
                  <Button size="sm" variant="secondary" onClick={() => setPayFor({ prof: r.prof, amount: Number(r.pendente.toFixed(2)) })} disabled={r.pendente <= 0}>
                    Registrar pagamento
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-100 text-center">
                <div><p className="text-xs text-sub font-semibold">Vendido</p><p className="font-extrabold text-ink text-sm">{brl(r.vendido)}</p></div>
                <div><p className="text-xs text-sub font-semibold">Comissão</p><p className="font-extrabold text-blue-600 text-sm">{brl(r.comissao)}</p></div>
                <div><p className="text-xs text-sub font-semibold">Pago no período</p><p className="font-extrabold text-brand-700 text-sm">{brl(r.pago)}</p></div>
              </div>
              {r.appts.length > 0 && (
                <div className="mt-3 space-y-1">
                  {r.appts.slice(0, 5).map((a) => (
                    <div key={a.id} className="flex items-center text-xs text-slate-500 py-1 border-b border-slate-50 last:border-0">
                      <span className="font-semibold">{a.services?.name ?? 'Serviço'}</span>
                      <span className="ml-auto text-slate-400">{fmtDateTime(a.starts_at)}</span>
                      <span className="ml-3 font-bold text-ink w-20 text-right">{brl(a.price)}</span>
                      <span className="ml-2 font-bold text-blue-600 w-20 text-right">{brl((a.price * r.prof.commission) / 100)}</span>
                    </div>
                  ))}
                  {r.appts.length > 5 && <p className="text-[11px] text-slate-400 font-bold">+ {r.appts.length - 5} atendimentos no período</p>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title="Registrar pagamento de comissão">
        {payFor && (
          <div className="space-y-4">
            <p className="text-sm text-sub">Pagamento para <b className="text-ink">{payFor.prof.name}</b></p>
            <Field label="Valor (R$)">
              <Input type="number" step="0.01" value={payFor.amount} onChange={(e) => setPayFor({ ...payFor, amount: Number(e.target.value) })} />
            </Field>
            <Field label="Referência" hint="Ex.: Semana 12/05 – PIX">
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </Field>
            <Button className="w-full" loading={saving} onClick={registrarPagamento}>Confirmar pagamento</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
