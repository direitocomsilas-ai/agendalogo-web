import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Pencil, Trash2, Plus, FileText, Check, X, ClipboardList } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, Modal, PageHeader, Select, Textarea, cx } from '../../components/ui';
import { fmtDate } from '../../lib/utils';

type Client = { id: string; name: string; whatsapp: string | null };
type Template = { id: string; name: string; fields: TField[]; consent_text: string | null };
type TField = { key: string; label: string; type: string; required?: boolean; options?: string[] };
type Record_ = { id: string; client_id: string; template_id: string | null; answers: Record<string, string>; signature: string | null; created_at: string };

const BASE_FIELDS: TField[] = [
  { key: 'cpf', label: 'CPF', type: 'text' },
  { key: 'nascimento', label: 'Data de nascimento', type: 'date' },
  { key: 'telefone', label: 'Telefone', type: 'text' },
  { key: 'historico', label: 'Histórico', type: 'textarea' },
  { key: 'alergias', label: 'Alergias', type: 'textarea' },
  { key: 'restricoes', label: 'Restrições', type: 'textarea' },
  { key: 'observacoes', label: 'Observações', type: 'textarea' },
];

const QUESTION_TYPES = [
  { id: 'textarea', label: 'Texto longo' },
  { id: 'text', label: 'Texto curto' },
  { id: 'yesno', label: 'Sim ou Não' },
  { id: 'choice', label: 'Múltipla escolha' },
  { id: 'date', label: 'Data' },
  { id: 'number', label: 'Número' },
];

const TYPE_LABEL: Record<string, string> = {
  text: 'Texto curto', textarea: 'Texto longo', yesno: 'Sim/Não',
  choice: 'Escolha', date: 'Data', number: 'Número',
};

export default function Anamnese() {
  const { company, toast } = useApp();
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [template, setTemplate] = useState<Template | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [recordsOf, setRecordsOf] = useState<Client | null>(null);
  const [records, setRecords] = useState<Record_[]>([]);

  const [recModal, setRecModal] = useState(false);
  const [editing, setEditing] = useState<Record_ | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Record_ | null>(null);

  const [tplModal, setTplModal] = useState(false);
  const [tplFields, setTplFields] = useState<TField[]>([]);
  const [newQ, setNewQ] = useState('');
  const [newQType, setNewQType] = useState('textarea');
  const [newQOptions, setNewQOptions] = useState('');
  const [consent, setConsent] = useState('');

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const [c, t, r] = await Promise.all([
      supabase.from('clients').select('id,name,whatsapp').eq('company_id', company.id).order('name'),
      supabase.from('anamnesis_templates').select('*').eq('company_id', company.id).maybeSingle(),
      supabase.from('anamnesis_records').select('id,client_id').eq('company_id', company.id),
    ]);
    setClients((c.data ?? []) as Client[]);
    const tpl = (t.data ?? null) as Template | null;
    setTemplate(tpl);
    if (tpl) { setTplFields(tpl.fields ?? []); setConsent(tpl.consent_text ?? ''); }
    const cc: Record<string, number> = {};
    for (const rec of (r.data ?? []) as { client_id: string }[]) cc[rec.client_id] = (cc[rec.client_id] ?? 0) + 1;
    setCounts(cc);
    setLoading(false);
  }, [company]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? clients.filter((c) => c.name.toLowerCase().includes(s)) : clients;
  }, [clients, search]);

  const openRecords = async (c: Client) => {
    setRecordsOf(c);
    const { data } = await supabase
      .from('anamnesis_records')
      .select('*')
      .eq('company_id', company!.id)
      .eq('client_id', c.id)
      .order('created_at', { ascending: false });
    setRecords((data ?? []) as Record_[]);
  };

  const openNewRecord = () => {
    if (!template) { toast('info', 'Configure o formulário primeiro.'); setTplModal(true); return; }
    setEditing(null);
    const init: Record<string, string> = {};
    for (const f of template.fields) init[f.key] = '';
    init.nome = recordsOf?.name ?? '';
    setAnswers(init);
    setSignature('');
    setRecModal(true);
  };

  const openEditRecord = (r: Record_) => {
    setEditing(r);
    setAnswers(r.answers ?? {});
    setSignature(r.signature ?? '');
    setRecModal(true);
  };

  const saveRecord = async () => {
    setSaving(true);
    const payload = {
      company_id: company!.id,
      client_id: recordsOf!.id,
      template_id: template?.id ?? null,
      answers,
      signature: signature || null,
    };
    let err;
    if (editing) ({ error: err } = await supabase.from('anamnesis_records').update(payload).eq('id', editing.id));
    else ({ error: err } = await supabase.from('anamnesis_records').insert(payload));
    setSaving(false);
    if (err) { toast('error', 'Erro: ' + err.message); return; }
    toast('success', 'Ficha salva!');
    setRecModal(false);
    openRecords(recordsOf!);
    load();
  };

  const saveTemplate = async () => {
    const payload = {
      company_id: company!.id,
      name: 'Ficha de anamnese',
      fields: [...BASE_FIELDS, ...tplFields.filter((q) => !BASE_FIELDS.some((b) => b.key === q.key))],
      consent_text: consent,
    };
    let err;
    if (template) ({ error: err } = await supabase.from('anamnesis_templates').update(payload).eq('id', template.id));
    else ({ error: err } = await supabase.from('anamnesis_templates').insert(payload));
    if (err) { toast('error', 'Erro: ' + err.message); return; }
    toast('success', 'Formulário salvo!');
    setTplModal(false);
    load();
  };

  const addQuestion = () => {
    if (!newQ.trim()) return;
    const key = 'custom_' + Date.now();
    const options = newQType === 'choice'
      ? newQOptions.split(';').map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (newQType === 'choice' && (!options || options.length < 2)) {
      toast('error', 'Informe pelo menos 2 opções, separadas por ponto e vírgula.');
      return;
    }
    setTplFields((f) => [...f, { key, label: newQ.trim(), type: newQType, options }]);
    setNewQ('');
    setNewQOptions('');
  };

  const fields = template ? [...BASE_FIELDS, ...(template.fields ?? []).filter((q) => !BASE_FIELDS.some((b) => b.key === q.key))] : BASE_FIELDS;

  const filledCount = fields.filter((f) => (answers[f.key] ?? '').trim() !== '').length;
  const progress = fields.length ? Math.round((filledCount / fields.length) * 100) : 0;

  const renderAnswerInput = (f: TField) => {
    const val = answers[f.key] ?? '';
    const set = (v: string) => setAnswers((a) => ({ ...a, [f.key]: v }));
    if (f.type === 'yesno') {
      return (
        <div className="flex gap-2">
          {[
            { v: 'sim', label: 'Sim', on: 'bg-brand-50 border-brand-400 text-brand-700' },
            { v: 'não', label: 'Não', on: 'bg-rose-50 border-rose-300 text-rose-600' },
          ].map((o) => (
            <button
              key={o.v} type="button" onClick={() => set(val === o.v ? '' : o.v)}
              className={cx(
                'flex-1 h-11 rounded-2xl text-sm font-extrabold border transition flex items-center justify-center gap-1.5',
                val === o.v ? o.on : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300',
              )}
            >
              {val === o.v ? (o.v === 'sim' ? <Check size={15} /> : <X size={15} />) : null}
              {o.label}
            </button>
          ))}
        </div>
      );
    }
    if (f.type === 'choice' && (f.options ?? []).length > 0) {
      return (
        <div className="flex flex-wrap gap-2">
          {(f.options ?? []).map((o) => (
            <button
              key={o} type="button" onClick={() => set(val === o ? '' : o)}
              className={cx(
                'px-4 h-10 rounded-full text-sm font-bold border transition',
                val === o ? 'bg-brand-50 border-brand-400 text-brand-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300',
              )}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }
    if (f.type === 'textarea') {
      return <Textarea value={val} onChange={(e) => set(e.target.value)} placeholder="Escreva aqui..." />;
    }
    if (f.type === 'number') {
      return <Input type="text" inputMode="numeric" value={val} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} placeholder="0" />;
    }
    return <Input type={f.type === 'date' ? 'date' : 'text'} value={val} onChange={(e) => set(e.target.value)} />;
  };

  return (
    <div className="fade-up">
      <PageHeader
        title="Anamnese"
        subtitle="Fichas e histórico de saúde dos clientes"
        right={<Button variant="outline" onClick={() => setTplModal(true)}>Personalizar formulário</Button>}
      />

      <div className="relative mb-4">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input placeholder="Buscar por nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-11" />
      </div>

      {loading ? (
        <p className="text-sm text-sub py-10 text-center">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Empty title="Nenhum cliente encontrado" subtitle="Cadastre clientes na área de Clientes." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center font-extrabold">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-ink truncate">{c.name}</p>
                  <p className="text-xs text-sub">{c.whatsapp ?? '—'}</p>
                </div>
                <Badge className={cx('ml-auto', (counts[c.id] ?? 0) > 0 ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>
                  {counts[c.id] ?? 0} ficha{(counts[c.id] ?? 0) === 1 ? '' : 's'}
                </Badge>
              </div>
              <div className="flex justify-end mt-4 pt-4 border-t border-slate-100">
                <Button size="sm" variant="secondary" onClick={() => openRecords(c)}>Ver fichas</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Lista de fichas do cliente */}
      <Modal open={!!recordsOf} onClose={() => setRecordsOf(null)} title={`Fichas — ${recordsOf?.name}`} wide>
        <div className="flex justify-end mb-4">
          <Button onClick={openNewRecord}><Plus size={16} /> Nova ficha</Button>
        </div>
        {records.length === 0 ? (
          <Empty icon={<FileText size={28} />} title="Nenhuma ficha preenchida" subtitle="Toque em Nova ficha para começar." />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {records.map((r) => {
              const answered = Object.values(r.answers ?? {}).filter((v) => (v ?? '').trim() !== '').length;
              return (
                <div key={r.id} className="flex items-center gap-3 border border-slate-100 rounded-2xl p-4 hover:border-brand-200 transition">
                  <div className="w-10 h-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    <ClipboardList size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink">{fmtDate(r.created_at)}</p>
                    <p className="text-xs text-sub truncate">
                      {answered}/{fields.length} perguntas · {r.signature ? `assinada por ${r.signature}` : 'sem assinatura'}
                    </p>
                  </div>
                  <button onClick={() => openEditRecord(r)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><Pencil size={16} /></button>
                  <button onClick={() => setDeleting(r)} className="p-2 rounded-xl hover:bg-rose-50 text-rose-500"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* Preencher ficha */}
      <Modal open={recModal} onClose={() => setRecModal(false)} title={editing ? 'Editar ficha' : 'Nova ficha'} wide>
        {/* Progresso */}
        <div className="col-span-2 mb-1">
          <div className="flex items-center justify-between text-xs font-bold mb-1.5">
            <span className="text-sub">Progresso do preenchimento</span>
            <span className={progress === 100 ? 'text-brand-600' : 'text-slate-400'}>{filledCount}/{fields.length} · {progress}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={cx('h-full rounded-full transition-all duration-300', progress === 100 ? 'bg-brand-500' : 'bg-brand-400')} style={{ width: `${Math.max(3, progress)}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              hint={f.type === 'yesno' ? 'Toque em Sim ou Não' : undefined}
              className={f.type === 'textarea' ? 'col-span-2' : f.type === 'choice' || f.type === 'yesno' ? 'col-span-2 sm:col-span-1' : 'col-span-2 sm:col-span-1'}
            >
              {renderAnswerInput(f)}
            </Field>
          ))}
          {template?.consent_text && (
            <div className="col-span-2 bg-slate-50 rounded-2xl p-4">
              <p className="text-sm text-slate-600">{template.consent_text}</p>
              <Field label="Assinatura (digite seu nome completo)" className="mt-3">
                <Input value={signature} onChange={(e) => setSignature(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 -mx-6 -mb-[calc(1.5rem+env(safe-area-inset-bottom))] mt-6 flex gap-3 bg-white/95 backdrop-blur border-t border-slate-100 px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] rounded-b-3xl">
          <Button variant="outline" className="flex-1" onClick={() => setRecModal(false)}>Cancelar</Button>
          <Button className="flex-1" loading={saving} onClick={saveRecord}>Salvar ficha</Button>
        </div>
      </Modal>

      {/* Editor de formulário */}
      <Modal open={tplModal} onClose={() => setTplModal(false)} title="Personalizar formulário" wide>
        <div className="space-y-2">
          <p className="text-sm font-bold text-ink">Campos padrão</p>
          <div className="flex flex-wrap gap-2">
            {BASE_FIELDS.map((f) => (
              <span key={f.key} className="px-3 py-1.5 bg-slate-100 rounded-full text-xs font-bold text-slate-500">
                {f.label} <span className="text-slate-400 font-semibold">· {TYPE_LABEL[f.type] ?? f.type}</span>
              </span>
            ))}
          </div>

          <p className="text-sm font-bold text-ink pt-3">Perguntas personalizadas</p>
          {tplFields.filter((f) => !BASE_FIELDS.some((b) => b.key === f.key)).length === 0 && (
            <p className="text-xs text-sub">Nenhuma pergunta personalizada ainda. Adicione abaixo com o tipo que quiser.</p>
          )}
          {tplFields.filter((f) => !BASE_FIELDS.some((b) => b.key === f.key)).map((f) => (
            <div key={f.key} className="border border-slate-100 rounded-2xl px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate">{f.label}</span>
                <Select
                  value={f.type}
                  onChange={(e) => setTplFields((x) => x.map((q) => (q.key === f.key ? { ...q, type: e.target.value } : q)))}
                  className="!w-40 !h-9 text-xs"
                >
                  {QUESTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
                <button onClick={() => setTplFields((x) => x.filter((q) => q.key !== f.key))} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 shrink-0"><Trash2 size={15} /></button>
              </div>
              {f.type === 'choice' && (
                <Input
                  value={(f.options ?? []).join('; ')}
                  onChange={(e) => setTplFields((x) => x.map((q) => (q.key === f.key ? { ...q, options: e.target.value.split(';').map((s) => s.trim()).filter(Boolean) } : q)))}
                  placeholder="Opções separadas por ; (ex.: Leve; Moderado; Intenso)"
                  className="!h-10 text-xs"
                />
              )}
            </div>
          ))}

          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-2 mt-3">
            <Input placeholder="Nova pergunta..." value={newQ} onChange={(e) => setNewQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addQuestion()} />
            <div className="flex gap-2">
              <Select value={newQType} onChange={(e) => setNewQType(e.target.value)} className="flex-1">
                {QUESTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              {newQType === 'choice' && (
                <Input
                  value={newQOptions} onChange={(e) => setNewQOptions(e.target.value)}
                  placeholder="Opções separadas por ;" className="flex-1"
                />
              )}
            </div>
            <Button variant="secondary" className="w-full" onClick={addQuestion}><Plus size={15} /> Adicionar pergunta</Button>
          </div>

          <Field label="Termo de consentimento" className="pt-3">
            <Textarea value={consent} onChange={(e) => setConsent(e.target.value)} />
          </Field>
        </div>
        <Button className="w-full mt-5" onClick={saveTemplate}>Salvar formulário</Button>
      </Modal>

      <Confirm
        open={!!deleting}
        title="Excluir ficha?"
        message="Esta ação não pode ser desfeita."
        onConfirm={async () => { await supabase.from('anamnesis_records').delete().eq('id', deleting!.id); toast('success', 'Ficha excluída.'); if (recordsOf) openRecords(recordsOf); load(); }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
