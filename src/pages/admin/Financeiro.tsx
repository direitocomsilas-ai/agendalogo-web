import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle2, Clock, XCircle, TrendingUp, Trash2 } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { supabase } from '../../lib/supabase';
import { Badge, Card, Confirm, Empty, Input, PageHeader, Stat, cx } from '../../components/ui';
import { useApp } from '../../ctx/AppContext';
import { brl, fmtDate, fmtDateTime } from '../../lib/utils';

type Payment = { id: string; company_id: string; amount: number; status: string; method: string; gateway: string; paid_at: string | null; created_at: string; confirmed_at: string | null; mp_payment_id: string | null; company_name: string };

const FILTERS = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '365', label: '12 meses' },
  { value: 'all', label: 'Tudo' },
];

export default function AdminFinanceiro() {
  const { toast } = useApp();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filter, setFilter] = useState('30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Payment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('payments').select('*, companies(name)').order('created_at', { ascending: false });
    setPayments(((data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...(r as unknown as Payment),
      company_name: ((r.companies as { name: string } | null)?.name) ?? '—',
    })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const removePayment = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from('payments').delete().eq('id', toDelete.id);
    if (error) { toast('error', 'Erro ao excluir: ' + error.message); return; }
    toast('success', 'Transação excluída.');
    setToDelete(null);
    load();
  };

  const rangePayments = useMemo(() => {
    if (filter === 'custom' && customStart) {
      const end = customEnd ? new Date(customEnd + 'T23:59:59') : new Date();
      const start = new Date(customStart + 'T00:00:00');
      return payments.filter((p) => { const d = new Date(p.created_at); return d >= start && d <= end; });
    }
    if (filter === 'all') return payments;
    const min = Date.now() - Number(filter) * 86400000;
    return payments.filter((p) => new Date(p.created_at).getTime() >= min);
  }, [payments, filter, customStart, customEnd]);

  const kpis = useMemo(() => {
    const aprovados = rangePayments.filter((p) => p.status === 'aprovado');
    const receita = aprovados.reduce((s, p) => s + Number(p.amount), 0);
    const now = new Date(); now.setDate(1); now.setHours(0, 0, 0, 0);
    const recorrente = aprovados.filter((p) => p.paid_at && new Date(p.paid_at) >= now).reduce((s, p) => s + Number(p.amount), 0);
    return {
      receita,
      aprovados: aprovados.length,
      pendentes: rangePayments.filter((p) => p.status === 'pendente').length,
      falhos: rangePayments.filter((p) => p.status === 'falhou').length,
      ticket: aprovados.length ? receita / aprovados.length : 0,
      recorrente,
    };
  }, [rangePayments]);

  const chart = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i, 1);
      map.set(d.toLocaleDateString('pt-BR', { month: 'short' }), 0);
    }
    for (const p of rangePayments) {
      if (p.status !== 'aprovado') continue;
      const k = new Date(p.paid_at ?? p.created_at).toLocaleDateString('pt-BR', { month: 'short' });
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + Number(p.amount));
    }
    return Array.from(map.entries()).map(([mes, total]) => ({ mes, total: Number(total.toFixed(2)) }));
  }, [rangePayments]);

  return (
    <div className="fade-up">
      <PageHeader title="Financeiro" subtitle="Receitas, pagamentos e inadimplência" />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={cx('px-4 h-10 rounded-2xl text-sm font-bold transition', filter === f.value ? 'bg-ink text-white' : 'bg-white border border-slate-200 text-slate-500')}>
            {f.label}
          </button>
        ))}
        <button onClick={() => setFilter('custom')}
          className={cx('px-4 h-10 rounded-2xl text-sm font-bold transition', filter === 'custom' ? 'bg-ink text-white' : 'bg-white border border-slate-200 text-slate-500')}>
          Personalizado
        </button>
        {filter === 'custom' && (
          <span className="flex gap-2">
            <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="!w-40 !h-10" />
            <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="!w-40 !h-10" />
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat icon={<Wallet size={19} />} label="Receita do período" value={brl(kpis.receita)} />
        <Stat icon={<TrendingUp size={19} />} label="No mês atual" value={brl(kpis.recorrente)} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<CheckCircle2 size={19} />} label="Aprovados" value={kpis.aprovados} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<Clock size={19} />} label="Pendentes" value={kpis.pendentes} accent="text-amber-600 bg-amber-50" />
        <Stat icon={<XCircle size={19} />} label="Ticket médio" value={brl(kpis.ticket)} accent="text-blue-600 bg-blue-50" />
      </div>

      <Card className="p-6 mb-6">
        <h2 className="font-extrabold text-ink mb-4">Receita por mês</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chart}>
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#059669" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={50} />
            <Tooltip formatter={(v) => brl(Number(v))} />
            <Area type="monotone" dataKey="total" stroke="#059669" strokeWidth={2.5} fill="url(#g)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <h2 className="font-extrabold text-ink mb-3">Pagamentos ({rangePayments.length})</h2>
      {loading ? <p className="text-sm text-sub py-10 text-center">Carregando...</p> : rangePayments.length === 0 ? (
        <Empty title="Nenhum pagamento no período" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-xs font-bold text-slate-400 uppercase border-b border-slate-100">
                <th className="px-5 py-3.5">Data</th><th className="px-3 py-3.5">Profissional</th>
                <th className="px-3 py-3.5">Valor</th><th className="px-3 py-3.5">Gateway</th>
                <th className="px-3 py-3.5">Método</th><th className="px-3 py-3.5">ID Mercado Pago</th>
                <th className="px-3 py-3.5">Pagamento</th><th className="px-3 py-3.5">Status</th>
                <th className="px-3 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rangePayments.slice(0, 100).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-500">{fmtDateTime(p.created_at)}</td>
                  <td className="px-3 py-3 font-bold text-ink">{p.company_name}</td>
                  <td className="px-3 py-3 font-bold text-ink">{brl(p.amount)}</td>
                  <td className="px-3 py-3 capitalize text-slate-500">{p.gateway}</td>
                  <td className="px-3 py-3 capitalize text-slate-500">{p.method}</td>
                  <td className="px-3 py-3 text-xs text-slate-400">{p.mp_payment_id ?? '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{p.paid_at ? fmtDateTime(p.paid_at) : '—'}</td>
                  <td className="px-3 py-3">
                    <Badge className={cx(p.status === 'aprovado' ? 'bg-brand-50 text-brand-700' : p.status === 'pendente' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-600')}>{p.status}</Badge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => setToDelete(p)}
                      title="Excluir transação"
                      className="p-2 rounded-xl text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Confirm
        open={!!toDelete}
        title="Excluir transação?"
        message={toDelete ? `A transação de ${brl(toDelete.amount)} (${toDelete.company_name}, ${fmtDateTime(toDelete.created_at)}) será removida permanentemente do histórico financeiro.` : ''}
        onConfirm={removePayment}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
