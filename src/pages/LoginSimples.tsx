import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CalendarDays, Loader2, Lock } from 'lucide-react';
import { useApp } from '../ctx/AppContext';
import { auth, supabase } from '../lib/supabase';
import { Button, Card, Input, cx } from '../components/ui';

// No app nativo iOS não oferecemos login social (diretriz 4.8 da App Store) — apenas e-mail/senha.
const isNativeApp = typeof navigator !== 'undefined' && /AgendaLogoApp/.test(navigator.userAgent);

// Página de entrada direta — somente login, sem informações de marketing.
export default function LoginSimples() {
  const { session, loading, userDataLoading } = useApp();
  const nav = useNavigate();
  const [agree, setAgree] = useState(false);
  const [agreeErr, setAgreeErr] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
