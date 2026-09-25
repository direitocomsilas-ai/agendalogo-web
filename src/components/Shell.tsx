import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  CalendarDays, Users, LayoutGrid, ShoppingBag, Settings, Scissors,
  UserCog, Percent, ClipboardList, Package, Megaphone, Gift, FileText,
  Receipt, Link as LinkIcon, Crown, MessageCircle, Blocks, LifeBuoy,
  LogOut, Bell, ChevronRight, X, Menu as MenuIcon, LayoutDashboard, Wallet, UserPlus, Lock, BarChart3, Award,
} from 'lucide-react';
import { useApp } from '../ctx/AppContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, Loading, cx } from './ui';
import { SUB_STATUS, fmtDateTime } from '../lib/utils';

type Notification = { id: string; title: string; body: string; read: boolean; created_at: string };

// No app nativo iOS não exibimos compra/regularização de assinatura (diretriz 3.1.1 da App Store).
const isNativeApp = typeof navigator !== 'undefined' && /AgendaLogoApp/.test(navigator.userAgent);

export function useNotifications() {
  const { company } = useApp();
  const [items, setItems] = useState<Notification[]>([]);
  const load = async () => {
    if (!company) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setItems((data ?? []) as Notification[]);
  };
  useEffect(() => { load(); }, [company?.id]);
  return { items, reload: load };
}

export function ReconnectScreen() {
  const { refreshCompany } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
      <Card className="max-w-sm w-full p-8 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center">
          <LifeBuoy size={24} className={busy ? 'animate-pulse' : ''} />
        </div>
        <h3 className="mt-4 text-lg font-bold text-ink">Reconectando...</h3>
        <p className="mt-2 text-sm text-sub">A internet demorou para voltar. Seus dados estão seguros.</p>
        <Button
          className="mt-5 w-full"
          loading={busy}
          onClick={async () => { setBusy(true); await refreshCompany(); setBusy(false); }}
        >
          Tentar novamente
        </Button>
      </Card>
    </div>
  );
}

// ---------- Guards ----------
export function RequireAuth() {
  const { loading, userDataLoading, session, company, profile, connError } = useApp();
  const loc = useLocation();
  if (loading || userDataLoading) return <div className="min-h-screen grid place-items-center"><Loading label="Carregando sua conta..." /></div>;
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (connError) return <ReconnectScreen />;
  if (profile?.is_master && !company && !loc.pathname.startsWith('/admin')) {
    return <Navigate to="/admin" replace />;
  }
  if (!company && loc.pathname.startsWith('/app')) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function RequireMaster() {
  const { loading, userDataLoading, session, profile, connError } = useApp();
  if (loading || userDataLoading) return <div className="min-h-screen grid place-items-center"><Loading /></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (connError) return <ReconnectScreen />;
  if (!profile?.is_master) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function BlockedScreen() {
  const { signOut, subscription } = useApp();
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-3xl bg-rose-50 flex items-center justify-center text-rose-500">
          <Crown size={30} />
        </div>
        <h1 className="mt-4 text-xl font-extrabold text-ink">Acesso suspenso</h1>
        <p className="mt-2 text-sm text-sub">
          {isNativeApp
            ? 'Seu período gratuito terminou ou o pagamento do plano está pendente. Acesse o site do Agenda Logo pelo navegador para regularizar sua assinatura.'
            : 'Seu período gratuito terminou ou o pagamento do plano está pendente e passou do prazo de tolerância. Escolha um plano para voltar a usar o Agenda Logo.'}
        </p>
        {subscription?.status && <div className="mt-3"><Badge className={SUB_STATUS[subscription.status]?.color}>{SUB_STATUS[subscription.status]?.label}</Badge></div>}
        <div className="mt-6 flex flex-col gap-3">
          {!isNativeApp && <a href="/app/conta/plano"><Button className="w-full">Regularizar assinatura</Button></a>}
          <Button variant="ghost" onClick={signOut}>Sair da conta</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------- Menu de cards ----------
export function MenuCard({ to, icon, title, desc, tint = 'bg-brand-50 text-brand-600', locked = false, feat }: { to: string; icon: React.ReactNode; title: string; desc?: string; tint?: string; locked?: boolean; feat?: string }) {
  const { planFeatures } = useApp();
  const isLocked = locked || (feat ? planFeatures[feat] === false : false);
  return (
    <NavLink to={to} className="group">
      <Card className={cx('p-5 h-full flex items-center gap-4 hover:shadow-md hover:border-brand-100 transition cursor-pointer', isLocked && 'opacity-50 grayscale')}>
        <div className={cx('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', tint)}>{isLocked ? <Lock size={20} /> : icon}</div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">{title}</p>
          {isLocked
            ? <p className="text-xs text-slate-400 mt-0.5 truncate">Não incluído no seu plano</p>
            : desc && <p className="text-xs text-sub mt-0.5 truncate">{desc}</p>}
        </div>
        <ChevronRight size={18} className="text-slate-300 group-hover:text-brand-500 transition" />
      </Card>
    </NavLink>
  );
}

// ---------- Bloqueio de recurso por plano ----------
export function LockedScreen() {
  return (
    <div className="min-h-[70vh] grid place-items-center p-6">
      <Card className="max-w-sm w-full p-8 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
          <Lock size={24} />
        </div>
        <h3 className="mt-4 text-lg font-bold text-ink">Recurso não incluído no seu plano</h3>
        <p className="mt-2 text-sm text-sub">Fale com o administrador da plataforma para liberar esta função.</p>
        <NavLink
          to="/app/conta/plano"
          className="mt-5 inline-flex items-center justify-center h-11 px-5 rounded-2xl bg-brand-600 text-white font-bold text-sm hover:bg-brand-700 transition"
        >
          Ver meu plano
        </NavLink>
      </Card>
    </div>
  );
}

export function FeatureGate({ feat, children }: { feat: string; children: React.ReactNode }) {
  const { planFeatures } = useApp();
  if (planFeatures[feat] === false) return <LockedScreen />;
  return <>{children}</>;
}

// ---------- Notifications popover ----------
function NotifBell() {
  const { items, reload } = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative p-2.5 rounded-2xl hover:bg-slate-100 text-slate-500">
        <Bell size={20} />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <Card className="absolute right-0 mt-2 w-[min(92vw,380px)] z-50 p-2 max-h-96 overflow-y-auto fade-up">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="font-bold text-ink">Notificações</p>
              {unread > 0 && (
                <button
                  className="text-xs font-semibold text-brand-600"
                  onClick={async () => {
                    const ids = items.filter((n) => !n.read).map((n) => n.id);
                    if (ids.length) {
                      await supabase.from('notifications').update({ read: true }).in('id', ids);
                      reload();
                    }
                  }}
                >
                  Marcar lidas
                </button>
              )}
            </div>
            {items.length === 0 && <p className="px-3 py-6 text-sm text-sub text-center">Nenhuma notificação.</p>}
            {items.map((n) => (
              <div key={n.id} className={cx('px-3 py-2.5 rounded-2xl', !n.read && 'bg-brand-50/60')}>
                <p className="text-sm font-bold text-ink">{n.title}</p>
                {n.body && <p className="text-xs text-sub mt-0.5">{n.body}</p>}
                <p className="text-[10px] text-slate-400 mt-1">{fmtDateTime(n.created_at)}</p>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------- Shell ----------
type NavItem = { to: string; icon: React.ReactNode; label: string; end?: boolean; feat?: string };
const NAV: NavItem[] = [
  { to: '/app/dashboard', icon: <LayoutDashboard size={21} />, label: 'Início', feat: 'dashboard' },
  { to: '/app', icon: <CalendarDays size={21} />, label: 'Agenda', end: true },
  { to: '/app/clientes', icon: <Users size={21} />, label: 'Clientes', feat: 'clients' },
  { to: '/app/clientes?new=1', icon: <UserPlus size={21} />, label: 'Cadastrar Clientes', feat: 'clients' },
  { to: '/app/operacao', icon: <LayoutGrid size={21} />, label: 'Operação' },
  { to: '/app/operacao/relatorios', icon: <BarChart3 size={21} />, label: 'Relatórios', feat: 'reports' },
  { to: '/app/operacao/servicos?new=1', icon: <Scissors size={21} />, label: 'Cadastrar Serviço', feat: 'services' },
  { to: '/app/conta/whatsapp', icon: <MessageCircle size={21} />, label: 'WhatsApp', feat: 'whatsapp' },
  { to: '/app/catalogo', icon: <ShoppingBag size={21} />, label: 'Catálogo', feat: 'catalog' },
  { to: '/app/conta/link-publico', icon: <LinkIcon size={21} />, label: 'Link público', feat: 'link_publico' },
  { to: '/app/conta/embaixadores', icon: <Award size={21} />, label: 'Embaixadores', feat: 'ambassadors' },
  { to: '/app/conta/plano', icon: <Crown size={21} />, label: 'Plano' },
  { to: '/app/conta', icon: <Settings size={21} />, label: 'Conta' },
];

// Recurso não incluído no plano → item fica cinza (ainda clicável: a tela mostra o estado bloqueado)
const navDim = (n: NavItem, planFeatures: Record<string, boolean>) =>
  n.feat && planFeatures[n.feat] === false ? 'opacity-45 grayscale' : '';

// Barra inferior mobile: SOMENTE 5 abas (Início, cadastros rápidos e WhatsApp
// continuam acessíveis pelo menu lateral e pelos menus Operação/Conta)
const TABS: NavItem[] = [
  { to: '/app', icon: <CalendarDays size={22} />, label: 'Agenda', end: true },
  { to: '/app/clientes', icon: <Users size={22} />, label: 'Clientes' },
  { to: '/app/operacao', icon: <LayoutGrid size={22} />, label: 'Operação' },
  { to: '/app/catalogo', icon: <ShoppingBag size={22} />, label: 'Catálogo' },
  { to: '/app/conta', icon: <Settings size={22} />, label: 'Conta' },
];

export function AppShell() {
  const { company, subscription, trialDaysLeft, signOut, accessBlocked, brandLogo, planFeatures } = useApp();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);

  if (accessBlocked && loc.pathname !== '/app/conta/plano') return <BlockedScreen />;

  const showTrial = trialDaysLeft !== null;
  const isMenu = ['/app/operacao', '/app/catalogo', '/app/conta'].some((p) => loc.pathname === p);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 p-4 gap-1 sticky top-0 h-screen pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-3 px-3 py-4">
          {brandLogo
            ? <div className="w-11 h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 shadow-sm"><img src={brandLogo} alt="Logo" className="w-full h-full object-contain" /></div>
            : <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white shadow-md shadow-brand-600/25"><CalendarDays size={22} /></div>}
          <span className="text-xl font-display font-extrabold text-ink tracking-tight">Agenda Logo</span>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 px-4 h-12 rounded-2xl font-semibold text-[15px] transition',
                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100',
                navDim(n, planFeatures),
              )
            }
          >
            {n.icon}
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto px-3 py-4">
          <button onClick={signOut} className="flex items-center gap-3 px-4 h-11 rounded-2xl text-slate-400 hover:bg-slate-100 font-semibold text-sm w-full">
            <LogOut size={19} /> Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-100 pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-3 px-4 sm:px-8 h-16">
            <button className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-slate-100 text-slate-600" onClick={() => setDrawer(true)}>
              <MenuIcon size={22} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-ink truncate">
                Olá, {company?.name} <span className="inline-block origin-bottom-right animate-[wa-wave_2s_ease-in-out_infinite]">👋</span>
              </p>
              <p className="text-[11px] text-sub -mt-0.5">{company?.category}</p>
            </div>
            <NotifBell />
            <div className="relative w-9 h-9 shrink-0">
              {company?.logo_url && (
                <div className="absolute -inset-[3px] rounded-full animate-[spin_3.5s_linear_infinite]"
                  style={{ background: 'conic-gradient(from 0deg, #059669, #3b82f6, #f59e0b, #ef4444, #a855f7, #06b6d4, #059669)' }} />
              )}
              {company?.logo_url ? (
                <img src={company.logo_url} alt="Foto do negócio" className="absolute inset-0 w-full h-full rounded-full object-cover ring-2 ring-white bg-white" />
              ) : (
                <div className="absolute inset-0 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center font-extrabold text-sm">
                  {(company?.name ?? 'A').charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>
          {showTrial && (
            <div className="bg-brand-50 border-t border-brand-100 px-4 sm:px-8 py-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-brand-800">
                Seu período gratuito termina em {trialDaysLeft} {trialDaysLeft === 1 ? 'dia' : 'dias'}.
              </p>
              {!isNativeApp && <NavLink to="/app/conta/plano" className="text-xs font-bold text-brand-700 underline shrink-0">Escolher plano</NavLink>}
            </div>
          )}
          {subscription?.status === 'vencido' && (
            <div className="bg-amber-50 border-t border-amber-100 px-4 sm:px-8 py-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-amber-800">Seu pagamento está pendente.</p>
              {!isNativeApp && <NavLink to="/app/conta/plano" className="text-xs font-bold text-amber-700 underline shrink-0">Regularizar</NavLink>}
            </div>
          )}
        </header>

        <main className={cx('flex-1 px-4 sm:px-8 py-6 lg:pb-10 max-w-6xl w-full mx-auto', isMenu ? 'pb-[calc(8rem+env(safe-area-inset-bottom))]' : 'pb-[calc(7rem+env(safe-area-inset-bottom))]')}>
          <Outlet />
        </main>
      </div>

      {/* Drawer mobile */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] fade-up overflow-y-auto">
            <div className="flex items-center gap-2.5 px-2 py-3">
              {brandLogo
                ? <img src={brandLogo} alt="Logo" className="w-9 h-9 rounded-xl object-contain" />
                : <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white"><CalendarDays size={18} /></div>}
              <span className="font-display font-extrabold text-ink text-xl tracking-tight">Agenda Logo</span>
              <button onClick={() => setDrawer(false)} className="ml-auto p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={20} /></button>
            </div>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx('flex items-center gap-3 px-4 h-12 rounded-2xl font-semibold', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500', navDim(n, planFeatures))
                }
              >
                {n.icon} {n.label}
              </NavLink>
            ))}
            <button onClick={signOut} className="flex items-center gap-3 px-4 h-12 rounded-2xl text-slate-400 font-semibold w-full">
              <LogOut size={19} /> Sair
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav mobile: 5 abas fixas, distribuídas uniformemente */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-100 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 h-16">
          {TABS.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx('flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors', isActive ? 'text-brand-600' : 'text-slate-400', navDim(n, planFeatures))
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export const MENU_OPERACAO = (
  <>
    <MenuCard to="/app/operacao/servicos" icon={<Scissors size={22} />} title="Serviços" desc="Seções e serviços oferecidos" feat="services" />
    <MenuCard to="/app/operacao/relatorios" icon={<BarChart3 size={22} />} title="Relatórios" desc="Desempenho e resultados" tint="bg-indigo-50 text-indigo-600" feat="reports" />
    <MenuCard to="/app/operacao/profissionais" icon={<UserCog size={22} />} title="Profissionais" desc="Sua equipe" tint="bg-blue-50 text-blue-600" feat="professionals" />
    <MenuCard to="/app/operacao/comissoes" icon={<Percent size={22} />} title="Comissões" desc="Ganhos da equipe" tint="bg-amber-50 text-amber-600" feat="commissions" />
    <MenuCard to="/app/operacao/anamnese" icon={<ClipboardList size={22} />} title="Anamnese" desc="Fichas dos clientes" tint="bg-rose-50 text-rose-500" feat="anamnese" />
  </>
);

export const MENU_CATALOGO = (
  <>
    <MenuCard to="/app/catalogo/produtos" icon={<Package size={22} />} title="Produtos" desc="Estoque e vendas" feat="produtos" />
    <MenuCard to="/app/catalogo/promocoes" icon={<Megaphone size={22} />} title="Promoções" desc="Descontos por período" tint="bg-fuchsia-50 text-fuchsia-600" feat="promocoes" />
    <MenuCard to="/app/catalogo/pacotes" icon={<Gift size={22} />} title="Pacotes" desc="Sessões com desconto" tint="bg-amber-50 text-amber-600" feat="pacotes" />
    <MenuCard to="/app/catalogo/pedidos" icon={<Receipt size={22} />} title="Pedidos" desc="Vendas realizadas" tint="bg-blue-50 text-blue-600" feat="pedidos" />
    <MenuCard to="/app/catalogo/orcamentos" icon={<FileText size={22} />} title="Orçamentos" desc="Propostas para clientes" tint="bg-slate-100 text-slate-500" feat="orcamentos" />
  </>
);

export function MenuConta() {
  return (
    <>
      <MenuCard to="/app/fluxo-caixa" icon={<Wallet size={22} />} title="Fluxo de caixa" desc="Entradas, saídas e saldo" tint="bg-emerald-50 text-emerald-600" feat="cashflow" />
      <MenuCard to="/app/conta/configuracoes" icon={<Settings size={22} />} title="Configurações" desc="Negócio, expediente e agenda" />
      <MenuCard to="/app/conta/link-publico" icon={<LinkIcon size={22} />} title="Link público" desc="Agendamento online" tint="bg-blue-50 text-blue-600" feat="link_publico" />
      <MenuCard to="/app/conta/plano" icon={<Crown size={22} />} title="Plano" desc="Assinatura e pagamentos" tint="bg-amber-50 text-amber-600" />
      <MenuCard to="/app/conta/whatsapp" icon={<MessageCircle size={22} />} title="WhatsApp" desc="Mensagens automáticas" tint="bg-emerald-50 text-emerald-600" feat="whatsapp" />
      <MenuCard to="/app/conta/integracoes" icon={<Blocks size={22} />} title="Integrações" desc="Google Calendar e mais" tint="bg-violet-50 text-violet-600" feat="integrations" />
      <MenuCard to="/app/conta/suporte" icon={<LifeBuoy size={22} />} title="Pedir ajuda" desc="Suporte e chamados" tint="bg-rose-50 text-rose-500" />
      <MenuCard to="/app/conta/embaixadores" icon={<Users size={22} />} title="Embaixadores" desc="Indique e ganhe comissões" tint="bg-brand-50 text-brand-600" feat="ambassadors" />
      <MenuCard to="/app/conta/senha" icon={<Lock size={22} />} title="Trocar senha" desc="Altere sua senha de acesso" tint="bg-slate-100 text-slate-600" />
    </>
  );
}
