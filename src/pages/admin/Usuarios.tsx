import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Eye, Pencil, Ban, CheckCircle2, Clock, Gift, Trash2, Crown, UserPlus, KeyRound, Copy, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, Modal, PageHeader, Select, cx } from '../../components/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { SUB_STATUS, CATEGORIES, brl, fmtDate } from '../../lib/utils';

type Sub = { id: string; company_id: string; status: string; plan_id: string | null; current_period_end: string | null; trial_ends_at: string | null; amount: number };
type Row = {
  company: { id: string; name: string; slug: string; category: string; created_at: string; whatsapp: string | null; owner_id: string };
  owner: { id: string; name: string; referral_code: string };
  email: string;
  sub: Sub | null;
  planName: string;
  lastPayment: string | null;
  lastActive: string | null;
};

// "Ativo agora" = heartbeat nos últimos 2 min (heartbeat roda a cada 1 min)
function fmtRel(iso: string | null): string {
  if (!iso) return 'Nunca';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  return fmtDate(iso);
}
const isActive = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 2 * 60_000;

export default function AdminUsuarios() {
  const { toast } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ name: '', category: '', whatsapp: '', slug: '' });
  const [planFor, setPlanFor] = useState<Row | null>(null);
  const [extendFor, setExtendFor] = useState<Row | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [freeFor, setFreeFor] = useState<Row | null>(null);
  const [freeDate, setFreeDate] = useState('');
  const [freeCourtesia, setFreeCourtesia] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newErr, setNewErr] = useState('');
  const [newForm, setNewForm] = useState({ name: '', email: '', password: '', whatsapp: '', company: '', category: 'Studio de Beleza' });
  const [createdInfo, setCreatedInfo] = useState<{ name: string; email: string; password: string; whatsapp: string; company: string; category: string; slug: string } | null>(null);
  const [pwFor, setPwFor] = useState<Row | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [pwDone, setPwDone] = useState<{ email: string; password: string } | null>(null);

  const copyText = (t: string) => { navigator.clipboard?.writeText(t); toast('success', 'Copiado!'); };

  const load = useCallback(async () => {
    setLoading(true);
    const [comps, subs, plansRes, pays, profs, emails] = await Promise.all([
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('*'),
      supabase.from('plans').select('id,name'),
      supabase.from('payments').select('company_id,paid_at,status').eq('status', 'aprovado').order('paid_at', { ascending: false }),
      supabase.from('profiles').select('id,name,last_active_at'),
      supabase.rpc('admin_user_emails'),
    ]);
    const planList = (plansRes.data ?? []) as { id: string; name: string }[];
    const profMap = new Map(((profs.data ?? []) as { id: string; name: string; last_active_at: string | null }[]).map((p) => [p.id, p]));
    const emailMap = new Map(((emails.data ?? []) as { owner_id: string; email: string }[]).map((e) => [e.owner_id, e.email]));
    setPlans(planList);
    const rowsOut: Row[] = ((comps.data ?? []) as Row['company'][]).map((c) => {
      const sub = ((subs.data ?? []) as Sub[]).find((s) => s.company_id === c.id) ?? null;
      const lastPay = (pays.data ?? []).find((p: { company_id: string }) => p.company_id === c.id) ?? null;
      return {
        company: c,
        owner: { id: c.owner_id, name: profMap.get(c.owner_id)?.name ?? '—', referral_code: '' },
        email: emailMap.get(c.owner_id) ?? '—',
        sub,
        planName: planList.find((p) => p.id === sub?.plan_id)?.name ?? '—',
        lastPayment: lastPay?.paid_at ?? null,
        lastActive: profMap.get(c.owner_id)?.last_active_at ?? null,
      };
    });
    setRows(rowsOut);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Atualização "minuto a minuto": recarrega em silêncio a cada 60s
  useEffect(() => {
    const t = setInterval(() => { load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.company.name.toLowerCase().includes(s) || r.company.slug.toLowerCase().includes(s));
  }, [rows, search]);

  const setSub = async (companyId: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from('subscriptions').update(patch).eq('company_id', companyId);
    if (error) toast('error', 'Erro: ' + error.message);
    else toast('success', 'Assinatura atualizada!');
    load();
  };

  return (
    <div className="fade-up">
      <PageHeader title="Usuários" subtitle={`${rows.length} empresas cadastradas`} />

      <div className="relative mb-4 max-w-md flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar empresa ou link..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-11" />
        </div>
        <Button onClick={() => { setNewForm({ name: '', email: '', password: '', whatsapp: '', company: '', category: 'Studio de Beleza' }); setCreatedInfo(null); setNewErr(''); setShowNew(true); }} className="shrink-0 flex items-center gap-2">
          <UserPlus size={18} /> Novo usuário
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-sub py-10 text-center">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Empty title="Nenhuma empresa encontrada" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1050px]">
            <thead>
              <tr className="text-left text-xs font-bold text-slate-400 uppercase border-b border-slate-100">
                <th className="px-5 py-3.5">Negócio</th>
                <th className="px-3 py-3.5">ID</th>
                <th className="px-3 py-3.5">Responsável / Acesso</th>
                <th className="px-3 py-3.5">Atividade</th>
                <th className="px-3 py-3.5">Plano</th>
                <th className="px-3 py-3.5">Status</th>
                <th className="px-3 py-3.5">Cadastro</th>
                <th className="px-3 py-3.5">Vencimento</th>
                <th className="px-3 py-3.5">Último pgto.</th>
                <th className="px-3 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r) => (
                <tr key={r.company.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <p className="font-bold text-ink">{r.company.name}</p>
                    <p className="text-xs text-slate-400">/b/{r.company.slug} · {r.company.category}</p>
                    {r.company.whatsapp && <p className="text-xs text-slate-400">{r.company.whatsapp}</p>}
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded truncate max-w-[90px]" title={r.company.id}>{r.company.id.slice(0, 8)}</code>
                      <button onClick={() => copyText(r.company.id)} className="text-slate-400 hover:text-brand-600" title="Copiar ID"><Copy size={12} /></button>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <p className="font-semibold text-ink">{r.owner.name}</p>
                    <p className="text-xs text-slate-400">{r.email}</p>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', isActive(r.lastActive) ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]' : 'bg-slate-300')} />
                      <span className={cx('text-xs font-bold', isActive(r.lastActive) ? 'text-emerald-600' : 'text-slate-500')}>{isActive(r.lastActive) ? 'Ativo agora' : fmtRel(r.lastActive)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3.5 font-semibold">{r.planName}</td>
                  <td className="px-3 py-3.5">
                    {r.sub && <Badge className={cx(SUB_STATUS[r.sub.status]?.color)}>{SUB_STATUS[r.sub.status]?.label}</Badge>}
                  </td>
                  <td className="px-3 py-3.5 text-slate-500">{fmtDate(r.company.created_at)}</td>
                  <td className="px-3 py-3.5 text-slate-500">
                    {fmtDate(r.sub?.status === 'trial' ? r.sub?.trial_ends_at : r.sub?.current_period_end)}
                  </td>
                  <td className="px-3 py-3.5 text-slate-500">{r.lastPayment ? fmtDate(r.lastPayment) : '—'}</td>
                  <td className="px-3 py-3.5">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Visualizar" onClick={() => setView(r)}><Eye size={16} /></IconBtn>
                      <IconBtn title="Editar" onClick={() => { setEditing(r); setEditForm({ name: r.company.name, category: r.company.category, whatsapp: r.company.whatsapp ?? '', slug: r.company.slug }); }}><Pencil size={16} /></IconBtn>
                      <IconBtn title="Usuário e senha" onClick={() => { setPwFor(r); setPwValue(''); setPwDone(null); }}><KeyRound size={16} /></IconBtn>
                      <IconBtn title="Alterar plano" onClick={() => setPlanFor(r)}><Crown size={16} /></IconBtn>
                      <IconBtn title="Prorrogar vencimento" onClick={() => setExtendFor(r)}><Clock size={16} /></IconBtn>
                      <IconBtn title="Liberar / cortesia" onClick={() => { setFreeFor(r); setFreeCourtesia(false); setFreeDate(''); }}><Gift size={16} /></IconBtn>
                      {r.sub?.status === 'bloqueado' || r.sub?.status === 'vencido' ? (
                        <IconBtn title="Reativar acesso" onClick={() => setSub(r.company.id, { status: 'ativo' })}><CheckCircle2 size={16} /></IconBtn>
                      ) : (
                        <IconBtn title="Suspender acesso" onClick={() => setSub(r.company.id, { status: 'bloqueado' })}><Ban size={16} /></IconBtn>
                      )}
                      <IconBtn title="Excluir" danger onClick={() => setDeleting(r)}><Trash2 size={16} /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Visualizar */}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.company.name}>
        {view && (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-1.5"><b>ID:</b> <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{view.company.id}</code> <button onClick={() => copyText(view.company.id)} className="text-brand-600 hover:text-brand-700"><Copy size={14} /></button></p>
            <p><b>Responsável:</b> {view.owner.name}</p>
            <p className="flex items-center gap-1.5"><b>E-mail de acesso:</b> {view.email}</p>
            <p className="flex items-center gap-2"><b>Atividade:</b>
              <span className={cx('w-2.5 h-2.5 rounded-full', isActive(view.lastActive) ? 'bg-emerald-500' : 'bg-slate-300')} />
              {isActive(view.lastActive) ? 'Ativo agora' : fmtRel(view.lastActive)}
            </p>
            <p><b>Link:</b> /b/{view.company.slug}</p>
            <p><b>Categoria:</b> {view.company.category}</p>
            <p><b>WhatsApp:</b> {view.company.whatsapp || '—'}</p>
            <p><b>Plano:</b> {view.planName} · <b>Status:</b> {view.sub ? SUB_STATUS[view.sub.status]?.label : '—'}</p>
            <p><b>Valor:</b> {brl(view.sub?.amount ?? 0)}</p>
            <p><b>Cadastro:</b> {fmtDate(view.company.created_at)}</p>
            <p><b>Vencimento:</b> {fmtDate(view.sub?.status === 'trial' ? view.sub?.trial_ends_at : view.sub?.current_period_end)}</p>
          </div>
        )}
      </Modal>

      {/* Novo usuário manual (Master) */}
      <Modal open={showNew} onClose={() => !creating && setShowNew(false)} title={createdInfo ? 'Usuário criado!' : 'Criar usuário manualmente'}>
        {createdInfo ? (
          <div className="space-y-4">
            <p className="text-sm text-sub">Guarde estas credenciais — a senha não pode ser recuperada depois (você poderá redefini-la pelo ícone de chave na tabela).</p>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-2.5 text-sm">
              <p><b>Responsável:</b> {createdInfo.name}</p>
              <p className="flex items-center gap-2"><b>E-mail:</b> <code className="bg-white border border-slate-200 rounded-lg px-2 py-0.5">{createdInfo.email}</code>
                <button onClick={() => copyText(createdInfo.email)} className="text-brand-600 hover:text-brand-700"><Copy size={14} /></button></p>
              <p className="flex items-center gap-2"><b>Senha:</b> <code className="bg-white border border-slate-200 rounded-lg px-2 py-0.5">{createdInfo.password}</code>
                <button onClick={() => copyText(createdInfo.password)} className="text-brand-600 hover:text-brand-700"><Copy size={14} /></button></p>
              {createdInfo.whatsapp && <p><b>WhatsApp:</b> {createdInfo.whatsapp}</p>}
              {createdInfo.company && <p><b>Negócio:</b> {createdInfo.company} ({createdInfo.category})</p>}
              {createdInfo.slug && (
                <p className="flex items-center gap-2"><b>Link público:</b> /b/{createdInfo.slug}
                  <button onClick={() => copyText(`${location.origin}/b/${createdInfo.slug}`)} className="text-brand-600 hover:text-brand-700"><Copy size={14} /></button>
                  <a href={`/b/${createdInfo.slug}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700"><ExternalLink size={14} /></a>
                </p>
              )}
              <p className="text-xs text-slate-400">A conta já nasce confirmada, com assinatura trial e dados de demonstração.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setNewForm({ name: '', email: '', password: '', whatsapp: '', company: '', category: 'Studio de Beleza' }); setCreatedInfo(null); }}>Criar outro</Button>
              <Button className="flex-1" onClick={() => { setShowNew(false); setCreatedInfo(null); }}>Concluir</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            <Field label="Nome do responsável"><Input value={newForm.name} onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Ana Souza" /></Field>
            <Field label="E-mail de acesso"><Input type="email" value={newForm.email} onChange={(e) => setNewForm((f) => ({ ...f, email: e.target.value }))} placeholder="ana@email.com" /></Field>
            <Field label="Senha (mín. 8 caracteres)"><Input value={newForm.password} onChange={(e) => setNewForm((f) => ({ ...f, password: e.target.value }))} placeholder="Defina a senha que será entregue ao cliente" /></Field>
            <Field label="WhatsApp (opcional)"><PhoneInput value={newForm.whatsapp} onChange={(v) => setNewForm((f) => ({ ...f, whatsapp: v }))} /></Field>
            <Field label="Nome do negócio"><Input value={newForm.company} onChange={(e) => setNewForm((f) => ({ ...f, company: e.target.value }))} placeholder="Ex.: Studio Ana Beleza" /></Field>
            <Field label="Categoria">
              <Select value={newForm.category} onChange={(e) => setNewForm((f) => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            {newErr && <p className="text-sm font-semibold text-rose-600">{newErr}</p>}
            <Button className="w-full" disabled={creating} onClick={async () => {
              setNewErr('');
              if (!newForm.name.trim()) return setNewErr('Informe o nome do responsável.');
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newForm.email)) return setNewErr('Informe um e-mail válido.');
              if (newForm.password.length < 8) return setNewErr('A senha deve ter pelo menos 8 caracteres.');
              if (!newForm.company.trim()) return setNewErr('Informe o nome do negócio.');
              setCreating(true);
              const { data, error } = await supabase.rpc('admin_create_user', {
                p_name: newForm.name.trim(),
                p_email: newForm.email.trim(),
                p_password: newForm.password,
                p_whatsapp: newForm.whatsapp.trim(),
                p_company_name: newForm.company.trim(),
                p_category: newForm.category,
              });
              setCreating(false);
              if (error) return setNewErr(error.message);
              const { data: comp } = await supabase.from('companies').select('slug').eq('id', (data as { company_id: string }).company_id).single();
              setCreatedInfo({ ...newForm, name: newForm.name.trim(), email: newForm.email.trim(), company: newForm.company.trim(), slug: comp?.slug ?? '' });
              load();
            }}>{creating ? 'Criando...' : 'Criar usuário e empresa'}</Button>
          </div>
        )}
      </Modal>

      {/* Usuário e senha (ver/redefinir acesso) */}
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title="Usuário e senha">
        {pwFor && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-2.5 text-sm">
              <p><b>Responsável:</b> {pwFor.owner.name}</p>
              <p className="flex items-center gap-2"><b>E-mail:</b> <code className="bg-white border border-slate-200 rounded-lg px-2 py-0.5">{pwFor.email}</code>
                <button onClick={() => copyText(pwFor.email)} className="text-brand-600 hover:text-brand-700"><Copy size={14} /></button></p>
              {pwDone && (
                <p className="flex items-center gap-2"><b>Senha atual:</b> <code className="bg-brand-50 border border-brand-200 rounded-lg px-2 py-0.5 text-brand-700 font-bold">{pwDone.password}</code>
                  <button onClick={() => copyText(pwDone.password)} className="text-brand-600 hover:text-brand-700"><Copy size={14} /></button></p>
              )}
              {!pwDone && <p className="text-xs text-slate-400">A senha atual não pode ser lida (ficar criptografada). Defina uma nova abaixo e entregue ao cliente.</p>}
            </div>
            <Field label="Definir nova senha (mín. 8 caracteres)">
              <Input value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="Nova senha de acesso" />
            </Field>
            <Button className="w-full" disabled={pwValue.length < 8} onClick={async () => {
              const { error } = await supabase.rpc('admin_set_password', { p_user_id: pwFor.owner.id, p_password: pwValue });
              if (error) return toast('error', error.message);
              setPwDone({ email: pwFor.email, password: pwValue });
              setPwValue('');
              toast('success', 'Senha atualizada!');
            }}>Salvar nova senha</Button>
          </div>
        )}
      </Modal>

      {/* Editar */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar empresa">
        <div className="space-y-4">
          <Field label="Nome"><Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Categoria"><Input value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))} /></Field>
          <Field label="WhatsApp"><Input value={editForm.whatsapp} onChange={(e) => setEditForm((f) => ({ ...f, whatsapp: e.target.value }))} /></Field>
          <Field label="Link (slug)"><Input value={editForm.slug} onChange={(e) => setEditForm((f) => ({ ...f, slug: e.target.value }))} /></Field>
          <Button className="w-full" onClick={async () => {
            await supabase.from('companies').update(editForm).eq('id', editing!.company.id);
            toast('success', 'Empresa atualizada!');
            setEditing(null); load();
          }}>Salvar</Button>
        </div>
      </Modal>

      {/* Alterar plano */}
      <Modal open={!!planFor} onClose={() => setPlanFor(null)} title="Alterar plano">
        <div className="space-y-3">
          {plans.map((p) => (
            <button key={p.id} onClick={async () => {
              const plan = (await supabase.from('plans').select('*').eq('id', p.id).single()).data;
              await setSub(planFor!.company.id, { plan_id: p.id, amount: plan?.price ?? 0, status: planFor!.sub?.status === 'trial' || planFor!.sub?.status === 'vencido' ? 'ativo' : planFor!.sub?.status });
              setPlanFor(null);
            }} className="w-full flex items-center justify-between border border-slate-100 rounded-2xl px-4 py-3 hover:border-brand-300 transition">
              <span className="font-bold text-ink">{p.name}</span>
              {planFor?.planName === p.name && <Badge className="bg-brand-50 text-brand-700">Atual</Badge>}
            </button>
          ))}
        </div>
      </Modal>

      {/* Prorrogar */}
      <Modal open={!!extendFor} onClose={() => setExtendFor(null)} title="Prorrogar vencimento">
        <div className="space-y-4">
          <Field label="Dias extras"><Input type="number" value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value))} /></Field>
          <Button className="w-full" onClick={async () => {
            const base = extendFor!.sub?.current_period_end ? new Date(extendFor!.sub!.current_period_end) : new Date();
            if (base < new Date()) base.setTime(Date.now());
            base.setDate(base.getDate() + extendDays);
            await setSub(extendFor!.company.id, { current_period_end: base.toISOString(), status: 'ativo' });
            setExtendFor(null);
          }}>Prorrogar {extendDays} dias</Button>
        </div>
      </Modal>

      {/* Liberação manual / cortesia */}
      <Modal open={!!freeFor} onClose={() => setFreeFor(null)} title="Liberação manual">
        <div className="space-y-4">
          <label className="flex items-center gap-3 border border-slate-100 rounded-2xl p-4 cursor-pointer" onClick={() => setFreeCourtesia(true)}>
            <input type="radio" checked={freeCourtesia} readOnly className="accent-brand-600 w-4 h-4" />
            <div>
              <p className="font-bold text-ink text-sm">Cortesia — sem cobrança</p>
              <p className="text-xs text-sub">Cliente em cortesia, mantém acesso até você ativar a cobrança.</p>
            </div>
          </label>
          <label className="flex items-center gap-3 border border-slate-100 rounded-2xl p-4 cursor-pointer" onClick={() => setFreeCourtesia(false)}>
            <input type="radio" checked={!freeCourtesia} readOnly className="accent-brand-600 w-4 h-4" />
            <div className="flex-1">
              <p className="font-bold text-ink text-sm">Definir data de vencimento</p>
              <p className="text-xs text-sub mb-2">Acesso gratuito até a data escolhida.</p>
              <Input type="date" value={freeDate} onChange={(e) => setFreeDate(e.target.value)} onClick={(e) => e.stopPropagation()} />
            </div>
          </label>
          <Button className="w-full" onClick={async () => {
            if (freeCourtesia) {
              await setSub(freeFor!.company.id, { status: 'gratuito', amount: 0 });
            } else if (freeDate) {
              await setSub(freeFor!.company.id, {
                status: 'ativo',
                current_period_end: new Date(freeDate + 'T23:59:59').toISOString(),
                next_billing_at: new Date(freeDate + 'T23:59:59').toISOString(),
              });
            }
            setFreeFor(null);
          }}>Aplicar liberação</Button>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title={`Excluir "${deleting?.company.name}"?`}
        message="Todos os dados da empresa serão removidos permanentemente."
        onConfirm={async () => {
          await supabase.from('companies').delete().eq('id', deleting!.company.id);
          toast('success', 'Empresa excluída.');
          load();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cx('p-2 rounded-xl hover:bg-slate-100 transition', danger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500')}
    >
      {children}
    </button>
  );
}
