import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { Button, Card, Field, Input, PageHeader, cx } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';

export default function TrocarSenha() {
  const { profile, session } = useApp();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('A nova senha precisa ter pelo menos 6 caracteres.');
    if (password !== confirm) return setError('A confirmação da nova senha não confere.');
    const email = session?.user?.email;
    if (!email) return setError('Não foi possível identificar seu e-mail. Faça login novamente.');
    setLoading(true);

    // Valida a senha atual reautenticando
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (authErr) {
      setLoading(false);
      return setError('Senha atual incorreta.');
    }

    const { error: upErr } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (upErr) return setError(upErr.message);
    setDone(true);
    setCurrent('');
    setPassword('');
    setConfirm('');
  };

  return (
    <div className="fade-up max-w-xl mx-auto">
      <PageHeader title="Trocar senha" subtitle="Altere sua senha de acesso ao sistema." />

      <Card className="p-6">
        {done ? (
          <div className="text-center py-8">
            <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><Lock size={28} /></div>
            <h2 className="text-lg font-extrabold text-ink">Senha atualizada!</h2>
            <p className="text-sm text-sub mt-1">Sua senha foi alterada com sucesso. Use a nova senha no próximo login.</p>
            <Button variant="outline" className="mt-5" onClick={() => setDone(false)}>Trocar novamente</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <Field label="Senha atual">
              <div className="relative">
                <Input required type={showCurrent ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Digite sua senha atual" />
                <button type="button" onClick={() => setShowCurrent((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            </Field>

            <Field label="Nova senha">
              <div className="relative">
                <Input required type={showNew ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
                <button type="button" onClick={() => setShowNew((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showNew ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            </Field>

            <Field label="Confirmar nova senha">
              <Input required type={showNew ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repita a nova senha" />
            </Field>

            {error && <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">{error}</p>}

            <div className="pt-2">
              <Button type="submit" loading={loading} className="w-full">{loading ? 'Salvando...' : 'Atualizar senha'}</Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
