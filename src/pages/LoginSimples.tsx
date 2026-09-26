import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CalendarDays, Loader2, Lock } from 'lucide-react';
import { useApp } from '../ctx/AppContext';
import { auth, supabase } from '../lib/supabase';
import { appleSignIn, isAppleAvailable } from '../lib/appleAuth';
import { Button, Card, Input, cx } from '../components/ui';

// App nativo iOS: login por e-mail/senha e Sign in with Apple nativo (a Apple
// exige um login equivalente ao de terceiros — diretriz 4.8). O Google fica
// apenas no navegador porque não funciona dentro do WebView do app.
const isNativeApp = typeof navigator !== 'undefined' && /AgendaLogoApp/.test(navigator.userAgent);

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

// Página de entrada direta — somente login, sem informações de marketing.
export default function LoginSimples() {
  const { session, loading, userDataLoading } = useApp();
  const nav = useNavigate();
  const [agree, setAgree] = useState(false);
  const [agreeErr, setAgreeErr] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);

  if (loading || userDataLoading) return null;
  if (session) return <Navigate to="/" replace />;

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!agree) return setError('É preciso concordar com os Termos de Uso.');
    if (!form.email.trim() || !form.password) return setError('Informe e-mail e senha.');
    setSubmitting(true);
    try {
      const { error: inErr } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });
      if (inErr) {
        const m = inErr.message.toLowerCase();
        if (m.includes('invalid login')) throw new Error('E-mail ou senha incorretos.');
        if (m.includes('email not confirmed')) throw new Error('Confirme seu e-mail antes de entrar.');
        throw inErr;
      }
      nav('/', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const google = () => {
    if (!agree) {
      setAgreeErr(true);
      return;
    }
    setAgreeErr(false);
    auth.openSignInModal({
      appName: 'Agenda Logo',
      primaryColor: '#059669',
      initialView: 'signIn',
    });
  };

  const apple = async () => {
    if (!agree) {
      setAgreeErr(true);
      return;
    }
    setAgreeErr(false);
    setAppleBusy(true);
    setError('');
    try {
      await appleSignIn();
      nav('/', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar com a Apple.');
    } finally {
      setAppleBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/70 to-slate-50 flex flex-col items-center justify-center px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white shadow-lg shadow-brand-600/30">
          <CalendarDays size={26} />
        </div>
        <span className="text-2xl font-display font-extrabold text-ink tracking-tight">Agenda Logo</span>
      </div>

      <Card className="w-full max-w-sm p-7 mt-8">
        <div className="flex items-center gap-2 text-brand-700 text-xs font-bold uppercase tracking-wide">
          <Lock size={14} /> Entrar na sua conta
        </div>
        <form onSubmit={login} className="mt-5 flex flex-col gap-4">
          <label className="block">
            <span className="text-xs font-bold text-sub uppercase tracking-wide">E-mail</span>
            <Input
              className="mt-1.5"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="voce@email.com"
              autoComplete="email"
              inputMode="email"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-sub uppercase tracking-wide">Senha</span>
            <Input
              className="mt-1.5"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Sua senha"
              autoComplete="current-password"
            />
          </label>
          <label
            className={cx(
              'flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer transition',
              agreeErr && !agree ? 'border-rose-300 bg-rose-50' : agree ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-200',
            )}
          >
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
              .
            </span>
          </label>
          {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
          <Button type="submit" size="lg" disabled={submitting} className="flex items-center justify-center gap-2">
            {submitting && <Loader2 size={18} className="animate-spin" />}
            {submitting ? 'Entrando...' : 'Entrar'}
          </Button>
          {isAppleAvailable() && (
            <Button
              type="button"
              size="lg"
              disabled={appleBusy}
              onClick={apple}
              className="bg-black text-white hover:bg-black/85 border border-black/80 flex items-center justify-center gap-2"
            >
              {appleBusy ? <Loader2 size={18} className="animate-spin" /> : <AppleLogo className="w-4.5 h-4.5" />}
              {appleBusy ? 'Entrando...' : 'Entrar com a Apple'}
            </Button>
          )}
          {!isNativeApp && (
            <Button type="button" size="lg" variant="outline" onClick={google}>
              Entrar com Google
            </Button>
          )}
        </form>
        {!isNativeApp && (
          <p className="mt-6 text-center text-xs text-slate-400">
            Ainda não tem conta?{' '}
            <a href="/login" className="text-brand-700 font-extrabold hover:underline">
              Criar minha conta
            </a>
          </p>
        )}
      </Card>
    </div>
  );
}
