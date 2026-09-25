import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Copy, Check, Phone, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, Modal, PageHeader, Select, Toggle, cx } from '../../components/ui';
import { WEEKDAYS_SHORT, brl, randomCode } from '../../lib/utils';

type Prof = {
  id: string;
  name: string;
  photo_url: string | null;
  phone: string | null;
  email: string | null;
  specialty: string | null;
  commission: number;
  workdays: number[];
  start_time: string;
  end_time: string;
  status: string;
  invite_code: string | null;
};

const empty = {
  id: '', name: '', phone: '', email: '', specialty: '', commission: '',
  workdays: [1, 2, 3, 4, 5] as number[], start_time: '09:00', end_time: '18:00', status: 'active',
};

export default function Profissionais() {
  const { company, toast } = useApp();
  const [profs, setProfs] = useState<Prof[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Prof | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const { data } = await supabase.from('professionals').select('*').eq('company_id', company.id).order('position');
    setProfs(((data ?? []) as unknown as Prof[]).map((p) => ({ ...p, workdays: (p.workdays ?? []) as number[] })));
    setLoading(false);
  }, [company]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim()) { toast('error', 'Informe o nome.'); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: form.name, phone: form.phone, email: form.email, specialty: form.specialty,
      commission: Number(form.commission) || 0, workdays: form.workdays,
      start_time: form.start_time, end_time: form.end_time, status: form.status,
    };
    let err;
    if (editingId) ({ error: err } = await supabase.from('professionals').update(payload).eq('id', editingId));
    else ({ error: err } = await supabase.from('professionals').insert({ ...payload, company_id: company!.id, position: profs.length + 1, invite_code: randomCode() }));
    setSaving(false);
    if (err) { toast('error', 'Erro: ' + err.message); return; }
    toast('success', 'Profissional salvo!');
    setModal(false);
    load();
  };

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    toast('success', 'Código copiado!');
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fade-up">
      <PageHeader
        title="Profissionais"
        subtitle="Sua equipe e horários de trabalho"
        right={<Button onClick={() => { setEditingId(null); setForm({ ...empty }); setModal(true); }}><Plus size={18} /> Novo</Button>}
      />

      {loading ? (
        <p className="text-sm text-sub py-10 text-center">Carregando...</p>
      ) : profs.length === 0 ? (
        <Empty title="Nenhum profissional" subtitle="Adicione profissionais para distribuir a agenda." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {profs.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center font-extrabold text-lg shrink-0">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-ink truncate">{p.name}</p>
                  <p className="text-xs text-sub truncate">{p.specialty || 'Profissional'}</p>
                </div>
                <Badge className={cx('ml-auto', p.status === 'active' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>
                  {p.status === 'active' ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500 font-semibold">
                {p.phone && <p className="flex items-center gap-1.5"><Phone size={12} /> {p.phone}</p>}
                {p.email && <p className="flex items-center gap-1.5"><Mail size={12} /> {p.email}</p>}
              </div>
              <div className="flex flex-wrap gap-1 mt-3">
                {p.workdays.sort().map((d) => (
                  <span key={d} className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold flex items-center justify-center">
                    {WEEKDAYS_SHORT[d]}
                  </span>
                ))}
                <span className="text-[11px] text-slate-400 font-bold self-center ml-1">{p.start_time}–{p.end_time}</span>
              </div>
              <p className="text-xs font-bold text-brand-700 mt-2">Comissão: {p.commission}%</p>
              {p.invite_code && (
                <button onClick={() => copy(p.invite_code!)} className="mt-3 w-full flex items-center justify-between gap-2 bg-slate-50 rounded-2xl px-3.5 py-2.5 hover:bg-slate-100 transition">
                  <span className="text-left">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Código de convite</span>
                    <span className="text-sm font-extrabold text-ink tracking-widest">{p.invite_code}</span>
                  </span>
                  {copied === p.invite_code ? <Check size={16} className="text-brand-600" /> : <Copy size={16} className="text-slate-400" />}
                </button>
              )}
              <p className="text-[11px] text-slate-400 mt-1.5">Use este código para entrar na equipe.</p>
              <div className="flex justify-end gap-1 mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => { setEditingId(p.id); setForm({ ...empty, ...p, commission: p.commission ? String(p.commission) : '', phone: p.phone ?? '', email: p.email ?? '', specialty: p.specialty ?? '' }); setModal(true); }} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><Pencil size={16} /></button>
                <button onClick={() => setDeleting(p)} className="p-2 rounded-xl hover:bg-rose-50 text-rose-500"><Trash2 size={16} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editingId ? 'Editar profissional' : 'Novo profissional'} wide>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome" className="col-span-2">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="E-mail">
            <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Especialidade">
            <Input value={form.specialty} onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))} />
          </Field>
          <Field label="Comissão (%)" hint="Deixe vazio para 0%">
            <Input
              type="text" inputMode="numeric" placeholder="Ex.: 10"
              value={form.commission}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setForm((f) => ({ ...f, commission: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
            />
          </Field>
          <Field label="Início do expediente">
            <Input type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
          </Field>
          <Field label="Fim do expediente">
            <Input type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
          </Field>
          <Field label="Dias de trabalho" className="col-span-2">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS_SHORT.map((d, i) => {
                const on = form.workdays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, workdays: on ? f.workdays.filter((x) => x !== i) : [...f.workdays, i] }))}
                    className={cx('w-11 h-11 rounded-2xl text-sm font-bold border transition', on ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-400')}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </Select>
          </Field>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
          <Button className="flex-1" loading={saving} onClick={save}>Salvar</Button>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title={`Excluir ${deleting?.name}?`}
        message="Os agendamentos vinculados ficarão sem profissional."
        onConfirm={async () => { await supabase.from('professionals').delete().eq('id', deleting!.id); toast('success', 'Profissional excluído.'); load(); }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
