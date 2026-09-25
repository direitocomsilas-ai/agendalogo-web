import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../ctx/AppContext';
import { Button, Card, Field, Input, Select, Textarea } from '../components/ui';
import { PhoneInput } from '../components/PhoneInput';
import { CATEGORIES } from '../lib/utils';

export default function Onboarding() {
  const { session, company, loading, refreshCompany, toast } = useApp();
  const nav = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    business: '',
    category: '',
    whatsapp: '',
    description: '',
  });

  useEffect(() => {
    if (session) {
      supabase
        .from('profiles')
        .select('name, whatsapp')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data) setForm((f) => ({ ...f, name: data.name ?? '', whatsapp: data.whatsapp ?? '' }));
        });
    }
  }, [session]);

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (company) return <Navigate to="/app" replace />;

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.business.trim() || !form.category) {
      toast('error', 'Informe o nome do negócio e a categoria.');
      return;
    }
    setSaving(true);
    const ref = localStorage.getItem('agendez_ref');
    if (ref) {
      await supabase.rpc('link_referral', { p_code: ref });
      localStorage.removeItem('agendez_ref');
    }
    const { data, error } = await supabase.rpc('create_company', {
      p_name: form.business.trim(),
      p_category: form.category,
      p_whatsapp: form.whatsapp,
      p_description: form.description,
    });
    setSaving(false);
    if (error) {
      toast('error', 'Erro ao criar negócio: ' + error.message);
      return;
    }
    await refreshCompany();
    toast('success', 'Tudo pronto! Comece adicionando seus serviços e profissionais.');
    nav('/app');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/70 to-slate-50 flex items-center justify-center p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <Card className="w-full max-w-lg p-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white shadow-lg shadow-brand-600/25">
            <CalendarDays size={24} />
          </div>
          <span className="text-xl font-display font-extrabold text-ink tracking-tight">Agenda Logo</span>
        </div>
        <h1 className="mt-6 text-2xl font-extrabold text-ink">Vamos configurar seu negócio</h1>
        <p className="mt-1.5 text-sm text-sub">
          Leva menos de 1 minuto. Você poderá alterar tudo depois nas configurações.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Seu nome">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Ana Souza" />
          </Field>
          <Field label="Nome do negócio">
            <Input required value={form.business} onChange={(e) => set('business', e.target.value)} placeholder="Ex.: Studio Ana Beleza" />
          </Field>
          <Field label="Categoria do negócio">
            <Select required value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Selecione...</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="WhatsApp" hint="Seus clientes serão atendidos por este número">
            <PhoneInput value={form.whatsapp} onChange={(v) => set('whatsapp', v)} />
          </Field>
          <Field label="Descrição" hint="Aparece na sua página pública de agendamento">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Conte um pouco sobre seu trabalho..." />
          </Field>
          <Button size="lg" className="w-full" loading={saving} type="submit">
            Criar meu negócio
          </Button>
        </form>
      </Card>
    </div>
  );
}
