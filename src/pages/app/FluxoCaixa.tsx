import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CalendarDays, Plus, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, Modal, Select, cx } from '../../components/ui';
import { MoneyInput } from '../../components/MoneyInput';
import { brl, toLocalInput } from '../../lib/utils';

type Tx = {
  id: string;
  kind: 'entrada' | 'saida';
  origin: 'agendamento' | 'pedido' | 'manual';
  description: string;
  amount: number;
  occurred_at: string;
};

const ORIGIN_LABEL: Record<string, string> = {
  agendamento: 'Agendamento',
  pedido: 'Pedido',
  manual: 'Manual',
};

export default function FluxoCaixa() {
  const { company, toast } = useApp();
  const [loading, setLoading] = useState(true);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [kindFilter, setKindFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ description: string; kind: 'entrada' | 'saida'; amount: number | ''; date: string }>({ description: '', kind: 'entrada', amount: '', date: toLocalInput(new Date()).slice(0, 10) });

  const load = async () => {
    if (!company) return;
    setLoading(true);
    const { data } = await supabase.from('cash_transactions').select('*').eq('company_id', company.id).order('occurred_at', { ascending: false }).order('created_at', { ascending: false });
    setTxs((data ?? []) as Tx[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [company?.id]);

  const filtered = useMemo(() => {
    return txs.filter((t) => (t.occurred_at || '').startsWith(month) && (!kindFilter || t.kind === kindFilter));
  }, [txs, month, kindFilter]);

  const entradas = filtered.filter((t) => t.kind === 'entrada').reduce((s, t) => s + Number(t.amount), 0);
  const saidas = filtered.filter((t) => t.kind === 'saida').reduce((s, t) => s + Number(t.amount), 0);
  const saldo = entradas - saidas;

  // Detalhamento diário do mês selecionado
  const daily = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const map = new Map<number, { entrada: number; saida: number }>();
    for (let d = 1; d <= daysInMonth; d++) map.set(d, { entrada: 0, saida: 0 });
    for (const t of filtered) {
      const day = Number((t.occurred_at || '').slice(8, 10));
      const row = map.get(day);
      if (row) row[t.kind] += Number(t.amount);
    }
    return Array.from(map.entries()).map(([day, v]) => ({ day, ...v }));
  }, [filtered]);

  const dailyMax = Math.max(...daily.map((d) => Math.max(d.entrada, d.saida)), 1);
  const todayIso = toLocalInput(new Date()).slice(0, 10);
  const todayDay = Number(todayIso.slice(8, 10));
  const monthIsCurrent = month === todayIso.slice(0, 7);
  const daysWithMovement = daily.filter((d) => d.entrada > 0 || d.saida > 0).length;

  const save = async () => {
    if (!company) return;
    const amount = Number(form.amount) || 0;
    if (!form.description.trim() || !amount || amount <= 0) {
      toast('error', 'Preencha descrição e valor.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('cash_transactions').insert({
      company_id: company.id,
      kind: form.kind,
      origin: 'manual',
      description: form.description.trim(),
      amount,
      occurred_at: form.date,
    });
    setSaving(false);
    if (error) {
      toast('error', 'Erro ao salvar lançamento.');
      return;
    }
    toast('success', 'Lançamento adicionado!');
    setModal(false);
    setForm({ description: '', kind: 'entrada', amount: '', date: toLocalInput(new Date()).slice(0, 10) });
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('cash_transactions').delete().eq('id', id);
    if (!error) toast('success', 'Lançamento removido.');
    setDeleting(null);
    load();
  };

  return (
    <div className="fade-up pb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">Fluxo de caixa</h1>
          <p className="text-sm text-sub mt-0.5">Entradas, saídas e saldo do seu negócio.</p>
        </div>
        <Button onClick={() => setModal(true)}><Plus size={17} /> Novo lançamento</Button>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-5 mb-4">
        <Card className="p-3 sm:p-4">
          <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center bg-emerald-50 text-emerald-600 mb-2"><ArrowUpCircle size={16} /></span>
          <p className="text-[11px] sm:text-xs font-semibold text-sub">Entradas</p>
          <p className="text-base sm:text-xl font-extrabold text-emerald-700">{brl(entradas)}</p>
        </Card>
        <Card className="p-3 sm:p-4">
          <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center bg-rose-50 text-rose-500 mb-2"><ArrowDownCircle size={16} /></span>
          <p className="text-[11px] sm:text-xs font-semibold text-sub">Saídas</p>
          <p className="text-base sm:text-xl font-extrabold text-rose-600">{brl(saidas)}</p>
        </Card>
        <Card className="p-3 sm:p-4">
          <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center bg-brand-50 text-brand-600 mb-2"><Wallet size={16} /></span>
          <p className="text-[11px] sm:text-xs font-semibold text-sub">Saldo</p>
          <p className={cx('text-base sm:text-xl font-extrabold', saldo >= 0 ? 'text-ink' : 'text-rose-600')}>{brl(saldo)}</p>
        </Card>
      </div>

      <Card className="p-3 sm:p-4 mb-4 flex flex-wrap items-center gap-3">
        <Field label="Mês" className="!mb-0">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Field label="Tipo" className="!mb-0">
          <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="!h-11 !w-40">
            <option value="">Todos</option>
            <option value="entrada">Entradas</option>
            <option value="saida">Saídas</option>
          </Select>
        </Field>
      </Card>

      {/* Gráfico diário */}
      <Card className="p-3 sm:p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div>
            <p className="text-sm font-extrabold text-ink">Detalhes diários</p>
            <p className="text-[11px] text-sub">{daysWithMovement === 0 ? 'Sem movimento neste mês' : `${daysWithMovement} dia(s) com movimento`}</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-bold">
            <span className="flex items-center gap-1 text-emerald-600"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Entradas</span>
            <span className="flex items-center gap-1 text-rose-500"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400 inline-block" /> Saídas</span>
          </div>
        </div>
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <div className="flex items-end justify-between min-w-full" style={{ height: 150, gap: 1 }}>
            {daily.map((d) => {
              const hIn = (d.entrada / dailyMax) * 118;
              const hOut = (d.saida / dailyMax) * 118;
              const isToday = monthIsCurrent && d.day === todayDay;
              const tip = `Dia ${d.day}\nEntradas: ${brl(d.entrada)}\nSaídas: ${brl(d.saida)}\nSaldo: ${brl(d.entrada - d.saida)}`;
              return (
                <div key={d.day} className="flex flex-col items-center justify-end" style={{ width: 100 / daily.length + '%', minWidth: 10 }} title={tip}>
                  <div className="w-full flex items-end justify-center" style={{ height: 122, gap: 1 }}>
                    <div
                      className={cx('flex-1 max-w-2.5 rounded-t-[3px] transition-all', d.entrada > 0 ? 'bg-emerald-500' : 'bg-slate-100')}
                      style={{ height: Math.max(hIn, d.entrada > 0 ? 4 : 2) }}
                    />
                    <div
                      className={cx('flex-1 max-w-2.5 rounded-t-[3px] transition-all', d.saida > 0 ? 'bg-rose-400' : 'bg-slate-100')}
                      style={{ height: Math.max(hOut, d.saida > 0 ? 4 : 2) }}
                    />
                  </div>
                  <span className={cx('text-[8px] font-bold mt-1', isToday ? 'text-brand-600' : 'text-slate-400')}>{d.day}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="py-10 text-center text-sm text-sub">Carregando...</div>
      ) : filtered.length === 0 ? (
        <Empty icon={<Wallet size={26} />} title="Nenhum lançamento no período" subtitle="Finalize atendimentos ou registre lançamentos manuais." />
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {filtered.map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-center gap-3">
              <span className={cx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', t.kind === 'entrada' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500')}>
                {t.kind === 'entrada' ? <ArrowUpCircle size={18} /> : <ArrowDownCircle size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink truncate">{t.description}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cx(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                    t.origin === 'agendamento' && 'bg-brand-50 text-brand-700',
                    t.origin === 'pedido' && 'bg-blue-50 text-blue-600',
                    t.origin === 'manual' && 'bg-slate-100 text-slate-500',
                  )}>{ORIGIN_LABEL[t.origin] ?? t.origin}</span>
                  <span className="text-[11px] text-slate-400">{t.occurred_at.split('-').reverse().join('/')}</span>
                </div>
              </div>
              <p className={cx('text-sm font-extrabold shrink-0', t.kind === 'entrada' ? 'text-emerald-700' : 'text-rose-600')}>
                {t.kind === 'entrada' ? '+' : '−'} {brl(Number(t.amount))}
              </p>
              <button onClick={() => setDeleting(t.id)} className="p-2 rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-500 shrink-0" aria-label="Excluir lançamento">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Novo lançamento">
        <div className="space-y-4">
          <Field label="Descrição">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex.: Venda de produto, aluguel, compra..." />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'entrada' | 'saida' })}>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
              </Select>
            </Field>
            <Field label="Valor (R$)">
              <MoneyInput
                value={form.amount || 0}
                onChange={(v) => setForm({ ...form, amount: v })}
                placeholder="R$ 0,00"
              />
            </Field>
          </div>
          <Field label="Data">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
            <Button className="flex-1" loading={saving} onClick={save}>Salvar</Button>
          </div>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title="Excluir lançamento?"
        message="Esta ação não pode ser desfeita. O valor será removido do saldo do caixa."
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}
