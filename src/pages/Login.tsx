import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useNavigate } from 'react-router-dom';
import { CalendarDays, Sparkles, CheckCircle2, X, Loader2, Smartphone } from 'lucide-react';
import { useApp } from '../ctx/AppContext';
import { auth, supabase } from '../lib/supabase';
import { Button, Card, Input, cx } from '../components/ui';

const FEATURES = [
  'Agenda completa e agendamento online',
  'Clientes, serviços, comissões e anamnese',
  'Lembretes automáticos no WhatsApp',
  'Produtos, pacotes, pedidos e orçamentos',
];

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'other';
}

const STEPS: Record<string, string[]> = {
  android: [
    'Abra o site no Chrome',
    'Toque no menu (⋮) ou no banner "Instalar aplicativo"',
    'Confirme em "Instalar"',
    'Pronto! O app aparece na tela inicial',
  ],
  ios: [
    'Abra o site no Safari',
    'Toque no botão Compartilhar (quadrado com seta)',
    'Role e toque em "Adicionar à Tela de Início"',
    'Confirme em "Adicionar"',
  ],
  other: [
    'No Chrome: menu (⋮) → "Instalar Agenda Logo"',
    'No Safari: Compartilhar → "Adicionar à Tela de Início"',
    'No Edge: menu (⋯) → Aplicativos → "Instalar"',
  ],
};

// No app nativo iOS não oferecemos login social (diretriz 4.8 da App Store) — apenas e-mail/senha.
const isNativeApp = typeof navigator !== 'undefined' && /AgendaLogoApp/.test(navigator.userAgent);

export default function Login() {
  const { session, loading, userDataLoading } = useApp();
  const nav = useNavigate();
  const [signupOpen, setSignupOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [agreeErr, setAgreeErr] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [platform, setPlatform] = useState('other');

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem('agendez_ref', ref);
    setPlatform(detectPlatform());
  }, []);

  if (loading || userDataLoading) return null;
  if (session) return <Navigate to="/" replace />;
  // Diretriz 3.1.1 da App Store: no app nativo não exibimos cadastro de contas
  // (profissionais se cadastram e assinam pelo site). O app fica só com login.
  if (isNativeApp) return <Navigate to="/entrar" replace />;

  const openSignIn = () => {
    auth.openSignInModal({
      appName: 'Agenda Logo',
      primaryColor: '#059669',
      initialView: 'signIn',
    });
  };

  // O aceite dos termos é exigido para qualquer entrada (login ou cadastro)
  const requireAgree = (action: () => void) => {
    if (!agree) {
      setAgreeErr(true);
      return;
    }
    setAgreeErr(false);
    action();
  };

  const signup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!agree) return setError('É preciso concordar com os Termos de Uso.');
    if (!form.name.trim()) return setError('Informe seu nome.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return setError('Informe um e-mail válido.');
    if (form.password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.');
    setSubmitting(true);
    try {
      const { data, error: upErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
      });
      if (upErr) throw upErr;
      if (!data.user) throw new Error('Não foi possível criar a conta. Tente novamente.');
      // O e-mail é confirmado automaticamente pelo trigger do banco —
      // entramos direto para estabelecer a sessão.
      const { error: inErr } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });
      if (inErr) throw inErr;
      await supabase.from('profiles').update({ name: form.name.trim() }).eq('id', data.user.id);
      setSignupOpen(false);
      nav('/onboarding');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao criar conta.';
      setError(msg.includes('already registered') ? 'Este e-mail já possui conta. Faça login.' : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/70 to-slate-50 flex flex-col lg:flex-row pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="lg:flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-14">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white shadow-lg shadow-brand-600/30">
            <CalendarDays size={30} />
          </div>
          <div>
            <span className="text-3xl font-display font-extrabold text-ink tracking-tight leading-none">Agenda Logo</span>
            <p className="text-[11px] font-bold text-brand-700 uppercase tracking-[0.18em] mt-1.5">Gestão para o seu negócio</p>
          </div>
        </div>
        <h1 className="mt-10 text-4xl sm:text-5xl font-display font-extrabold text-ink tracking-tight leading-[1.1]">
          Sua agenda,<br />
          <span className="text-brand-600">seu negócio</span> no piloto automático.
        </h1>
        <p className="mt-5 text-sub text-lg max-w-md">
          O sistema completo de agendamento e gestão para salões, barbearias, clínicas de estética,
          nail designers, lash designers, studios e profissionais autônomos.
        </p>
        <ul className="mt-8 space-y-3">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-3 text-[15px] font-semibold text-slate-700">
              <CheckCircle2 size={20} className="text-brand-500 shrink-0" /> {f}
            </li>
          ))}
        </ul>

        <Card className="mt-10 p-5 bg-white/70 border-brand-100">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center">
              <Smartphone size={18} />
            </div>
            <div>
              <p className="font-extrabold text-ink text-sm">Instale o app no seu celular</p>
              <p className="text-xs text-sub">Acesse mais rápido e sem digitar o endereço</p>
            </div>
          </div>
          <ol className="space-y-2">
            {STEPS[platform].map((s, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-extrabold text-white">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <div className="lg:flex-1 flex items-center justify-center px-6 pb-16 lg:py-14">
        <Card className="w-full max-w-md p-8">
          <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 text-xs font-bold px-3 py-1.5 rounded-full">
            <Sparkles size={14} /> Comece com período gratuito
          </div>
          <h2 className="mt-4 text-2xl font-extrabold text-ink">Bem-vindo(a)!</h2>
          <p className="mt-1.5 text-sm text-sub">
            Entre na sua conta ou crie a sua em menos de 2 minutos.
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <label className={cx('flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer transition', agreeErr && !agree ? 'border-rose-300 bg-rose-50' : agree ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-200')}>
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => { setAgree(e.target.checked); if (e.target.checked) setAgreeErr(false); }}
                className="accent-brand-600 w-4.5 h-4.5 mt-0.5 shrink-0"
              />
              <span className="text-[13px] font-semibold text-slate-600 leading-snug">
                Li e concordo com os{' '}
                <a href="/termos" target="_blank" rel="noreferrer" className="text-brand-700 font-extrabold underline underline-offset-2" onClick={(e) => e.stopPropagation()}>
                  Termos de Uso
                </a>
                , incluindo o tratamento de dados conforme a LGPD.
              </span>
            </label>
            {agreeErr && !agree && (
              <p className="text-xs font-bold text-rose-600 -mt-1">Marque a opção acima para continuar.</p>
            )}
            <Button size="lg" onClick={() => requireAgree(() => setSignupOpen(true))}>Criar minha conta</Button>
            <Button size="lg" variant="outline" onClick={() => requireAgree(() => (isNativeApp ? nav('/entrar') : openSignIn()))}>Já tenho conta</Button>
            <button
              onClick={() => nav('/b/demo')}
              className="text-xs text-slate-400 hover:text-brand-600 font-semibold mt-1"
            >
              Ver exemplo de página pública
            </button>
            <a
              href="/entrar"
              className="text-xs text-slate-400 hover:text-brand-600 font-semibold"
            >
              Somente entrar na minha conta
            </a>
          </div>
          <p className="mt-6 text-[11px] text-slate-400 text-center leading-relaxed">
            Seus dados ficam protegidos e separados por empresa.
          </p>
        </Card>
      </div>

      {signupOpen && createPortal(
        <div className="fixed inset-0 h-[100dvh] z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !submitting && setSignupOpen(false)}>
          <Card className="w-full max-w-md p-7 max-h-[90dvh] overflow-y-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-extrabold text-ink">Criar minha conta</h3>
                <p className="text-sm text-sub mt-1">Sem confirmação de e-mail — acesso imediato.</p>
              </div>
              <button onClick={() => setSignupOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={signup} className="mt-5 flex flex-col gap-4">
              <label className="block">
                <span className="text-xs font-bold text-sub uppercase tracking-wide">Seu nome</span>
                <Input
                  className="mt-1.5"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex.: Ana Souza"
                  autoComplete="name"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-sub uppercase tracking-wide">E-mail</span>
                <Input
                  className="mt-1.5"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="voce@email.com"
                  autoComplete="email"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-sub uppercase tracking-wide">Senha</span>
                <Input
                  className="mt-1.5"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                />
              </label>
              {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
              <Button type="submit" size="lg" disabled={submitting} className="flex items-center justify-center gap-2">
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {submitting ? 'Criando conta...' : 'Criar conta e começar'}
              </Button>
            </form>
          </Card>
        </div>,
        document.body
      )}
    </div>
  );
}
