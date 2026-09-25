import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronLeft, ChevronRight, Clock, X, Pencil, Trash2, User, Sparkles, Lock, CalendarOff, AlertTriangle, Scissors } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, Modal, Select, Textarea, Toggle, cx } from '../../components/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { MoneyInput } from '../../components/MoneyInput';
import { APPT_STATUS, WEEKDAYS_SHORT, brl, fmtTime, statusColor, statusLabel, toLocalInput } from '../../lib/utils';

type Appt = {
  id: string;
  client_id: string | null;
  professional_id: string | null;
  service_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  price: number;
  notes: string | null;
  source: string;
  clients: { name: string; whatsapp: string | null } | null;
  professionals: { name: string } | null;
  services: { name: string } | null;
};

type Client = { id: string; name: string; whatsapp: string | null };
type Prof = { id: string; name: string };
type Svc = { id: string; name: string; price: number; duration_min: number };
type Block = { id: string; block_date: string; reason: string | null; start_time: string | null; end_time: string | null };
type Hours = { weekday: number; is_open: boolean; start_time: string; end_time: string };

const emptyForm = {
  id: '',
  client_id: '',
  new_client: false,
  client_name: '',
  client_whatsapp: '',
  service_id: '',
  professional_id: '',
  date: '',
  time: '',
  duration: 60,
  price: 0,
  status: 'agendado',
  notes: '',
};

export default function Agenda() {
  const { company, toast } = useApp();
  const [view, setView] = useState<'dia' | 'semana' | 'mes'>('dia');
  const [cursor, setCursor] = useState(new Date());
  const [appts, setAppts] = useState<Appt[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [svcs, setSvcs] = useState<Svc[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Appt | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [profFilter, setProfFilter] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [hours, setHours] = useState<Hours[]>([]);
  const [blockModal, setBlockModal] = useState(false);
  const [blockForm, setBlockForm] = useState({ from: '', to: '', all_day: true, start: '08:00', end: '18:00', reason: '' });
  const [savingBlock, setSavingBlock] = useState(false);

  const weekStart = (d: Date) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // segunda = 0
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const range = useMemo(() => {
    const s = new Date(cursor);
    const e = new Date(cursor);
    if (view === 'dia') {
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
    } else if (view === 'semana') {
      const ws = weekStart(cursor);
      ws.setHours(0, 0, 0, 0);
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      we.setHours(0, 0, 0, 0);
      return { start: ws, end: we };
    } else {
      s.setDate(1);
      s.setHours(0, 0, 0, 0);
      e.setMonth(e.getMonth() + 1, 0);
      e.setHours(23, 59, 59, 999);
    }
    return { start: s, end: e };
  }, [cursor, view]);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('appointments')
      .select('*, clients(name,whatsapp), professionals(name), services(name)')
      .eq('company_id', company.id)
      .gte('starts_at', range.start.toISOString())
      .lte('starts_at', range.end.toISOString())
      .order('starts_at');
    if (error) toast('error', 'Erro ao carregar agenda');
    setAppts(((data ?? []) as unknown) as Appt[]);
    setLoading(false);
  }, [company, range, toast]);

  const loadMeta = useCallback(async () => {
    if (!company) return;
    const [c, p, s] = await Promise.all([
      supabase.from('clients').select('id,name,whatsapp').eq('company_id', company.id).order('name'),
      supabase.from('professionals').select('id,name').eq('company_id', company.id).eq('status', 'active').order('position'),
      supabase.from('services').select('id,name,price,duration_min').eq('company_id', company.id).eq('active', true).order('position'),
    ]);
    setClients((c.data ?? []) as Client[]);
    setProfs((p.data ?? []) as Prof[]);
    setSvcs((s.data ?? []) as Svc[]);
  }, [company]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  // Bloqueios de agenda + expediente
  const loadBlocks = useCallback(async () => {
    if (!company) return;
    const [b, h] = await Promise.all([
      supabase.from('date_blocks').select('id,block_date,reason,start_time,end_time')
        .eq('company_id', company.id)
        .gte('block_date', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
        .order('block_date'),
      supabase.from('business_hours').select('weekday,is_open,start_time,end_time').eq('company_id', company.id),
    ]);
    setBlocks((b.data ?? []) as Block[]);
    setHours((h.data ?? []) as Hours[]);
  }, [company]);
  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  const dayBlocks = (k: string) => blocks.filter((b) => b.block_date === k);
  const hoursOf = (d: Date) => hours.find((x) => x.weekday === d.getDay());
  const dayClosed = (d: Date) => {
    const hb = hoursOf(d);
    return !hb?.is_open || dayBlocks(toLocalInput(d).slice(0, 10)).some((b) => !b.start_time);
  };

  const saveBlock = async () => {
    if (!company) return;
    if (!blockForm.from) { toast('error', 'Escolha a data inicial.'); return; }
    const from = new Date(blockForm.from + 'T00:00:00');
    const to = blockForm.to ? new Date(blockForm.to + 'T00:00:00') : from;
    if (to < from) { toast('error', 'A data final é antes da inicial.'); return; }
    if ((to.getTime() - from.getTime()) / 864e5 > 90) { toast('error', 'Período muito longo (máx. 90 dias).'); return; }
    if (!blockForm.all_day && blockForm.start >= blockForm.end) { toast('error', 'O horário final deve ser depois do inicial.'); return; }
    setSavingBlock(true);
    const rows: Record<string, unknown>[] = [];
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      rows.push({
        company_id: company.id,
        block_date: toLocalInput(d).slice(0, 10),
        reason: blockForm.reason || null,
        start_time: blockForm.all_day ? null : blockForm.start,
        end_time: blockForm.all_day ? null : blockForm.end,
      });
    }
    const { error } = await supabase.from('date_blocks').insert(rows);
    setSavingBlock(false);
    if (error) {
      if (error.code === '23505') { toast('error', 'Esse bloqueio já existe.'); await loadBlocks(); return; }
      toast('error', 'Erro ao bloquear: ' + error.message);
      return;
    }
    toast('success', blockForm.all_day ? 'Agenda bloqueada no período.' : 'Horário bloqueado no período.');
    setBlockModal(false);
    setBlockForm({ from: '', to: '', all_day: true, start: '08:00', end: '18:00', reason: '' });
    loadBlocks();
  };

  const removeBlock = async (id: string) => {
    await supabase.from('date_blocks').delete().eq('id', id);
    loadBlocks();
    toast('success', 'Bloqueio removido.');
  };

  const filtered = useMemo(
    () => (profFilter ? appts.filter((a) => a.professional_id === profFilter) : appts),
    [appts, profFilter],
  );

  const openNew = (date?: Date) => {
    const d = date ?? new Date();
    setEditingId(null);
    setForm({ ...emptyForm, date: toLocalInput(d).slice(0, 10), time: toLocalInput(d).slice(11, 16) });
    setModal(true);
  };

  const openEdit = (a: Appt) => {
    setEditingId(a.id);
    setForm({
      id: a.id,
      client_id: a.client_id ?? '',
      new_client: false,
      client_name: '',
      client_whatsapp: '',
      service_id: a.service_id ?? '',
      professional_id: a.professional_id ?? '',
      date: toLocalInput(new Date(a.starts_at)).slice(0, 10),
      time: toLocalInput(new Date(a.starts_at)).slice(11, 16),
      duration: Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000),
      price: a.price,
      status: a.status,
      notes: a.notes ?? '',
    });
    setModal(true);
  };

  const pickService = (id: string) => {
    const s = svcs.find((x) => x.id === id);
    setForm((f) => ({ ...f, service_id: id, duration: s?.duration_min ?? f.duration, price: s?.price ?? f.price }));
  };

  const save = async () => {
    if (!company) return;
    if (!form.date || !form.time) { toast('error', 'Informe data e horário.'); return; }
    if (!form.service_id) { toast('error', 'Selecione um serviço.'); return; }
    if (!form.professional_id) { toast('error', 'Selecione um profissional.'); return; }
    setSaving(true);
    try {
      let clientId = form.client_id;
      if (form.new_client || (!clientId && form.client_name)) {
        if (!form.client_name.trim()) { toast('error', 'Informe o nome do cliente.'); setSaving(false); return; }
        const { data: existing } = await supabase
          .from('clients')
          .select('id')
          .eq('company_id', company.id)
          .eq('whatsapp', form.client_whatsapp || '---')
          .maybeSingle();
        if (existing) clientId = existing.id;
        else {
          const { data: nc, error: ce } = await supabase
            .from('clients')
            .insert({ company_id: company.id, name: form.client_name, whatsapp: form.client_whatsapp })
            .select('id')
            .single();
          if (ce) throw ce;
          clientId = nc.id;
        }
      }
      if (!clientId) { toast('error', 'Selecione ou cadastre o cliente.'); setSaving(false); return; }

      const starts = new Date(`${form.date}T${form.time}`);
      const ends = new Date(starts.getTime() + form.duration * 60000);
      const payload = {
        company_id: company.id,
        client_id: clientId,
        professional_id: form.professional_id,
        service_id: form.service_id,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        status: form.status,
        price: Number(form.price) || 0,
        notes: form.notes,
      };
      let err;
      if (editingId) ({ error: err } = await supabase.from('appointments').update(payload).eq('id', editingId));
      else ({ error: err } = await supabase.from('appointments').insert(payload));
      if (err) throw err;
      toast('success', editingId ? 'Agendamento atualizado!' : 'Agendamento criado!');
      setModal(false);
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast('error', msg.includes('no_double_booking') ? 'Este profissional já possui atendimento nesse horário.' : 'Erro: ' + msg);
    }
    setSaving(false);
  };

  const setStatus = async (a: Appt, status: string) => {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', a.id);
    if (error) toast('error', 'Erro ao atualizar status');
    else { toast('success', `Status: ${statusLabel(status)}`); setDetail(null); load(); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    await supabase.from('appointments').delete().eq('id', deleting);
    toast('success', 'Agendamento excluído.');
    setDetail(null);
    load();
  };

  const move = (dir: number) => {
    const d = new Date(cursor);
    if (view === 'dia') d.setDate(d.getDate() + dir);
    else if (view === 'semana') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };

  const label = useMemo(() => {
    const opts: Intl.DateTimeFormatOptions =
      view === 'dia'
        ? { weekday: 'long', day: '2-digit', month: 'long' }
        : view === 'semana'
          ? { day: '2-digit', month: 'short' }
          : { month: 'long', year: 'numeric' };
    if (view === 'semana') {
      const s = weekStart(cursor);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      return `${s.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${e.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
    return cursor.toLocaleDateString('pt-BR', opts);
  }, [cursor, view]);

  const byDay = useMemo(() => {
    const map = new Map<string, Appt[]>();
    for (const a of filtered) {
      const k = toLocalInput(new Date(a.starts_at)).slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), a]);
    }
    return map;
  }, [filtered]);

  const totalPeriodo = useMemo(
    () => filtered.filter((a) => !['cancelado', 'faltou'].includes(a.status)).reduce((s, a) => s + a.price, 0),
    [filtered],
  );

  return (
    <div className="fade-up">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-2xl font-extrabold text-ink tracking-tight mr-auto">Agenda</h1>
        <div className="flex bg-slate-100 rounded-2xl p-1">
          {(['dia', 'semana', 'mes'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cx('px-4 h-9 rounded-xl text-sm font-bold capitalize transition', view === v ? 'bg-white shadow text-brand-700' : 'text-slate-500')}
            >
              {v === 'mes' ? 'Mês' : v}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => setBlockModal(true)}><Lock size={16} /> Fechar Agenda</Button>
        <Button onClick={() => openNew()} className="hidden sm:inline-flex"><Plus size={18} /> Novo agendamento</Button>
      </div>

      <div className="relative">
        <Card className="p-3 sm:p-4 mb-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => move(-1)} className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-500"><ChevronLeft size={20} /></button>
            <button onClick={() => move(1)} className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-500"><ChevronRight size={20} /></button>
          </div>
          <p className="font-bold text-ink capitalize">{label}</p>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Hoje</Button>
          <div className="ml-auto flex items-center gap-3">
            <Select value={profFilter} onChange={(e) => setProfFilter(e.target.value)} className="!h-10 !w-44 !text-sm">
              <option value="">Todos profissionais</option>
              {profs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <div className="hidden md:block text-right">
              <p className="text-[11px] font-semibold text-sub">Previsto no período</p>
              <p className="text-sm font-extrabold text-brand-700">{brl(totalPeriodo)}</p>
            </div>
          </div>
        </Card>

        {/* FAB mobile — pertence à área da agenda e rola junto com o conteúdo */}
        <button
          onClick={() => openNew()}
          className="sm:hidden absolute -bottom-7 right-5 z-30 w-14 h-14 rounded-full bg-brand-600 text-white shadow-xl flex items-center justify-center active:scale-95 transition"
          aria-label="Novo agendamento"
        >
          <Plus size={26} />
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sub text-sm">Carregando agenda...</div>
      ) : view === 'dia' ? (
        <DayView appts={filtered} date={cursor} blocks={blocks} hours={hours} onOpen={setDetail} />
      ) : view === 'semana' ? (
        <WeekView weekStart={weekStart(cursor)} byDay={byDay} blocks={blocks} hours={hours} onDay={(d) => { setCursor(d); setView('dia'); }} onOpen={setDetail} />
      ) : (
        <MonthView cursor={cursor} byDay={byDay} blocks={blocks} hours={hours} onDay={(d) => { setCursor(d); setView('dia'); }} />
      )}

      {/* Modal bloquear agenda */}
      <Modal open={blockModal} onClose={() => setBlockModal(false)} title="Fechar agenda">
        <p className="text-sm text-sub mb-4">Feche dias ou horários em que você não vai atender. O agendamento online fica indisponível nesses períodos.</p>
        <div className="space-y-3">
          <Field label="De">
            <Input type="date" value={blockForm.from} onChange={(e) => setBlockForm((f) => ({ ...f, from: e.target.value }))} />
          </Field>
          <Field label="Até (opcional)">
            <Input type="date" value={blockForm.to} min={blockForm.from} onChange={(e) => setBlockForm((f) => ({ ...f, to: e.target.value }))} />
          </Field>
          <div className="flex items-center gap-3">
            <Toggle checked={blockForm.all_day} onChange={(v) => setBlockForm((f) => ({ ...f, all_day: v }))} />
            <span className="text-sm font-semibold text-sub">Dia inteiro</span>
          </div>
          {!blockForm.all_day && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Das">
                <Input type="time" value={blockForm.start} onChange={(e) => setBlockForm((f) => ({ ...f, start: e.target.value }))} />
              </Field>
              <Field label="Até">
                <Input type="time" value={blockForm.end} onChange={(e) => setBlockForm((f) => ({ ...f, end: e.target.value }))} />
              </Field>
            </div>
          )}
          <Field label="Motivo (opcional)">
            <Input placeholder="Ex.: compromisso pessoal, férias..." value={blockForm.reason} onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
          {blocks.length > 0 && (
            <div>
              <p className="text-xs font-bold text-sub mb-1.5">Bloqueios ativos</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {blocks.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                    <Lock size={12} className="text-slate-400 shrink-0" />
                    <span className="text-xs font-bold text-ink">
                      {b.block_date.slice(8, 10)}/{b.block_date.slice(5, 7)}/{b.block_date.slice(0, 4)}
                      {b.start_time ? ` · ${b.start_time.slice(0, 5)}–${b.end_time?.slice(0, 5)}` : ' · dia inteiro'}
                    </span>
                    {b.reason && <span className="text-xs text-sub truncate">{b.reason}</span>}
                    <button onClick={() => removeBlock(b.id)} className="ml-auto p-1 rounded-full hover:bg-rose-100 text-rose-500"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => setBlockModal(false)}>Cancelar</Button>
            <Button className="flex-1" loading={savingBlock} onClick={saveBlock}><Lock size={16} /> Fechar agenda</Button>
          </div>
        </div>
      </Modal>

      {/* Modal criar/editar */}
      <Modal open={modal} onClose={() => setModal(false)} title={editingId ? 'Editar agendamento' : 'Novo agendamento'} wide>
        <div className="grid grid-cols-2 gap-4">
          {!editingId && (
            <Field label="Cliente" className="col-span-2">
              <div className="flex items-center gap-3 mb-2">
                <Toggle checked={form.new_client} onChange={(v) => setForm((f) => ({ ...f, new_client: v }))} />
                <span className="text-sm text-sub font-semibold">Cadastrar novo cliente</span>
              </div>
              {form.new_client ? (
                <div className="space-y-3">
                  <Input placeholder="Nome do cliente" value={form.client_name} onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))} />
                  <PhoneInput value={form.client_whatsapp} onChange={(v) => setForm((f) => ({ ...f, client_whatsapp: v }))} />
                </div>
              ) : (
                <Select value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>
                  <option value="">Selecione...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Serviço" className="col-span-2 sm:col-span-1">
            <Select value={form.service_id} onChange={(e) => pickService(e.target.value)}>
              <option value="">Selecione...</option>
              {svcs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            {svcs.length === 0 && (
              <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Você ainda não cadastrou nenhum serviço
                </p>
                <p className="text-[11px] text-amber-600 mt-0.5">Cadastre um serviço para criar agendamentos e receber pedidos pelo link público.</p>
                <Link to="/app/operacao/servicos?new=1" className="inline-flex items-center gap-1.5 mt-2 text-xs font-extrabold text-amber-700 hover:underline">
                  <Scissors size={13} /> Cadastrar serviço agora
                </Link>
              </div>
            )}
          </Field>
          <Field label="Profissional" className="col-span-2 sm:col-span-1">
            <Select value={form.professional_id} onChange={(e) => setForm((f) => ({ ...f, professional_id: e.target.value }))}>
              <option value="">Selecione...</option>
              {profs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Data">
            <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field label="Horário">
            <Input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
          </Field>
          <Field label="Duração (min)">
            <Input type="number" value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))} />
          </Field>
          <Field label="Valor (R$)">
            <MoneyInput value={form.price} onChange={(v) => setForm((f) => ({ ...f, price: v }))} />
            {(() => {
              const s = svcs.find((x) => x.id === form.service_id);
              if (!s) return null;
              return (
                <p className="mt-1.5 text-[11px] font-semibold text-brand-600">
                  Serviço: {s.name} · {brl(s.price)} · {s.duration_min >= 60 ? `${Math.floor(s.duration_min / 60)}h${s.duration_min % 60 ? ` ${s.duration_min % 60}min` : ''}` : `${s.duration_min}min`}
                </p>
              );
            })()}
          </Field>
          <Field label="Status" className="col-span-2">
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {APPT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Observações" className="col-span-2">
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
        <div className="sticky bottom-0 -mx-6 -mb-[calc(1.5rem+env(safe-area-inset-bottom))] mt-6 flex gap-3 bg-white/95 backdrop-blur border-t border-slate-100 px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] rounded-b-3xl">
          <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
          <Button className="flex-1" loading={saving} onClick={save}>Salvar</Button>
        </div>
      </Modal>

      {/* Modal detalhes */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalhes do agendamento">
        {detail && (
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center"><Clock size={22} /></div>
              <div>
                <p className="font-extrabold text-ink">{detail.clients?.name ?? 'Cliente'}</p>
                <p className="text-sm text-sub">{detail.services?.name ?? '—'}</p>
              </div>
              <Badge className={cx('ml-auto', statusColor(detail.status))}>{statusLabel(detail.status)}</Badge>
            </div>
            <div className="mt-5 space-y-2 text-sm">
              <p className="flex items-center gap-2 text-slate-600"><Clock size={16} className="text-slate-400" /> {new Date(detail.starts_at).toLocaleDateString('pt-BR')} às {fmtTime(detail.starts_at)} – {fmtTime(detail.ends_at)}</p>
              <p className="flex items-center gap-2 text-slate-600"><User size={16} className="text-slate-400" /> {detail.professionals?.name ?? '—'}</p>
              <p className="flex items-center gap-2 text-slate-600"><Sparkles size={16} className="text-slate-400" /> {brl(detail.price)}</p>
              {detail.source === 'online' && <p className="text-xs font-bold text-brand-600 bg-brand-50 inline-block px-2 py-1 rounded-full mt-1">Agendado online</p>}
              {detail.notes && <p className="text-sub pt-2 border-t border-slate-100 mt-2">{detail.notes}</p>}
            </div>
            <p className="text-xs font-bold text-sub uppercase tracking-wide mt-6 mb-2">Alterar status</p>
            <div className="flex flex-wrap gap-2">
              {APPT_STATUS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatus(detail, s.value)}
                  className={cx('px-3 py-2 rounded-xl text-xs font-bold transition', statusColor(s.value), detail.status === s.value ? 'ring-2 ring-offset-1 ring-brand-400' : 'opacity-70 hover:opacity-100')}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="sticky bottom-0 -mx-6 -mb-[calc(1.5rem+env(safe-area-inset-bottom))] mt-6 flex gap-3 bg-white/95 backdrop-blur border-t border-slate-100 px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] rounded-b-3xl">
              <Button variant="outline" className="flex-1" onClick={() => { openEdit(detail); setDetail(null); }}><Pencil size={16} /> Editar</Button>
              <Button variant="danger" onClick={() => { setDeleting(detail.id); }}><Trash2 size={16} /></Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirm
        open={!!deleting}
        title="Excluir agendamento?"
        message="O atendimento será removido da agenda."
        onConfirm={doDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

const STATUS_STYLE: Record<string, { card: string; dot: string; text: string }> = {
  agendado: { card: 'bg-blue-50/80 border-2 border-blue-400 hover:border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.45)]', dot: 'bg-blue-500', text: 'text-blue-900' },
  confirmado: { card: 'bg-brand-50/80 border-2 border-brand-400 hover:border-brand-500 shadow-[0_0_10px_rgba(16,185,129,0.45)]', dot: 'bg-brand-500', text: 'text-brand-900' },
  em_atendimento: { card: 'bg-amber-50/80 border-2 border-amber-400 hover:border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]', dot: 'bg-amber-500', text: 'text-amber-900' },
  concluido: { card: 'bg-slate-100/80 border-2 border-slate-400 hover:border-slate-500 shadow-[0_0_8px_rgba(100,116,139,0.35)]', dot: 'bg-slate-400', text: 'text-slate-600' },
  cancelado: { card: 'bg-rose-50/80 border-2 border-rose-400 hover:border-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.45)]', dot: 'bg-rose-400', text: 'text-rose-700' },
  faltou: { card: 'bg-orange-50/80 border-2 border-orange-400 hover:border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]', dot: 'bg-orange-400', text: 'text-orange-800' },
};

function ApptCard({ a, onOpen, compact }: { a: Appt; onOpen: (a: Appt) => void; compact?: boolean }) {
  const s = STATUS_STYLE[a.status] ?? STATUS_STYLE.agendado;
  return (
    <button
      onClick={() => onOpen(a)}
      className={cx('w-full text-left rounded-2xl border p-3 hover:shadow-sm transition', s.card, a.status === 'cancelado' && 'opacity-60', compact && 'p-2.5')}
    >
      <div className="flex items-center gap-2">
        <span className={cx('w-2 h-2 rounded-full shrink-0', s.dot)} />
        <p className={cx('font-bold text-sm truncate', compact && 'text-xs', a.status === 'cancelado' ? 'text-slate-500 line-through' : s.text)}>{a.clients?.name ?? 'Cliente'}</p>
        <span className={cx('ml-auto text-xs font-bold shrink-0', a.status === 'concluido' ? 'text-slate-400' : 'text-slate-500')}>{compact ? `${fmtTime(a.starts_at)}–${fmtTime(a.ends_at)}` : fmtTime(a.starts_at)}</span>
      </div>
      {!compact && (
        <p className={cx('text-xs mt-1 truncate', a.status === 'cancelado' ? 'text-slate-400' : 'text-slate-600/80')}>{a.services?.name ?? '—'} · {a.professionals?.name ?? '—'} · {brl(a.price)}</p>
      )}
    </button>
  );
}

const HOUR_H = 56; // px por hora na grade diária

type LaidOut = { a: Appt; start: number; end: number; col: number; cols: number };

function layoutDay(appts: Appt[]): LaidOut[] {
  const items = appts
    .map((a) => {
      const s = new Date(a.starts_at);
      const e = new Date(a.ends_at);
      const start = s.getHours() * 60 + s.getMinutes();
      let end = e.getHours() * 60 + e.getMinutes();
      if (end <= start) end += 1440; // termina no dia seguinte
      return { a, start, end };
    })
    .sort((x, y) => x.start - y.start || x.end - y.end);
  const result: LaidOut[] = [];
  let cluster: (typeof items) = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const cols: (typeof items)[] = [];
    cluster.forEach((it) => {
      let placed = false;
      for (const col of cols) {
        if (col[col.length - 1].end <= it.start) { col.push(it); placed = true; break; }
      }
      if (!placed) cols.push([it]);
    });
    cluster.forEach((it) => {
      const ci = cols.findIndex((c) => c.includes(it));
      result.push({ ...it, col: ci, cols: cols.length });
    });
    cluster = [];
    clusterEnd = -1;
  };
  items.forEach((it) => {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  });
  flush();
  return result;
}

function GridCard({ it, top, height, col, cols, onOpen }: { it: LaidOut; top: number; height: number; col: number; cols: number; onOpen: (a: Appt) => void }) {
  const s = STATUS_STYLE[it.a.status] ?? STATUS_STYLE.agendado;
  const cancelled = it.a.status === 'cancelado';
  return (
    <button
      onClick={() => onOpen(it.a)}
      className={cx('absolute rounded-xl border p-2 text-left overflow-hidden hover:shadow-sm transition', s.card, cancelled && 'opacity-60')}
      style={{ top, height, left: `calc(${(col * 100) / cols}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
    >
      <div className="flex items-center gap-1.5">
        <span className={cx('w-2 h-2 rounded-full shrink-0', s.dot)} />
        <p className={cx('font-bold text-xs truncate', cancelled ? 'text-slate-500 line-through' : s.text)}>{it.a.clients?.name ?? 'Cliente'}</p>
        <span className={cx('ml-auto text-[10px] font-bold shrink-0', cancelled ? 'text-slate-400' : 'text-slate-500')}>{fmtTime(it.a.starts_at)}–{fmtTime(it.a.ends_at)}</span>
      </div>
      {height >= 54 && (
        <p className={cx('text-[11px] mt-0.5 truncate', cancelled ? 'text-slate-400' : 'text-slate-600/80')}>{it.a.services?.name ?? '—'} · {brl(it.a.price)}</p>
      )}
      {height >= 86 && (
        <p className={cx('text-[11px] truncate', cancelled ? 'text-slate-400' : 'text-slate-500')}>{it.a.professionals?.name ?? '—'}</p>
      )}
    </button>
  );
}

function DayView({ appts, date, blocks, hours, onOpen }: { appts: Appt[]; date: Date; blocks: Block[]; hours: Hours[]; onOpen: (a: Appt) => void }) {
  const laid = useMemo(() => layoutDay(appts), [appts]);
  const k = toLocalInput(date).slice(0, 10);
  const hb = hours.find((x) => x.weekday === date.getDay());
  const dayBlk = blocks.filter((b) => b.block_date === k);
  const fullBlock = dayBlk.find((b) => !b.start_time);
  const partialBlocks = dayBlk.filter((b) => b.start_time) as (Block & { start_time: string; end_time: string })[];
  const closedByHours = hb ? !hb.is_open : false;

  // Banner quando o dia está fechado (expediente ou bloqueio de dia inteiro)
  const closedBanner = (fullBlock || closedByHours) && (
    <Card className="mb-4 p-4 flex items-center gap-3 bg-slate-50 border-dashed border-slate-300">
      <div className="w-10 h-10 rounded-2xl bg-slate-200 text-slate-500 grid place-items-center shrink-0">
        <CalendarOff size={20} />
      </div>
      <div className="min-w-0">
        <p className="font-extrabold text-ink text-sm">Agenda fechada neste dia</p>
        <p className="text-xs text-sub truncate">
          {fullBlock ? `Bloqueada${fullBlock.reason ? ` — ${fullBlock.reason}` : ''}` : 'Expediente fechado'}
          {hb?.is_open && !fullBlock ? ` (abriria às ${hb.start_time.slice(0, 5)})` : ''}
        </p>
      </div>
    </Card>
  );

  if (fullBlock || closedByHours) {
    return (
      <div className="fade-up">
        {closedBanner}
        {appts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-sub">Agendamentos já marcados neste dia</p>
            {appts.map((a) => <ApptCard key={a.id} a={a} onOpen={onOpen} compact />)}
          </div>
        )}
      </div>
    );
  }

  let startH = 7;
  let endH = 20;
  laid.forEach((it) => {
    startH = Math.min(startH, Math.floor(it.start / 60));
    endH = Math.max(endH, Math.ceil(it.end / 60));
  });
  const toMin = (t: string) => parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(3, 5));
  partialBlocks.forEach((b) => {
    startH = Math.min(startH, Math.floor(toMin(b.start_time) / 60));
    endH = Math.max(endH, Math.ceil(toMin(b.end_time) / 60));
  });
  if (!hb?.is_open) {
    // sem expediente configurado: grade padrão
  } else {
    startH = Math.min(startH, Math.floor(toMin(hb.start_time) / 60));
    endH = Math.max(endH, Math.ceil(toMin(hb.end_time) / 60));
  }
  const startMin = startH * 60;
  const gridH = (endH - startH) * HOUR_H;
  const hoursList = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i);
  return (
    <div className="fade-up">
      {closedBanner}
      <div className="flex gap-3">
        <div className="w-14 shrink-0 relative" style={{ height: gridH }}>
          {hoursList.map((h) => (
            <span key={h} className="absolute right-0 text-xs font-bold text-slate-400" style={{ top: ((h * 60 - startMin) / 60) * HOUR_H - 8 }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        <div className="flex-1 relative min-w-0" style={{ height: gridH }}>
          {hoursList.map((h) => (
            <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: ((h * 60 - startMin) / 60) * HOUR_H }} />
          ))}
          {partialBlocks.map((b) => {
            const top = ((toMin(b.start_time) - startMin) / 60) * HOUR_H;
            const height = Math.max(((toMin(b.end_time) - toMin(b.start_time)) / 60) * HOUR_H - 2, 22);
            return (
              <div
                key={b.id}
                className="absolute inset-x-1 rounded-xl bg-slate-100/95 border-2 border-dashed border-slate-300 overflow-hidden flex items-start justify-center pt-1 px-2"
                style={{ top, height, backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(148,163,184,0.15) 6px, rgba(148,163,184,0.15) 12px)' }}
              >
                <span className="text-[10px] font-bold text-slate-400 text-center leading-tight">
                  🔒 Bloqueado {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}{b.reason ? ` · ${b.reason}` : ''}
                </span>
              </div>
            );
          })}
          {laid.map((it) => (
            <GridCard
              key={it.a.id}
              it={it}
              top={((it.start - startMin) / 60) * HOUR_H}
              height={Math.max(((it.end - it.start) / 60) * HOUR_H - 2, 26)}
              col={it.col}
              cols={it.cols}
              onOpen={onOpen}
            />
          ))}
          {appts.length === 0 && partialBlocks.length === 0 && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="text-sm text-slate-300 font-semibold">Nenhum agendamento neste dia</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekView({ weekStart, byDay, blocks, hours, onDay, onOpen }: { weekStart: Date; byDay: Map<string, Appt[]>; blocks: Block[]; hours: Hours[]; onDay: (d: Date) => void; onOpen: (a: Appt) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
      {days.map((d) => {
        const k = toLocalInput(d).slice(0, 10);
        const list = byDay.get(k) ?? [];
        const today = toLocalInput(new Date()).slice(0, 10) === k;
        const closed = !hours.find((x) => x.weekday === d.getDay())?.is_open || blocks.some((b) => b.block_date === k && !b.start_time);
        return (
          <Card key={k} className={cx('p-3 min-h-32', today && 'ring-2 ring-brand-400/40', closed && 'bg-slate-50/60')}>
            <button onClick={() => onDay(d)} className="flex items-center gap-2 w-full mb-2">
              <span className={cx('text-xs font-extrabold uppercase', today ? 'text-brand-600' : 'text-slate-400')}>{WEEKDAYS_SHORT[d.getDay()]}</span>
              <span className="text-sm font-extrabold text-ink">{d.getDate()}</span>
              {closed && <Lock size={11} className="text-slate-300" />}
              <Plus size={14} className="ml-auto text-slate-300" />
            </button>
            <div className="space-y-1.5">
              {list.map((a) => <ApptCard key={a.id} a={a} onOpen={onOpen} compact />)}
              {list.length === 0 && <p className="text-[11px] text-slate-300 text-center py-2">{closed ? 'Fechado' : 'Livre'}</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function MonthView({ cursor, byDay, blocks, hours, onDay }: { cursor: Date; byDay: Map<string, Appt[]>; blocks: Block[]; hours: Hours[]; onDay: (d: Date) => void }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
          <p key={d} className="text-center text-[11px] font-bold text-slate-400 uppercase">{d}</p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = toLocalInput(d).slice(0, 10);
          const list = byDay.get(k) ?? [];
          const today = toLocalInput(new Date()).slice(0, 10) === k;
          const closed = !hours.find((x) => x.weekday === d.getDay())?.is_open || blocks.some((b) => b.block_date === k && !b.start_time);
          return (
            <button
              key={k}
              onClick={() => onDay(d)}
              className={cx(
                'aspect-square sm:aspect-auto sm:min-h-20 rounded-2xl border p-1.5 text-left hover:border-brand-300 transition bg-white',
                today ? 'border-brand-400 ring-1 ring-brand-300' : 'border-slate-100',
                closed && 'bg-slate-50/70',
              )}
            >
              <span className={cx('text-xs font-extrabold', today ? 'text-brand-600' : 'text-ink')}>{d.getDate()}</span>
              {closed && <Lock size={10} className="inline ml-1 text-slate-300" />}
              <div className="mt-1 space-y-0.5 hidden sm:block">
                {list.slice(0, 2).map((a) => (
                  <p key={a.id} className="text-[10px] font-bold text-slate-500 truncate">{fmtTime(a.starts_at)} {a.clients?.name?.split(' ')[0]}</p>
                ))}
                {list.length > 2 && <p className="text-[10px] text-brand-600 font-bold">+{list.length - 2} mais</p>}
              </div>
              {list.length > 0 && <div className="sm:hidden flex gap-0.5 mt-1">{list.slice(0, 3).map((_, i) => <span key={i} className="w-1 h-1 rounded-full bg-brand-500" />)}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
