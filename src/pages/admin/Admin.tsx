import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Crown, Wallet, CreditCard, Share2, LifeBuoy, Settings, Award,
  LogOut, TrendingUp, UserPlus, UserMinus, AlertTriangle, CheckCircle2, Trash2, CalendarX,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { useApp } from '../../ctx/AppContext';
import { supabase } from '../../lib/supabase';
import { Card, Stat, Loading, cx, Button, Confirm } from '../../components/ui';
import { brl } from '../../lib/utils';

const ADMIN_NAV = [
  { to: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard', end: true },
  { to: '/admin/usuarios', icon: <Users size={20} />, label: 'Usuários' },
  { to: '/admin/planos', icon: <Crown size={20} />, label: 'Planos' },
  { to: '/admin/financeiro', icon: <Wallet size={20} />, label: 'Financeiro' },
  { to: '/admin/indicacoes', icon: <Share2 size={20} />, label: 'Indicações' },
  { to: '/admin/embaixadores', icon: <Award size={20} />, label: 'Embaixadores' },
  { to: '/admin/suporte', icon: <LifeBuoy size={20} />, label: 'Suporte' },
  { to: '/admin/assinaturas', icon: <CreditCard size={20} />, label: 'Assinaturas' },
  { to: '/admin/config', icon: <Settings size={20} />, label: 'Configurações' },
];

export function AdminShell() {
  const { profile, signOut } = useApp();
  const loc = useLocation();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.from('app_settings').select('logo_url').eq('id', 1).single()
      .then(({ data }) => setLogoUrl((data as { logo_url: string | null } | null)?.logo_url ?? null));
  }, [loc.pathname]);
  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="hidden md:flex flex-col w-60 shrink-0 bg-ink text-white p-4 sticky top-0 h-screen pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5 px-3 py-5">
          {logoUrl
            ? <div className="w-9 h-9 rounded-2xl bg-white flex items-center justify-center overflow-hidden shrink-0"><img src={logoUrl} alt="Logo" className="w-full h-full object-contain" /></div>
            : <div className="w-9 h-9 rounded-2xl bg-brand-500 flex items-center justify-center font-extrabold">A</div>}
          <div>
            <p className="font-display font-extrabold leading-tight text-[15px]">Agenda Logo</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Master Admin</p>
          </div>
        </div>
        {ADMIN_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx('flex items-center gap-3 px-4 h-11 rounded-2xl font-semibold text-sm transition mt-1',
                isActive ? 'bg-brand-500/20 text-brand-300' : 'text-slate-400 hover:bg-white/5')
            }
          >
            {n.icon} {n.label}
          </NavLink>
        ))}
        <div className="mt-auto px-3 pb-4">
          <p className="text-xs text-slate-400 truncate">{profile?.name}</p>
          <button onClick={signOut} className="flex items-center gap-2 mt-2 text-slate-400 hover:text-white text-sm font-semibold">
            <LogOut size={16} /> Sair
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="md:hidden bg-ink text-white px-4 py-3 flex items-center gap-2 sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
          {logoUrl
            ? <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0"><img src={logoUrl} alt="Logo" className="w-full h-full object-contain" /></div>
            : <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center font-extrabold text-sm">A</div>}
          <span className="font-extrabold">Master Admin</span>
        </header>
        <div className="md:hidden bg-ink px-2 pb-3 flex gap-1 overflow-x-auto">
          {ADMIN_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('shrink-0 px-3 h-8 flex items-center rounded-full text-xs font-bold',
                isActive ? 'bg-brand-500 text-white' : 'text-slate-400')}>
              {n.label}
            </NavLink>
          ))}
        </div>
        <main className="p-4 sm:p-8 pb-[calc(2rem+env(safe-area-inset-bottom))] max-w-7xl" key={loc.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

type DashboardData = {
  totalUsers: number;
  newUsers: number;
  companies: number;
  byStatus: Record<string, number>;
  receitaMes: number;
  receitaAno: number;
  ticketMedio: number;
  comissoes: number;
  chart: { mes: string; total: number }[];
  recent: { id: string; name: string; created_at: string }[];
};

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const yearStart = new Date(); yearStart.setMonth(0, 1);
    const [comps, subs, pays, coms] = await Promise.all([
      supabase.from('companies').select('id,created_at,name').order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('status'),
      supabase.from('payments').select('amount,status,paid_at,created_at').order('created_at', { ascending: false }),
      supabase.from('referral_commissions').select('amount'),
    ]);
    const companiesData = comps.data ?? [];
    const byStatus: Record<string, number> = {};
    for (const s of subs.data ?? []) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    const approved = (pays.data ?? []).filter((p: { status: string }) => p.status === 'aprovado');
    const chartMap = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i, 1);
      chartMap.set(d.toLocaleDateString('pt-BR', { month: 'short' }) + '/' + String(d.getMonth() + 1).padStart(2, '0'), 0);
    }
    for (const p of approved) {
      const d = new Date(p.paid_at ?? p.created_at);
      if (d < yearStart) continue;
      const k = d.toLocaleDateString('pt-BR', { month: 'short' }) + '/' + String(d.getMonth() + 1).padStart(2, '0');
      if (chartMap.has(k)) chartMap.set(k, (chartMap.get(k) ?? 0) + Number(p.amount));
    }
    const receitaAno = approved
      .filter((p: { paid_at: string | null }) => p.paid_at && new Date(p.paid_at) >= yearStart)
      .reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
    const receitaMes = approved
      .filter((p: { paid_at: string | null }) => p.paid_at && new Date(p.paid_at) >= monthStart)
      .reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
    setData({
      totalUsers: companiesData.length,
      newUsers: companiesData.filter((c: { created_at: string }) => new Date(c.created_at) >= monthStart).length,
      companies: companiesData.length,
      byStatus,
      receitaMes,
      receitaAno,
      ticketMedio: approved.length ? receitaAno / approved.length : 0,
      comissoes: (coms.data ?? []).reduce((s: number, c: { amount: number }) => s + Number(c.amount), 0),
      chart: Array.from(chartMap.entries()).map(([mes, total]) => ({ mes, total: Number(total.toFixed(2)) })),
      recent: companiesData.slice(0, 6).map((c: { id: string; name: string; created_at: string }) => ({ id: c.id, name: c.name || c.id.slice(0, 8), created_at: c.created_at })),
    });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading || !data) return <Loading />;
  const s = data.byStatus;
  const ativos = (s.ativo ?? 0) + (s.trial ?? 0) + (s.gratuito ?? 0);
  const inadimplentes = (s.vencido ?? 0) + (s.bloqueado ?? 0) + (s.pendente ?? 0);

  return (
    <div className="fade-up">
      <h1 className="text-2xl font-extrabold text-ink tracking-tight mb-1">Dashboard</h1>
      <p className="text-sm text-sub mb-6">Visão geral do SaaS Agenda Logo</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Stat icon={<Users size={19} />} label="Total de usuários" value={data.totalUsers} />
        <Stat icon={<UserPlus size={19} />} label="Novos (mês)" value={data.newUsers} accent="text-blue-600 bg-blue-50" />
        <Stat icon={<CheckCircle2 size={19} />} label="Assinaturas ativas" value={ativos} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<AlertTriangle size={19} />} label="Inadimplentes" value={inadimplentes} accent="text-rose-500 bg-rose-50" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat icon={<Wallet size={19} />} label="Receita mensal" value={brl(data.receitaMes)} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<TrendingUp size={19} />} label="Receita anual" value={brl(data.receitaAno)} accent="text-brand-600 bg-brand-50" />
        <Stat icon={<Crown size={19} />} label="Ticket médio" value={brl(data.ticketMedio)} accent="text-amber-600 bg-amber-50" />
        <Stat icon={<Share2 size={19} />} label="Comissões de indicação" value={brl(data.comissoes)} accent="text-violet-600 bg-violet-50" />
      </div>

      <Card className="p-6 mb-6">
        <h2 className="font-extrabold text-ink mb-4">Receita — últimos 12 meses</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={50} />
            <Tooltip formatter={(v) => brl(Number(v))} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="total" fill="#059669" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="font-extrabold text-ink mb-4">Assinaturas por status</h2>
          <div className="space-y-2.5">
            {Object.entries({ trial: 'Trial', gratuito: 'Gratuito', ativo: 'Ativo', pendente: 'Pendente', vencido: 'Vencido', cancelado: 'Cancelado', bloqueado: 'Bloqueado' }).map(([k, label]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="text-sm text-slate-500 font-semibold w-24">{label}</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(100, (s[k] ?? 0) * 100 / Math.max(1, data.companies))}%` }} />
                </div>
                <span className="text-sm font-extrabold text-ink w-8 text-right">{s[k] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="font-extrabold text-ink mb-4">Resumo</h2>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-2xl font-extrabold text-ink">{data.companies}</p><p className="text-xs font-semibold text-sub">Empresas</p></div>
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-2xl font-extrabold text-rose-500">{s.cancelado ?? 0}</p><p className="text-xs font-semibold text-sub">Cancelamentos</p></div>
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-2xl font-extrabold text-brand-600">{s.ativo ?? 0}</p><p className="text-xs font-semibold text-sub">Pagantes</p></div>
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-2xl font-extrabold text-blue-600">{s.trial ?? 0}</p><p className="text-xs font-semibold text-sub">Em trial</p></div>
          </div>
        </Card>
      </div>
      <Card className="p-6 mt-6 border-amber-200 bg-amber-50/40">
        <MaintenanceOldAppointments />
      </Card>
    </div>
  );
}

function MaintenanceOldAppointments() {
  const { toast } = useApp();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    try {
      const res = await fetch('/api/maintenance/old-appointments?days=365', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await res.json();
      setCount(Number(j.count ?? 0));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const doDelete = async () => {
    setConfirmOpen(false);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch('/api/maintenance/old-appointments/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ days: 365 }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Erro ao limpar');
      toast('success', `${j.deleted} agendamentos antigos removidos.`);
      load();
    } catch (e: any) {
      toast('error', e.message);
    }
    setLoading(false);
  };

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-600 grid place-items-center shrink-0"><CalendarX size={20} /></div>
        <div className="flex-1">
          <h2 className="font-extrabold text-ink">Manutenção de agendamentos</h2>
          <p className="text-sm text-sub mt-1">
            {loading
              ? 'Verificando...'
              : count === 0
                ? 'Não há agendamentos com mais de 1 ano no banco.'
                : `Há ${count} agendamento${count === 1 ? '' : 's'} com mais de 1 ano. Deseja remover do banco de dados?`}
          </p>
        </div>
        <Button
          variant="secondary"
          loading={loading}
          disabled={count === 0}
          onClick={() => setConfirmOpen(true)}
          className="shrink-0"
        >
          <Trash2 size={16} /> Limpar
        </Button>
      </div>
      <Confirm
        open={confirmOpen}
        title="Remover agendamentos antigos?"
        message={`Você está prestes a excluir ${count} agendamento${count === 1 ? '' : 's'} com mais de 1 ano. Esta ação não pode ser desfeita.`}
        onConfirm={doDelete}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}

export default AdminShell;
