import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, Confirm, Empty, Field, Input, Modal, PageHeader, Select, Textarea, Toggle, Loading, cx } from './ui';
import { PhoneInput } from './PhoneInput';
import { ImageUpload } from './ImageUpload';
import { useApp } from '../ctx/AppContext';
import { brl, brlInput } from '../lib/utils';
import { MoneyInput } from './MoneyInput';

export type CrudField = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'time' | 'textarea' | 'select' | 'switch' | 'phone' | 'image';
  imageFolder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  full?: boolean;
};

type Props<T> = {
  table: string;
  title: string;
  subtitle?: string;
  singular: string;
  fields: CrudField[];
  defaults?: Record<string, unknown>;
  select?: string;
  orderBy?: { column: string; ascending?: boolean };
  filter?: Record<string, unknown>;
  renderRow: (row: T, reload: () => void) => React.ReactNode;
  extraActions?: (row: T, reload: () => void) => React.ReactNode;
  searchKeys?: string[];
  headerRight?: React.ReactNode;
  beforeList?: React.ReactNode;
  autoNew?: boolean;
};

export function Crud<T extends { id: string }>({
  table, title, subtitle, singular, fields, defaults = {}, select = '*',
  orderBy, filter = {}, renderRow, extraActions, searchKeys = ['name'], headerRight, beforeList, autoNew,
}: Props<T>) {
  const { company, toast } = useApp();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);

  useEffect(() => {
    if (autoNew) setEditing({});
  }, [autoNew]);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    let q = supabase.from(table).select(select).eq('company_id', company.id);
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v as never);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    const { data, error } = await q;
    if (error) toast('error', 'Erro ao carregar: ' + error.message);
    setRows((data ?? []) as unknown as T[]);
    setLoading(false);
  }, [company, table, select, JSON.stringify(filter), orderBy?.column]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      searchKeys.some((k) => String((r as Record<string, unknown>)[k] ?? '').toLowerCase().includes(s)),
    );
  }, [rows, search, searchKeys]);

  const openNew = () => {
    setForm({ ...defaults });
    setEditing({});
  };
  const openEdit = (row: T) => {
    setForm({ ...row } as Record<string, unknown>);
    setEditing(row);
  };

  const save = async () => {
    for (const f of fields) {
      if (f.required && !String(form[f.key] ?? '').trim()) {
        toast('error', `Preencha: ${f.label}`);
        return;
      }
    }
    setSaving(true);
    const payload: Record<string, unknown> = { ...form };
    for (const f of fields) {
      if (f.type === 'money') payload[f.key] = typeof form[f.key] === 'number' ? form[f.key] : brlInput(String(form[f.key] ?? '0'));
      if (f.type === 'number') payload[f.key] = Number(form[f.key] ?? 0) || 0;
    }
    delete payload.id;
    delete payload.created_at;
    delete payload.company_id;
    let err;
    if ('id' in (editing ?? {})) {
      ({ error: err } = await supabase.from(table).update(payload).eq('id', (editing as T).id));
    } else {
      ({ error: err } = await supabase.from(table).insert({ ...payload, company_id: company!.id }));
    }
    setSaving(false);
    if (err) { toast('error', 'Erro ao salvar: ' + err.message); return; }
    toast('success', `${singular} salvo com sucesso!`);
    setEditing(null);
    load();
  };

  const doDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from(table).delete().eq('id', deleting.id);
    if (error) toast('error', 'Erro ao excluir: ' + error.message);
    else toast('success', `${singular} excluído.`);
    load();
  };

  const setField = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        right={
          <div className="flex gap-2">
            {headerRight}
            <Button onClick={openNew}>
              <Plus size={18} /> Novo
            </Button>
          </div>
        }
      />
      {beforeList}
      <div className="relative mb-4">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-11" />
      </div>

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty
          title={`Nenhum ${singular.toLowerCase()} encontrado`}
          subtitle={search ? 'Tente outro termo de busca.' : `Cadastre o primeiro ${singular.toLowerCase()}.`}
          action={!search && <Button onClick={openNew}><Plus size={18} /> Adicionar</Button>}
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <Card key={row.id} className="p-4 relative">
              {renderRow(row, load)}
              <div className="flex items-center gap-1 mt-3 pt-3 border-t border-slate-100">
                {extraActions?.(row, load)}
                <div className="ml-auto flex gap-1">
                  <button onClick={() => openEdit(row)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500" title="Editar">
                    <Pencil size={17} />
                  </button>
                  <button onClick={() => setDeleting(row)} className="p-2 rounded-xl hover:bg-rose-50 text-rose-500" title="Excluir">
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && 'id' in editing ? `Editar ${singular.toLowerCase()}` : `Novo ${singular.toLowerCase()}`} wide>
        <div className="grid grid-cols-2 gap-4">
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              hint={f.hint}
              className={cx('min-w-0', f.full || f.type === 'textarea' ? 'col-span-2' : 'col-span-2 sm:col-span-1')}
            >
              {f.type === 'textarea' ? (
                <Textarea value={String(form[f.key] ?? '')} onChange={(e) => setField(f.key, e.target.value)} />
              ) : f.type === 'select' ? (
                <Select value={String(form[f.key] ?? '')} onChange={(e) => setField(f.key, e.target.value)}>
                  <option value="">Selecione...</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              ) : f.type === 'switch' ? (
                <div className="h-12 flex items-center">
                  <Toggle checked={!!form[f.key]} onChange={(v) => setField(f.key, v)} />
                </div>
              ) : f.type === 'phone' ? (
                <PhoneInput value={String(form[f.key] ?? '')} onChange={(v) => setField(f.key, v)} />
              ) : f.type === 'image' ? (
                <ImageUpload
                  folder={f.imageFolder ? `company/${company?.id || 'general'}/${f.imageFolder}` : `company/${company?.id || 'general'}/files`}
                  value={String(form[f.key] ?? '') || null}
                  onChange={(url) => setField(f.key, url ?? '')}
                  aspect="square"
                />
              ) : f.type === 'money' ? (
                <MoneyInput value={Number(form[f.key] ?? 0)} onChange={(v) => setField(f.key, v)} />
              ) : (
                <Input
                  type={f.type ?? 'text'}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>Cancelar</Button>
          <Button className="flex-1" loading={saving} onClick={save}>Salvar</Button>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title={`Excluir ${singular.toLowerCase()}?`}
        message="Esta ação não pode ser desfeita."
        onConfirm={doDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

export const money = (v: unknown) => brl(Number(v ?? 0));
