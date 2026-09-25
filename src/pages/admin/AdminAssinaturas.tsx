import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Badge, Card, Empty, PageHeader, Stat, cx } from '../../components/ui';
import { SUB_STATUS, brl, fmtDate } from '../../lib/utils';

type Row = {
  id: string;
  status: string;
  amount: number;
  current_period_end: string | null;
  company_name: string;
  plan_name: string | null;
};

const FILTERS = [
  { id: 'todas', label: 'Todas' },
  { id: 'ativo', label: 'Ativas' },
  { id: 'pendente', label: 'Pendentes' },
  { id: 'vencido', label: 'Vencidas' },
  { id: 'cancelado', label: 'Canceladas' },
  { id: 'recusado', label: 'Pagamento recusado' },
] as const;

export default function AdminAssinaturas() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('todas');

  useEffect(() => {
    supabase
      .from('subscriptions')
      .select('id, status, amount, current_period_end, companies(name), plans(name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setRows(
          (data ?? []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            status: r.status as string,
            amount: Number(r.amount ?? 0),
            current_period_end: (r.current_period_end as string | null) ?? null,
            company_name: ((r.companies as { name: string } | null)?.name) ?? '—',
            plan_name: ((r.plans as { name: string } | null)?.name) ?? '—',
          }))
        );
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(
    () => (filter === 'todas' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  const kpis = useMemo(() => {
    const active = rows.filter((r) => r.status === 'ativo');
    const approvedValue = active.reduce((s, r) => s + r.amount, 0);
    return {
      ativas: active.length,
      vencidas: rows.filter((r) => r.status === 'vencido' || r.status === 'bloqueado').length,
      pendentes: rows.filter((r) => r.status === 'pendente' || r.status === 'trial').length,
      receitaMensal: approvedValue,
      receitaTotal: rows.reduce((s, r) => s + r.amount, 0),
    };
  }, [rows]);

  return (
    <div className="fade-up">
      <PageHeader title="Assinaturas" subtitle="Todas as assinaturas dos clientes do SaaS" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="Ativas" value={String(kpis.ativas)} />
        <Stat label="Vencidas" value={String(kpis.vencidas)} />
        <Stat label="Pendentes" value={String(kpis.pendentes)} />
        <Stat label="Receita mensal" value={brl(kpis.receitaMensal)} />
        <Stat label="Receita total" value={brl(kpis.receitaTotal)} />
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={cx('px-3.5 py-1.5 rounded-full text-xs font-bold transition',
              filter === f.id ? 'bg-ink text-white' : 'bg-slate-100 text-sub hover:text-ink')}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Card className="p-10 text-center text-sm text-sub">Carregando...</Card>
      ) : filtered.length === 0 ? (
        <Empty title="Nenhuma assinatura encontrada" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-sub border-b border-slate-100">
                <th className="px-5 py-3">Profissional</th>
                <th className="px-5 py-3">Plano</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Vencimento</th>
                <th className="px-5 py-3">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-bold text-ink">{r.company_name}</td>
                  <td className="px-5 py-3">{r.plan_name}</td>
                  <td className="px-5 py-3"><Badge className={cx(SUB_STATUS[r.status]?.color ?? 'bg-slate-100 text-slate-600')}>{SUB_STATUS[r.status]?.label ?? r.status}</Badge></td>
                  <td className="px-5 py-3">{fmtDate(r.current_period_end)}</td>
                  <td className="px-5 py-3 font-semibold">{brl(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
