import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Users, Wallet, TrendingUp, TrendingDown, ChevronRight, WalletCards, Clock, CheckCircle2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Card, Empty, Loading, cx } from '../../components/ui';
import { brl, fmtTime, statusLabel } from '../../lib/utils';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Conquistas por total de atendimentos concluídos
const MILESTONES = [
  { n: 100, img: '/achievements/badge-100.png', label: 'Primeiros passos' },
  { n: 500, img: '/achievements/badge-500.png', label: 'Em ascensão' },
  { n: 1000, img: '/achievements/badge-1000.png', label: 'Profissional dedicado' },
  { n: 5000, img: '/achievements/badge-5000.png', label: 'Mestre da agenda' },
  { n: 10000, img: '/achievements/badge-10000.png', label: 'Lenda' },
];

export default function Dashboard() {
  const { company } = useApp();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<any[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [cash, setCash] = useState<any[]>([]);
  const [totalConcluded, setTotalConcluded] = useState(0);

  useEffect(() => {
    if (!company) return;
    (async () => {
      setLoading(true);
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const [apptsRes, clientsRes, cashRes, doneRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('id, starts_at, ends_at, status, price, clients ( name ), services ( name )')
          .eq('company_id', company.id)
          .gte('starts_at', new Date(start.getTime() - 180 * 86400000).toISOString()),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('company_id', company.id),
        supabase.from('cash_transactions').select('kind, amount, occurred_at, origin, description').eq('company_id', company.id),
        supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('company_id', company.id).eq('status', 'concluido'),
      ]);
      setAppts(apptsRes.data ?? []);
      setClientCount(clientsRes.count ?? 0);
      setCash(cashRes.data ?? []);
      setTotalConcluded(doneRes.count ?? 0);
      setLoading(false);
    })();
  }, [company?.id]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  const apptsMonth = useMemo(
    () => appts.filter((a) => new Date(a.starts_at).getTime() >= monthStart && new Date(a.starts_at).getTime() < monthEnd),
    [appts],
  );

  const receivedMonth = useMemo(
    () =>
      appts
        .filter((a) => a.status === 'concluido' && new Date(a.starts_at).getTime() >= monthStart && new Date(a.starts_at).getTime() < monthEnd)
        .reduce((s, a) => s + Number(a.price || 0), 0),
    [appts],
  );

  // Atendimentos concluídos no mês (contabilizados quando marcados como concluído)
  const concludedMonth = useMemo(
    () => appts.filter((a) => a.status === 'concluido' && new Date(a.starts_at).getTime() >= monthStart && new Date(a.starts_at).getTime() < monthEnd),
    [appts],
  );

  // Horas atendidas no mês: soma da duração real dos atendimentos concluídos
  const hoursMonth = useMemo(
    () => concludedMonth.reduce((s, a) => s + Math.max(0, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 3600000), 0),
    [concludedMonth],
  );
  const fmtHours = (h: number) => {
    const total = Math.round(h * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return hh > 0 ? `${hh}h${mm > 0 ? ` ${String(mm).padStart(2, '0')}min` : ''}` : `${mm}min`;
  };

  const saidasMonth = useMemo(
    () =>
      cash
        .filter((t) => t.kind === 'saida' && (() => { const ts = new Date(t.occurred_at + 'T00:00:00').getTime(); return ts >= monthStart && ts < monthEnd; })())
        .reduce((s, t) => s + Number(t.amount), 0),
    [cash],
  );

  const saldoTotal = useMemo(() => cash.reduce((s, t) => s + (t.kind === 'entrada' ? Number(t.amount) : -Number(t.amount)), 0), [cash]);

  const chart = useMemo(() => {
    const months: { name: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const from = d.getTime();
      const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      const total = cash
        .filter((t) => t.kind === 'entrada')
        .filter((t) => {
          const ts = new Date(t.occurred_at + 'T00:00:00').getTime();
          return ts >= from && ts < to;
        })
        .reduce((s, t) => s + Number(t.amount), 0);
      months.push({ name: MESES[d.getMonth()], total });
    }
    return months;
  }, [cash]);

  const today = useMemo(() => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const to = from + 86400000;
    return appts
      .filter((a) => new Date(a.starts_at).getTime() >= from && new Date(a.starts_at).getTime() < to)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [appts]);

  if (loading) return <Loading />;
  if (!company) return null;

  return (
    <div className="fade-up pb-4">
      <h1 className="text-2xl font-extrabold text-ink tracking-tight">Dashboard</h1>
      <p className="text-sm text-sub mt-0.5 mb-6">Visão geral do seu negócio.</p>

      {/* ---- Conquistas ---- */}
      <Card className="p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-ink">Suas conquistas</p>
          <span className="text-[11px] font-bold text-slate-400">{totalConcluded} atendimentos concluídos</span>
        </div>
        <div className="flex items-start justify-between gap-1">
          {MILESTONES.map((m) => {
            const unlocked = totalConcluded >= m.n;
            return (
              <div key={m.n} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={unlocked ? `${m.label} — ${m.n} atendimentos` : `Bloqueada — faça ${m.n} atendimentos para desbloquear`}>
                <div className={cx('relative rounded-full transition', unlocked ? '' : 'grayscale opacity-35')}>
                  {unlocked && (
                    <span className="absolute -inset-0.5 rounded-full animate-[spin_3.5s_linear_infinite] opacity-70"
                      style={{ background: 'conic-gradient(from 0deg, #059669, #34d399, #fbbf24, #34d399, #059669)' }} />
                  )}
                  <img src={m.img} alt={m.label} className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover bg-white ring-2 ring-white shadow-sm" />
                </div>
                <span className={cx('text-[10px] font-extrabold leading-none', unlocked ? 'text-brand-700' : 'text-slate-300')}>{m.n}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Link to="/app/fluxo-caixa" className="block mb-5">
        <Card className="p-4 flex items-center gap-4 hover:shadow-md transition">
          <span className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><WalletCards size={22} /></span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-ink">Fluxo de caixa completo</p>
            <p className="text-xs text-sub">Entradas, saídas, saldo e lançamentos.</p>
          </div>
          <ChevronRight size={20} className="text-slate-400" />
        </Card>
      </Link>

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
        <Card className="p-4">
          <span className="inline-flex w-9 h-9 rounded-xl items-center justify-center bg-brand-50 text-brand-600 mb-3"><CalendarDays size={18} /></span>
          <p className="text-xs font-semibold text-sub">Agendamentos no mês</p>
          <p className="text-2xl font-extrabold text-ink">{apptsMonth.length}</p>
        </Card>
        <Card className="p-4">
          <span className="inline-flex w-9 h-9 rounded-xl items-center justify-center bg-emerald-50 text-emerald-600 mb-3"><CheckCircle2 size={18} /></span>
          <p className="text-xs font-semibold text-sub">Concluídos no mês</p>
          <p className="text-2xl font-extrabold text-ink">{concludedMonth.length}</p>
          <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{fmtHours(hoursMonth)} atendidas</p>
        </Card>
        <Card className="p-4">
          <span className="inline-flex w-9 h-9 rounded-xl items-center justify-center bg-blue-50 text-blue-600 mb-3"><Users size={18} /></span>
          <p className="text-xs font-semibold text-sub">Clientes cadastrados</p>
          <p className="text-2xl font-extrabold text-ink">{clientCount}</p>
        </Card>
        <Card className="p-4">
          <span className="inline-flex w-9 h-9 rounded-xl items-center justify-center bg-emerald-50 text-emerald-600 mb-3"><Wallet size={18} /></span>
          <p className="text-xs font-semibold text-sub">Recebido no mês</p>
          <p className="text-2xl font-extrabold text-ink">{brl(receivedMonth)}</p>
        </Card>
        <Card className="p-4">
          <span className="inline-flex w-9 h-9 rounded-xl items-center justify-center bg-rose-50 text-rose-600 mb-3"><TrendingDown size={18} /></span>
          <p className="text-xs font-semibold text-sub">Saídas no mês</p>
          <p className="text-2xl font-extrabold text-rose-600">{brl(saidasMonth)}</p>
        </Card>
        <Card className="p-4">
          <span className="inline-flex w-9 h-9 rounded-xl items-center justify-center bg-amber-50 text-amber-600 mb-3"><TrendingUp size={18} /></span>
          <p className="text-xs font-semibold text-sub">Saldo do caixa</p>
          <p className={cx('text-2xl font-extrabold', saldoTotal >= 0 ? 'text-ink' : 'text-rose-600')}>{brl(saldoTotal)}</p>
        </Card>
      </div>

      <Card className="p-5 mb-5">
        <div className="flex items-center justify-between mb-2">
          <p className="font-bold text-ink">Receita — últimos 6 meses</p>
          <Link to="/app/fluxo-caixa" className="text-xs font-bold text-brand-700 inline-flex items-center gap-1">
            Fluxo de caixa <ChevronRight size={14} />
          </Link>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={54} />
            <Tooltip formatter={(v) => brl(Number(v))} />
            <Bar dataKey="total" fill="#059669" radius={[8, 8, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold text-ink">Agendamentos de hoje</p>
          <Link to="/app" className="text-xs font-bold text-brand-700 inline-flex items-center gap-1">
            Ver agenda <ChevronRight size={14} />
          </Link>
        </div>
        {today.length === 0 ? (
          <Empty icon={<Clock size={26} />} title="Nada para hoje" subtitle="Seus atendimentos de hoje aparecem aqui." />
        ) : (
          <div className="divide-y divide-slate-100">
            {today.map((a) => (
              <div key={a.id} className="py-2.5 flex items-center gap-3">
                <span className="text-xs font-extrabold text-slate-500 w-12 shrink-0">{fmtTime(a.starts_at)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink truncate">{a.clients?.name ?? 'Cliente'}</p>
                  <p className="text-xs text-sub truncate">{a.services?.name ?? '—'}</p>
                </div>
                <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">{statusLabel(a.status)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
