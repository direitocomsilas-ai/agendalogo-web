import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, FolderPlus, Pencil, Trash2, Copy, ChevronUp, ChevronDown, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, Modal, PageHeader, Select, Textarea, Toggle, cx } from '../../components/ui';
import { MoneyInput } from '../../components/MoneyInput';
import { ImageUpload } from '../../components/ImageUpload';
import { brl } from '../../lib/utils';

type Section = { id: string; name: string; position: number };
type Service = {
  id: string;
  section_id: string | null;
  name: string;
  description: string | null;
  price: number;
  duration_min: number;
  mode: string;
  prepay: boolean;
  active: boolean;
  position: number;
  professional_ids: string[];
  photo_url: string | null;
};
type Prof = { id: string; name: string };

const MODES = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'online', label: 'Online' },
  { value: 'domicilio', label: 'A domicílio' },
];

const emptyService = {
  id: '',
  section_id: '',
  name: '',
  description: '',
  price: 0,
  duration_min: 60,
  mode: 'presencial',
  prepay: false,
  active: true,
  professional_ids: [] as string[],
  photo_url: '',
};

export default function Servicos() {
  const { company, toast } = useApp();
  const location = useLocation();
  const [sections, setSections] = useState<Section[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [loading, setLoading] = useState(true);
  const [svcModal, setSvcModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyService });
  const [saving, setSaving] = useState(false);
  const [sectionModal, setSectionModal] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [deleting, setDeleting] = useState<Service | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const [s, sv, p, sp] = await Promise.all([
      supabase.from('service_sections').select('*').eq('company_id', company.id).order('position'),
      supabase.from('services').select('*').eq('company_id', company.id).order('position'),
      supabase.from('professionals').select('id,name').eq('company_id', company.id).eq('status', 'active').order('name'),
      supabase.from('service_professionals').select('service_id,professional_id'),
    ]);
    setSections((s.data ?? []) as Section[]);
    const links = sp.data ?? [];
    setServices(((sv.data ?? []) as Service[]).map((v) => ({
      ...v,
      professional_ids: links.filter((l: { service_id: string; professional_id: string }) => l.service_id === v.id).map((l) => l.professional_id),
    })));
    setProfs((p.data ?? []) as Prof[]);
    setLoading(false);
  }, [company]);

  useEffect(() => { load(); }, [load]);

  // Atalho "Cadastrar Serviço" (?new=1): abre o formulário direto
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('new')) return;
    if (loading) return;
    if (sections.length === 0) {
      setSectionModal(true);
    } else {
      setEditingId(null);
      setForm({ ...emptyService, section_id: sections[0].id });
      setSvcModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, location.search]);

  const openNew = () => { setEditingId(null); setForm({ ...emptyService }); setSvcModal(true); };
  const openEdit = (s: Service) => {
    setEditingId(s.id);
    setForm({
      id: s.id,
      section_id: s.section_id ?? '',
      name: s.name,
      description: s.description ?? '',
      price: s.price,
      duration_min: s.duration_min,
      mode: s.mode,
      prepay: s.prepay,
      active: s.active,
      professional_ids: s.professional_ids,
      photo_url: s.photo_url ?? '',
    });
    setSvcModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast('error', 'Informe o nome do serviço.'); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: form.name,
      description: form.description,
      price: Number(form.price) || 0,
      duration_min: Number(form.duration_min) || 60,
      mode: form.mode,
      prepay: form.prepay,
      active: form.active,
      section_id: form.section_id || null,
      photo_url: form.photo_url || null,
    };
    let err = null;
    let svcId = form.id;
    if (editingId) {
      ({ error: err } = await supabase.from('services').update(payload).eq('id', editingId));
    } else {
      const maxPos = services.length ? Math.max(...services.map((s) => s.position)) : 0;
      const { data, error } = await supabase
        .from('services')
        .insert({ ...payload, company_id: company!.id, position: maxPos + 1 })
        .select('id')
        .single();
      err = error;
      svcId = data?.id ?? '';
    }
    if (err) { toast('error', 'Erro ao salvar: ' + err.message); setSaving(false); return; }
    await supabase.from('service_professionals').delete().eq('service_id', svcId);
    if (form.professional_ids.length) {
      await supabase.from('service_professionals').insert(form.professional_ids.map((pid) => ({ service_id: svcId, professional_id: pid })));
    }
    setSaving(false);
    setSvcModal(false);
    toast('success', 'Serviço salvo!');
    load();
  };

  const duplicate = async (s: Service) => {
    const { id: _id, ...rest } = s;
    await supabase.from('services').insert({ ...rest, name: s.name + ' (cópia)', company_id: company!.id });
    toast('success', 'Serviço duplicado!');
    load();
  };

  const toggleActive = async (s: Service) => {
    await supabase.from('services').update({ active: !s.active }).eq('id', s.id);
    load();
  };

  const move = async (s: Service, dir: number) => {
    const siblings = services.filter((x) => x.section_id === s.section_id);
    const idx = siblings.findIndex((x) => x.id === s.id);
    const other = siblings[idx + dir];
    if (!other) return;
    await supabase.from('services').update({ position: other.position }).eq('id', s.id);
    await supabase.from('services').update({ position: s.position }).eq('id', other.id);
    load();
  };

  const addSection = async () => {
    if (!sectionName.trim()) return;
    const { error } = await supabase
      .from('service_sections')
      .insert({ company_id: company!.id, name: sectionName.trim(), position: sections.length + 1 });
    if (error) toast('error', 'Erro: ' + error.message);
    else toast('success', 'Seção criada!');
    setSectionModal(false);
    setSectionName('');
    load();
  };

  const deleteSection = async (sec: Section) => {
    await supabase.from('service_sections').delete().eq('id', sec.id);
    toast('success', 'Seção removida.');
    load();
  };

  return (
    <div className="fade-up">
      <PageHeader
        title="Serviços"
        subtitle="Organize suas seções e serviços"
        right={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSectionModal(true)}><FolderPlus size={18} /> <span className="hidden sm:inline">Nova seção</span></Button>
            <Button onClick={openNew}><Plus size={18} /> <span className="hidden sm:inline">Novo serviço</span><span className="sm:hidden">Serviço</span></Button>
          </div>
        }
      />

      {loading ? (
        <p className="text-sm text-sub py-10 text-center">Carregando...</p>
      ) : services.length === 0 && sections.length === 0 ? (
        <Empty title="Nenhum serviço cadastrado" subtitle="Crie sua primeira seção e comece a adicionar serviços." action={<Button onClick={openNew}><Plus size={18} /> Novo serviço</Button>} />
      ) : (
        <div className="space-y-8">
          {sections.map((sec) => {
            const list = services.filter((s) => s.section_id === sec.id);
            return (
              <div key={sec.id}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="font-extrabold text-ink">{sec.name}</h2>
                  <span className="text-xs text-slate-400 font-bold">{list.length}</span>
                  <button onClick={() => deleteSection(sec)} className="ml-auto p-1.5 rounded-lg hover:bg-rose-50 text-rose-400" title="Excluir seção">
                    <Trash2 size={15} />
                  </button>
                </div>
                {list.length === 0 ? (
                  <p className="text-sm text-slate-400 px-1">Nenhum serviço nesta seção.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((s) => (
                      <Card key={s.id} className="p-5">
                        <div className="flex items-start gap-3">
                          {s.photo_url && <img src={s.photo_url} alt={s.name} className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-ink truncate">{s.name}</p>
                            <p className="text-xs text-sub mt-0.5 line-clamp-2">{s.description || 'Sem descrição'}</p>
                          </div>
                          <Toggle checked={s.active} onChange={() => toggleActive(s)} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <Badge className="bg-brand-50 text-brand-700">{brl(s.price)}</Badge>
                          <Badge><Clock size={12} className="mr-1" />{s.duration_min} min</Badge>
                          <Badge>{MODES.find((m) => m.value === s.mode)?.label}</Badge>
                          {s.prepay && <Badge className="bg-amber-50 text-amber-700">Pré-pagamento</Badge>}
                        </div>
                        {s.professional_ids.length > 0 && (
                          <p className="text-[11px] text-slate-400 mt-2 font-semibold">
                            {s.professional_ids.map((id) => profs.find((p) => p.id === id)?.name).filter(Boolean).join(', ')}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-4 pt-4 border-t border-slate-100">
                          <IconBtn onClick={() => move(s, -1)} title="Subir"><ChevronUp size={16} /></IconBtn>
                          <IconBtn onClick={() => move(s, 1)} title="Descer"><ChevronDown size={16} /></IconBtn>
                          <IconBtn onClick={() => duplicate(s)} title="Duplicar"><Copy size={16} /></IconBtn>
                          <div className="ml-auto flex gap-1">
                            <IconBtn onClick={() => openEdit(s)} title="Editar"><Pencil size={16} /></IconBtn>
                            <IconBtn danger onClick={() => setDeleting(s)} title="Excluir"><Trash2 size={16} /></IconBtn>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {services.filter((s) => !s.section_id).length > 0 && (
            <div>
              <h2 className="font-extrabold text-ink mb-3">Sem seção</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {services.filter((s) => !s.section_id).map((s) => (
                  <Card key={s.id} className="p-5">
                    <div className="flex items-start gap-3">
                      {s.photo_url && <img src={s.photo_url} alt={s.name} className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-ink">{s.name}</p>
                        <p className="text-sm text-brand-700 font-bold mt-1">{brl(s.price)} · {s.duration_min} min</p>
                      </div>
                    </div>
                    <div className="flex justify-end gap-1 mt-3">
                      <IconBtn onClick={() => openEdit(s)}><Pencil size={16} /></IconBtn>
                      <IconBtn danger onClick={() => setDeleting(s)}><Trash2 size={16} /></IconBtn>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal serviço */}
      <Modal open={svcModal} onClose={() => setSvcModal(false)} title={editingId ? 'Editar serviço' : 'Novo serviço'} wide>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome" className="col-span-2">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Extensão clássica" />
          </Field>
          <Field label="Foto do serviço" className="col-span-2 sm:col-span-1">
            <ImageUpload
              folder={`company/${company!.id}/services`}
              value={form.photo_url || null}
              onChange={(url) => setForm((f) => ({ ...f, photo_url: url ?? '' }))}
              aspect="square"
              placeholder="Enviar foto"
            />
          </Field>
          <Field label="Seção" className="col-span-2 sm:col-span-1">
            <Select value={form.section_id} onChange={(e) => setForm((f) => ({ ...f, section_id: e.target.value }))}>
              <option value="">Sem seção</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Modalidade" className="col-span-2 sm:col-span-1">
            <Select value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Preço (R$)">
            <MoneyInput value={form.price} onChange={(v) => setForm((f) => ({ ...f, price: v }))} />
          </Field>
          <Field label="Duração (min)">
            <Input type="number" value={form.duration_min} onChange={(e) => setForm((f) => ({ ...f, duration_min: Number(e.target.value) }))} />
          </Field>
          <div className="col-span-2 flex gap-8">
            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
              <Toggle checked={form.prepay} onChange={(v) => setForm((f) => ({ ...f, prepay: v }))} /> Pré-pagamento
            </label>
            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
              <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} /> Ativo
            </label>
          </div>
          <Field label="Profissionais que realizam" className="col-span-2">
            <div className="flex flex-wrap gap-2">
              {profs.map((p) => {
                const on = form.professional_ids.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      professional_ids: on ? f.professional_ids.filter((x) => x !== p.id) : [...f.professional_ids, p.id],
                    }))}
                    className={cx('px-3.5 py-2 rounded-full text-sm font-bold border transition', on ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-500')}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Descrição" className="col-span-2">
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setSvcModal(false)}>Cancelar</Button>
          <Button className="flex-1" loading={saving} onClick={save}>Salvar</Button>
        </div>
      </Modal>

      {/* Modal seção */}
      <Modal open={sectionModal} onClose={() => setSectionModal(false)} title="Nova seção">
        <Field label="Nome da seção">
          <Input value={sectionName} onChange={(e) => setSectionName(e.target.value)} placeholder="Ex.: Extensão" autoFocus />
        </Field>
        <Button className="w-full mt-5" onClick={addSection}>Criar seção</Button>
      </Modal>

      <Confirm
        open={!!deleting}
        title={`Excluir "${deleting?.name}"?`}
        message="Esta ação não pode ser desfeita."
        onConfirm={async () => {
          await supabase.from('services').delete().eq('id', deleting!.id);
          toast('success', 'Serviço excluído.');
          load();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function IconBtn({ children, onClick, danger, title }: { children: React.ReactNode; onClick: () => void; danger?: boolean; title?: string }) {
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
