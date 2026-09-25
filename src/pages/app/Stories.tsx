import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Eye, MousePointerClick, Radio, Pencil, Trash2, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Confirm, Empty, Field, Input, Modal, PageHeader, Stat, Textarea, Toggle, cx } from '../../components/ui';
import { fmtDate } from '../../lib/utils';

type Story = {
  id: string;
  title: string;
  text: string | null;
  image_url: string | null;
  link_url: string | null;
  button_label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  position: number;
  views: number;
  clicks: number;
};

const empty = {
  id: '', title: '', text: '', image_url: '', link_url: '', button_label: 'Saiba mais',
  starts_at: '', ends_at: '', active: true,
};

export default function Stories() {
  const { company, toast } = useApp();
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Story | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const { data } = await supabase.from('stories').select('*').eq('company_id', company.id).order('position');
    setStories((data ?? []) as Story[]);
    setLoading(false);
  }, [company]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.title.trim()) { toast('error', 'Informe o título.'); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      title: form.title, text: form.text, image_url: form.image_url || null,
      link_url: form.link_url, button_label: form.button_label || 'Saiba mais',
      starts_at: form.starts_at || null, ends_at: form.ends_at || null, active: form.active,
    };
    let err;
    if (editingId) ({ error: err } = await supabase.from('stories').update(payload).eq('id', editingId));
    else ({ error: err } = await supabase.from('stories').insert({ ...payload, company_id: company!.id, position: stories.length + 1 }));
    setSaving(false);
    if (err) { toast('error', 'Erro: ' + err.message); return; }
    toast('success', 'Story salvo!');
    setModal(false);
    load();
  };

  const move = async (s: Story, dir: number) => {
    const other = stories[stories.findIndex((x) => x.id === s.id) + dir];
    if (!other) return;
    await supabase.from('stories').update({ position: other.position }).eq('id', s.id);
    await supabase.from('stories').update({ position: s.position }).eq('id', other.id);
    load();
  };

  const isActive = (s: Story) =>
    s.active && (!s.starts_at || s.starts_at <= new Date().toISOString().slice(0, 10)) && (!s.ends_at || s.ends_at >= new Date().toISOString().slice(0, 10));

  const totalViews = stories.reduce((a, s) => a + s.views, 0);
  const totalClicks = stories.reduce((a, s) => a + s.clicks, 0);
  const ctr = totalViews ? ((totalClicks / totalViews) * 100).toFixed(1) + '%' : '—';
  const activeCount = stories.filter(isActive).length;

  return (
    <div className="fade-up">
      <PageHeader
        title="Stories"
        subtitle="Promoções em destaque na sua página pública"
        right={<Button onClick={() => { setEditingId(null); setForm({ ...empty }); setModal(true); }}><Plus size={18} /> Novo story</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat icon={<Eye size={19} />} label="Views" value={totalViews} />
        <Stat icon={<MousePointerClick size={19} />} label="Cliques" value={totalClicks} accent="text-blue-600 bg-blue-50" />
        <Stat icon={<MousePointerClick size={19} />} label="CTR" value={ctr} accent="text-amber-600 bg-amber-50" />
        <Stat icon={<Radio size={19} />} label="Ativos" value={activeCount} accent="text-fuchsia-600 bg-fuchsia-50" />
      </div>

      {loading ? (
        <p className="text-sm text-sub py-10 text-center">Carregando...</p>
      ) : stories.length === 0 ? (
        <Empty title="Nenhum story criado" subtitle="Crie stories promocionais com imagem, link e período de exibição." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stories.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              {s.image_url ? (
                <img src={s.image_url} alt={s.title} className="w-full h-36 object-cover" />
              ) : (
                <div className="w-full h-36 bg-gradient-to-br from-brand-100 to-brand-50 flex items-center justify-center text-brand-400">
                  <Radio size={32} />
                </div>
              )}
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-ink truncate flex-1">{s.title}</p>
                  <Badge className={isActive(s) ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}>
                    {isActive(s) ? 'Ativo' : s.active ? 'Fora do período' : 'Inativo'}
                  </Badge>
                </div>
                {s.text && <p className="text-xs text-sub mt-1 line-clamp-2">{s.text}</p>}
                <p className="text-[11px] text-slate-400 font-semibold mt-2">
                  {s.starts_at ? fmtDate(s.starts_at) : 'Início livre'} → {s.ends_at ? fmtDate(s.ends_at) : 'Sem fim'}
                </p>
                <div className="flex gap-3 mt-3 text-xs font-bold text-slate-500">
                  <span className="flex items-center gap-1"><Eye size={13} /> {s.views}</span>
                  <span className="flex items-center gap-1"><MousePointerClick size={13} /> {s.clicks}</span>
                  <span>CTR {s.views ? ((s.clicks / s.views) * 100).toFixed(0) : 0}%</span>
                </div>
                <div className="flex items-center gap-1 mt-4 pt-4 border-t border-slate-100">
                  <button onClick={() => move(s, -1)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><ChevronUp size={16} /></button>
                  <button onClick={() => move(s, 1)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><ChevronDown size={16} /></button>
                  <div className="ml-auto flex gap-1">
                    <button onClick={async () => { await supabase.from('stories').update({ active: !s.active }).eq('id', s.id); load(); }} className={cx('px-3 h-9 rounded-xl text-xs font-bold', s.active ? 'bg-slate-100 text-slate-600' : 'bg-brand-50 text-brand-700')}>
                      {s.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button onClick={() => { setEditingId(s.id); setForm({ id: s.id, title: s.title, text: s.text ?? '', image_url: s.image_url ?? '', link_url: s.link_url ?? '', button_label: s.button_label ?? 'Saiba mais', starts_at: s.starts_at ?? '', ends_at: s.ends_at ?? '', active: s.active }); setModal(true); }} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><Pencil size={16} /></button>
                    <button onClick={() => setDeleting(s)} className="p-2 rounded-xl hover:bg-rose-50 text-rose-500"><Trash2 size={16} /></button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editingId ? 'Editar story' : 'Novo story'} wide>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Título" className="col-span-2">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="Imagem (URL)" className="col-span-2">
            <Input value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://..." />
          </Field>
          <Field label="Texto" className="col-span-2">
            <Textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} />
          </Field>
          <Field label="Link (URL)" className="col-span-2">
            <Input value={form.link_url} onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))} placeholder="https://..." />
          </Field>
          <Field label="Botão">
            <Input value={form.button_label} onChange={(e) => setForm((f) => ({ ...f, button_label: e.target.value }))} />
          </Field>
          <div />
          <Field label="Data inicial">
            <Input type="date" value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
          </Field>
          <Field label="Data final">
            <Input type="date" value={form.ends_at} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />
          </Field>
          <div className="col-span-2 flex items-center gap-3">
            <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} />
            <span className="text-sm font-semibold text-slate-700">Story ativo</span>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>Cancelar</Button>
          <Button className="flex-1" loading={saving} onClick={save}>Salvar</Button>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title={`Excluir story "${deleting?.title}"?`}
        onConfirm={async () => { await supabase.from('stories').delete().eq('id', deleting!.id); toast('success', 'Story excluído.'); load(); }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
