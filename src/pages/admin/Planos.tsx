import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Field, Input, Modal, PageHeader, Select, Toggle, cx } from '../../components/ui';
import { brl } from '../../lib/utils';

type Plan = {
  id: string;
  name: string;
  price: number;
  period: string;
  max_professionals: number | null;
  max_clients: number | null;
  max_appointments: number | null;
  features: Record<string, boolean>;
  active: boolean;
  sort: number;
};

const FEATURES = [
  'dashboard', 'clients', 'services', 'professionals', 'commissions', 'reports',
  'anamnese', 'cashflow', 'link_publico', 'catalog', 'produtos', 'promocoes',
  'pacotes', 'pedidos', 'orcamentos', 'whatsapp', 'call_blocker', 'integrations',
  'google_calendar', 'ambassadors',
];

const FEATURE_LABELS: Record<string, string> = {
  dashboard: 'Início (Dashboard)',
  clients: 'Clientes',
  services: 'Serviços',
  professionals: 'Profissionais (equipe)',
  commissions: 'Comissões',
  reports: 'Relatórios',
  anamnese: 'Anamnese',
  cashflow: 'Fluxo de caixa',
  link_publico: 'Link público de agendamento',
  catalog: 'Catálogo (menu)',
  produtos: 'Produtos',
  promocoes: 'Promoções',
  pacotes: 'Pacotes',
  pedidos: 'Pedidos',
  orcamentos: 'Orçamentos',
  whatsapp: 'WhatsApp integrado (mensagens automáticas)',
  call_blocker: 'WhatsApp Call Blocker (bloqueio de ligações)',
  integrations: 'Integrações (em breve)',
  google_calendar: 'Google Calendar',
  ambassadors: 'Embaixadores (indicações)',
};

const empty = {
  id: '', name: '', price: 0, period: 'month', max_professionals: 1, max_clients: 50,
  max_appointments: 100, features: {
    dashboard: true, clients: true, services: true, professionals: true, commissions: true, reports: false,
    anamnese: true, cashflow: true, link_publico: true, catalog: true, produtos: true, promocoes: true,
    pacotes: true, pedidos: true, orcamentos: true, whatsapp: false, call_blocker: false,
    integrations: false, google_calendar: false, ambassadors: false,
  } as Record<string, boolean>,
  active: true, sort: 5,
};

export default function AdminPlanos() {
  const { toast } = useApp();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Plan>({ ...empty });
  const [deleting, setDeleting] = useState<Plan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('plans').select('*').order('sort');
    setPlans(((data ?? []) as Plan[]).map((p) => ({ ...p, features: p.features ?? {} })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim()) { toast('error', 'Informe o nome do plano.'); return; }
    const payload: Record<string, unknown> = { ...form };
    delete payload.id;
    let err;
    if (editingId) ({ error: err } = await supabase.from('plans').update(payload).eq('id', editingId));
    else ({ error: err } = await supabase.from('plans').insert(payload));
    if (err) { toast('error', 'Erro: ' + err.message); return; }
    toast('success', 'Plano salvo!');
    setModal(false);
    load();
  };

  return (
    <div className="fade-up">
      <PageHeader
        title="Planos"
        subtitle="Configure os planos oferecidos aos clientes"
        right={<Button onClick={() => { setEditingId(null); setForm({ ...empty }); setModal(true); }}><Plus size={18} /> Novo plano</Button>}
      />
      {loading ? <p className="text-sm text-sub py-10 text-center">Carregando...</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className="p-6">
              <div className="flex items-center justify-between">
                <p className="font-extrabold text-ink text-lg">{p.name}</p>
                <Toggle checked={p.active} onChange={async (v) => { await supabase.from('plans').update({ active: v }).eq('id', p.id); load(); }} />
              </div>
              <p className="mt-1"><span className="text-2xl font-extrabold text-ink">{p.price === 0 ? 'Grátis' : brl(p.price)}</span><span className="text-sm text-sub font-semibold"> /{p.period === 'month' ? 'mês' : 'ano'}</span></p>
              <p className="text-xs text-sub mt-2 font-semibold">
                {p.max_professionals ?? '∞'} profissionais · {p.max_clients ?? '∞'} clientes · {p.max_appointments ?? '∞'} agendamentos
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {FEATURES.filter((f) => p.features?.[f]).map((f) => (
                  <Badge key={f} className="bg-brand-50 text-brand-700">{FEATURE_LABELS[f] ?? f}</Badge>
                ))}
              </div>
              <div className="flex justify-end gap-1 mt-4 pt-4 border-t border-slate-100">
                <button onClick={() => { setEditingId(p.id); setForm({ ...empty, ...p, features: { ...empty.features, ...p.features } }); setModal(true); }} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><Pencil size={16} /></button>
                <button onClick={() => setDeleting(p)} className="p-2 rounded-xl hover:bg-rose-50 text-rose-500"><Trash2 size={16} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editingId ? 'Editar plano' : 'Novo plano'} wide>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Preço (R$)"><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} /></Field>
          <Field label="Periodicidade">
            <Select value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}>
              <option value="month">Mensal</option>
              <option value="year">Anual</option>
            </Select>
          </Field>
          <Field label="Ordem"><Input type="number" value={form.sort} onChange={(e) => setForm((f) => ({ ...f, sort: Number(e.target.value) }))} /></Field>
          <Field label="Máx. profissionais"><Input type="number" value={form.max_professionals ?? 0} onChange={(e) => setForm((f) => ({ ...f, max_professionals: Number(e.target.value) || null }))} /></Field>
          <Field label="Máx. clientes" hint="0 = ilimitado"><Input type="number" value={form.max_clients ?? 0} onChange={(e) => setForm((f) => ({ ...f, max_clients: Number(e.target.value) || null }))} /></Field>
          <Field label="Máx. agendamentos" hint="0 = ilimitado" className="col-span-2"><Input type="number" value={form.max_appointments ?? 0} onChange={(e) => setForm((f) => ({ ...f, max_appointments: Number(e.target.value) || null }))} /></Field>
          <div className="col-span-2">
            <p className="text-sm font-bold text-ink mb-2">Recursos incluídos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FEATURES.map((f) => (
                <label key={f} className={cx('flex items-center gap-3 border rounded-2xl px-4 py-3 text-sm font-semibold cursor-pointer', form.features[f] ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}>
                  <input type="checkbox" checked={!!form.features[f]} onChange={(e) => setForm((x) => ({ ...x, features: { ...x.features, [f]: e.target.checked } }))} className="accent-brand-600 w-4 h-4" />
                  {FEATURE_LABELS[f] ?? f}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-sub mt-2">O que não for marcado fica bloqueado e cinza para as empresas nesse plano.</p>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
          <Button className="flex-1" onClick={save}>Salvar</Button>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title={`Excluir plano "${deleting?.name}"?`}
        onConfirm={async () => { await supabase.from('plans').delete().eq('id', deleting!.id); toast('success', 'Plano excluído.'); load(); }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
