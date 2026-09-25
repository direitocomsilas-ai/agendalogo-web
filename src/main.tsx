import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import './style.css';
import { AppProvider, useApp } from './ctx/AppContext';
import { RequireAuth, RequireMaster, AppShell, ReconnectScreen, FeatureGate } from './components/Shell';
import { ToastHost, Loading } from './components/ui';
import Login from './pages/Login';
import LoginSimples from './pages/LoginSimples';
import Onboarding from './pages/Onboarding';
import PublicBooking from './pages/public/PublicBooking';
import Termos from './pages/public/Termos';
import Agenda from './pages/app/Agenda';
import Dashboard from './pages/app/Dashboard';
import FluxoCaixa from './pages/app/FluxoCaixa';
import Clientes from './pages/app/Clientes';
import { OperacaoMenu, CatalogoMenu, ContaMenu } from './pages/app/Menus';
import Servicos from './pages/app/Servicos';
import Profissionais from './pages/app/Profissionais';
import Comissoes from './pages/app/Comissoes';
import Relatorios from './pages/app/Relatorios';
import Anamnese from './pages/app/Anamnese';
import { Produtos, Promocoes, Pacotes, Pedidos, Orcamentos } from './pages/app/CrudPages';
import Configuracoes from './pages/app/Configuracoes';
import LinkPublico from './pages/app/LinkPublico';
import Plano from './pages/app/Plano';
import Whatsapp from './pages/app/Whatsapp';
import Integracoes from './pages/app/Integracoes';
import Suporte from './pages/app/Suporte';
import Embaixadores from './pages/app/Embaixadores';
import TrocarSenha from './pages/app/TrocarSenha';
import AdminShell, { AdminDashboard } from './pages/admin/Admin';
import AdminUsuarios from './pages/admin/Usuarios';
import AdminPlanos from './pages/admin/Planos';
import AdminFinanceiro from './pages/admin/Financeiro';
import AdminIndicacoes from './pages/admin/Indicacoes';
import AdminEmbaixadores from './pages/admin/Embaixadores';
import AdminSuporte from './pages/admin/Suporte';
import AdminConfig from './pages/admin/AdminConfig';
import AdminAssinaturas from './pages/admin/AdminAssinaturas';

function RootRedirect() {
  const { loading, userDataLoading, session, company, profile, connError } = useApp();
  if (loading || userDataLoading) return <div className="min-h-screen grid place-items-center"><Loading /></div>;
  // App instalado (PWA/mobile) ou app iOS: abre direto no login limpo /entrar
  const isApp =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      /AgendaLogoApp/.test(window.navigator.userAgent));
  if (!session) return <Navigate to={isApp ? '/entrar' : '/login'} replace />;
  if (connError) return <ReconnectScreen />;
  if (profile?.is_master && !company) return <Navigate to="/admin" replace />;
  if (!company) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/app" replace />;
}

const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/entrar', element: <LoginSimples /> },
  { path: '/termos', element: <Termos /> },
  { path: '/onboarding', element: <Onboarding /> },
  { path: '/b/:slug', element: <PublicBooking /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/app', element: <Agenda /> },
          { path: '/app/dashboard', element: <FeatureGate feat="dashboard"><Dashboard /></FeatureGate> },
          { path: '/app/fluxo-caixa', element: <FeatureGate feat="cashflow"><FluxoCaixa /></FeatureGate> },
          { path: '/app/clientes', element: <FeatureGate feat="clients"><Clientes /></FeatureGate> },
          { path: '/app/operacao', element: <OperacaoMenu /> },
          { path: '/app/operacao/servicos', element: <FeatureGate feat="services"><Servicos /></FeatureGate> },
          { path: '/app/operacao/relatorios', element: <FeatureGate feat="reports"><Relatorios /></FeatureGate> },
          { path: '/app/operacao/profissionais', element: <FeatureGate feat="professionals"><Profissionais /></FeatureGate> },
          { path: '/app/operacao/comissoes', element: <FeatureGate feat="commissions"><Comissoes /></FeatureGate> },
          { path: '/app/operacao/anamnese', element: <FeatureGate feat="anamnese"><Anamnese /></FeatureGate> },
          { path: '/app/catalogo', element: <CatalogoMenu /> },
          { path: '/app/catalogo/produtos', element: <FeatureGate feat="produtos"><Produtos /></FeatureGate> },
          { path: '/app/catalogo/promocoes', element: <FeatureGate feat="promocoes"><Promocoes /></FeatureGate> },
          { path: '/app/catalogo/pacotes', element: <FeatureGate feat="pacotes"><Pacotes /></FeatureGate> },
          { path: '/app/catalogo/pedidos', element: <FeatureGate feat="pedidos"><Pedidos /></FeatureGate> },
          { path: '/app/catalogo/orcamentos', element: <FeatureGate feat="orcamentos"><Orcamentos /></FeatureGate> },
          { path: '/app/conta', element: <ContaMenu /> },
          { path: '/app/conta/configuracoes', element: <Configuracoes /> },
          { path: '/app/conta/link-publico', element: <FeatureGate feat="link_publico"><LinkPublico /></FeatureGate> },
          { path: '/app/conta/plano', element: <Plano /> },
          { path: '/app/conta/whatsapp', element: <Whatsapp /> },
          { path: '/app/conta/integracoes', element: <FeatureGate feat="integrations"><Integracoes /></FeatureGate> },
          { path: '/app/conta/suporte', element: <Suporte /> },
          { path: '/app/conta/indicacoes', element: <Navigate to="/app/conta/embaixadores" replace /> },
          { path: '/app/conta/embaixadores', element: <FeatureGate feat="ambassadors"><Embaixadores /></FeatureGate> },
          { path: '/app/conta/senha', element: <TrocarSenha /> },
        ],
      },
    ],
  },
  {
    element: <RequireMaster />,
    children: [
      {
        element: <AdminShell />,
        children: [
          { path: '/admin', element: <AdminDashboard /> },
          { path: '/admin/usuarios', element: <AdminUsuarios /> },
          { path: '/admin/assinaturas', element: <AdminAssinaturas /> },
          { path: '/admin/planos', element: <AdminPlanos /> },
          { path: '/admin/financeiro', element: <AdminFinanceiro /> },
          { path: '/admin/indicacoes', element: <AdminIndicacoes /> },
          { path: '/admin/embaixadores', element: <AdminEmbaixadores /> },
          { path: '/admin/suporte', element: <AdminSuporte /> },
          { path: '/admin/config', element: <AdminConfig /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
      <ToastHost />
    </AppProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Procura atualizações do SW ao abrir e periodicamente.
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
      // Quando uma nova versão assumir o controle (após já haver uma ativa),
      // recarrega para servir o bundle novo imediatamente.
      let hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !refreshing) {
          refreshing = true;
          window.location.reload();
        }
        hadController = true;
      });

      // Atualização automática ao reabrir o app (PWA em segundo plano):
      // compara apenas o NOME do arquivo do bundle; se houver versão nova,
      // recarrega UMA única vez por sessão para não entrar em loop.
      const basename = (s: string) => s.split('/').pop() || s;
      const checkNewVersion = async () => {
        try {
          if (document.visibilityState !== 'visible') return;
          if (sessionStorage.getItem('al_reloaded_bundle')) return;
          const res = await fetch(`/index.html?t=${Date.now()}`, { cache: 'no-store' });
          const html = await res.text();
          const remote = [...html.matchAll(/assets\/index-[^"']+\.js/g)].map((m) => basename(m[0])).sort();
          const local = [...document.querySelectorAll('script[src]')].map((s) => basename(s.getAttribute('src') || '')).filter((s) => s.startsWith('index-') && s.endsWith('.js')).sort();
          if (remote.length && local.length && remote.join('|') !== local.join('|')) {
            sessionStorage.setItem('al_reloaded_bundle', '1');
            window.location.reload();
          }
        } catch { /* offline: mantém versão atual */ }
      };
      setTimeout(checkNewVersion, 3000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(checkNewVersion, 1500); });
    }).catch(() => {
      /* PWA opcional: falha de registro não afeta o app */
    });
  });
}
