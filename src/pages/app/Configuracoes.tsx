import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Camera } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Button, Card, Confirm, Field, Input, PageHeader, Select, Textarea, Toggle, Empty, Modal } from '../../components/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { CATEGORIES, WEEKDAYS, fmtDate } from '../../lib/utils';

type Hours = { id: string; weekday: number; is_open: boolean; start_time: string; end_time: string; breaks: { start: string; end: string }[] };
type Location = { id: string; name: string; address: string | null; active: boolean };
type Settings = { slot_interval: number; min_notice_hours: number; max_advance_days: number; allow_online: boolean; reminder_hours: number; personal_contacts: { name: string; phone: string }[] };
type Block = { id: string; block_date: string; reason: string | null };

const Section = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <Card className="p-6 mb-5">
    <h2 className="font-extrabold text-ink">{title}</h2>
    {desc && <p className="text-xs text-sub mt-0.5 mb-4">{desc}</p>}
    <div className={desc ? '' : 'mt-4'}>{children}</div>
  </Card>
);

export default function Configuracoes() {
  const { company, refreshCompany, toast } = useApp();
  const navigate = useNavigate();
  const [delAccount, setDelAccount] = useState(false);
  const [biz, setBiz] = useState({ name: '', category: '', description: '', whatsapp: '', instagram: '', address: '', city: '', state: '', zip: '', timezone: 'America/Sao_Paulo' });
  const [hours, setHours] = useState<Hours[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [newBlock, setNewBlock] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [savingBiz, setSavingBiz] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [delLoc, setDelLoc] = useState<Location | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

  const uploadPhoto = async (file: File) => {
    if (!company) return;
    if (!file.type.startsWith('image/')) { toast('error', 'Escolha um arquivo de imagem.'); return; }
    if (file.size > MAX_PHOTO_BYTES) { toast('error', 'Imagem muito grande. O limite é 10 MB.'); return; }
    setUploadingPhoto(true);
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'png';
    const path = `company/${company.id}/perfil-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('media').upload(path, file, { contentType: file.type });
    if (upErr) { setUploadingPhoto(false); toast('error', 'Erro no upload: ' + upErr.message); return; }
    const { data: pub } = supabase.storage.from('media').getPublicUrl(path);
    const { error: dbErr } = await supabase.from('companies').update({ logo_url: pub.publicUrl }).eq('id', company.id);
    setUploadingPhoto(false);
    if (dbErr) { toast('error', 'Foto enviada, mas não foi possível salvar: ' + dbErr.message); return; }
    toast('success', 'Foto do perfil atualizada!');
    refreshCompany();
  };

  const removePhoto = async () => {
    if (!company) return;
    const { error } = await supabase.from('companies').update({ logo_url: null }).eq('id', company.id);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Foto removida.'); refreshCompany(); }
  };

  const load = useCallback(async () => {
    if (!company) return;
    const [c, h, s, l, b] = await Promise.all([
      supabase.from('companies').select('*').eq('id', company.id).single(),
      supabase.from('business_hours').select('*').eq('company_id', company.id).order('weekday'),
      supabase.from('company_settings').select('*').eq('company_id', company.id).maybeSingle(),
      supabase.from('locations').select('*').eq('company_id', company.id),
      supabase.from('date_blocks').select('*').eq('company_id', company.id).order('block_date'),
    ]);
    if (c.data) {
      const d = c.data;
      setBiz({ name: d.name, category: d.category, description: d.description ?? '', whatsapp: d.whatsapp ?? '', instagram: d.instagram ?? '', address: d.address ?? '', city: d.city ?? '', state: d.state ?? '', zip: d.zip ?? '', timezone: d.timezone });
    }
    setHours(((h.data ?? []) as Hours[]).map((x) => ({ ...x, breaks: (x.breaks ?? []) as { start: string; end: string }[] })));
    if (s.data) setSettings(s.data as Settings);
    setLocations((l.data ?? []) as Location[]);
    setBlocks((b.data ?? []) as Block[]);
  }, [company]);
  useEffect(() => { load(); }, [load]);

  const saveBiz = async () => {
    setSavingBiz(true);
    const { error } = await supabase.from('companies').update(biz).eq('id', company!.id);
    setSavingBiz(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Dados do negócio salvos!'); refreshCompany(); }
  };

  const saveHours = async () => {
    for (const h of hours) {
      await supabase.from('business_hours').update({ is_open: h.is_open, start_time: h.start_time, end_time: h.end_time, breaks: h.breaks }).eq('id', h.id);
    }
    toast('success', 'Expediente atualizado!');
  };

  const saveSettings = async () => {
    if (!settings) return;
    const { error } = await supabase.from('company_settings').update(settings).eq('company_id', company!.id);
    if (error) toast('error', 'Erro: ' + error.message);
    else toast('success', 'Regras de agenda salvas!');
  };

  const addBreak = (h: Hours) => {
    setHours((hs) => hs.map((x) => x.id === h.id ? { ...x, breaks: [...x.breaks, { start: '12:00', end: '13:00' }] } : x));
  };
  const saveBreaks = async (h: Hours) => {
    await supabase.from('business_hours').update({ breaks: h.breaks }).eq('id', h.id);
  };

  const addLocation = async () => {
    const { data, error } = await supabase.from('locations').insert({ company_id: company!.id, name: 'Novo local', address: '', active: true }).select('id').single();
    if (!error && data) setLocations((l) => [...l, { id: data.id, name: 'Novo local', address: '', active: true }]);
  };
  const saveLocation = async (l: Location) => {
    await supabase.from('locations').update({ name: l.name, address: l.address, active: l.active }).eq('id', l.id);
    toast('success', 'Local salvo!');
  };

  const addBlock = async () => {
    if (!newBlock) return;
    const { error } = await supabase.from('date_blocks').insert({ company_id: company!.id, block_date: newBlock, reason: blockReason });
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Data bloqueada!'); setNewBlock(''); setBlockReason(''); load(); }
  };

  const saveContacts = async () => {
    if (!settings) return;
    await supabase.from('company_settings').update({ personal_contacts: settings.personal_contacts }).eq('company_id', company!.id);
    toast('success', 'Contatos salvos!');
  };

  const upd = (h: Hours, patch: Partial<Hours>) => setHours((hs) => hs.map((x) => (x.id === h.id ? { ...x, ...patch } : x)));

  return (
    <div className="fade-up max-w-3xl">
      <PageHeader title="Configurações" subtitle="Ajuste seu negócio, expediente e regras de agenda" />

      <Section title="Dados do negócio" desc="Aparecem na sua página pública de agendamento.">
        <div className="flex items-center gap-4 mb-5">
          <div className="relative w-20 h-20 shrink-0">
            <div className="absolute -inset-[3px] rounded-full animate-[spin_3.5s_linear_infinite]"
              style={{ background: 'conic-gradient(from 0deg, #059669, #3b82f6, #f59e0b, #ef4444, #a855f7, #06b6d4, #059669)' }} />
            <div className="absolute inset-0 rounded-full bg-white grid place-items-center overflow-hidden ring-2 ring-white">
              {company?.logo_url
                ? <img src={company.logo_url} alt="Foto do perfil" className="w-full h-full object-cover" />
                : <Camera size={26} className="text-slate-300" />}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-ink">Foto do perfil</p>
            <p className="text-xs text-sub">Aparece no topo do painel e na sua página pública.</p>
            <div className="flex gap-2">
              <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }} />
              <Button size="sm" variant="secondary" loading={uploadingPhoto} onClick={() => photoRef.current?.click()}>
                {company?.logo_url ? 'Trocar foto' : 'Carregar foto'}
              </Button>
              {company?.logo_url && <Button size="sm" variant="ghost" className="text-rose-600" onClick={removePhoto}>Remover</Button>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome"><Input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} /></Field>
          <Field label="Categoria">
            <Select value={biz.category} onChange={(e) => setBiz({ ...biz, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="WhatsApp"><Input value={biz.whatsapp} onChange={(e) => setBiz({ ...biz, whatsapp: e.target.value })} /></Field>
          <Field label="Instagram"><Input value={biz.instagram} onChange={(e) => setBiz({ ...biz, instagram: e.target.value })} placeholder="@seunegocio" /></Field>
          <Field label="Endereço" className="col-span-2"><Input value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} /></Field>
          <Field label="Cidade"><Input value={biz.city} onChange={(e) => setBiz({ ...biz, city: e.target.value })} /></Field>
          <Field label="Estado"><Input value={biz.state} onChange={(e) => setBiz({ ...biz, state: e.target.value })} placeholder="SP" /></Field>
          <Field label="CEP"><Input value={biz.zip} onChange={(e) => setBiz({ ...biz, zip: e.target.value })} /></Field>
          <Field label="Fuso horário">
            <Select value={biz.timezone} onChange={(e) => setBiz({ ...biz, timezone: e.target.value })}>
              <option value="America/Sao_Paulo">America/Sao_Paulo (GMT-3)</option>
              <option value="America/Manaus">America/Manaus (GMT-4)</option>
              <option value="America/Rio_Branco">America/Rio_Branco (GMT-5)</option>
              <option value="America/Noronha">America/Noronha (GMT-2)</option>
            </Select>
          </Field>
          <Field label="Descrição" className="col-span-2" hint="Usada para apresentar o negócio e futuramente para respostas automáticas por IA.">
            <Textarea value={biz.description} onChange={(e) => setBiz({ ...biz, description: e.target.value })} />
          </Field>
        </div>
        <Button className="mt-4" loading={savingBiz} onClick={saveBiz}><Save size={16} /> Salvar dados</Button>
      </Section>

      <Section title="Expediente" desc="Defina horários de funcionamento e pausas de cada dia.">
        <div className="space-y-2">
          {hours.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 border border-slate-100 rounded-2xl p-3.5">
              <span className="w-20 font-bold text-ink text-sm">{WEEKDAYS[h.weekday]}</span>
              <Toggle checked={h.is_open} onChange={(v) => upd(h, { is_open: v })} />
              {h.is_open ? (
                <>
                  <Input type="time" value={h.start_time} onChange={(e) => upd(h, { start_time: e.target.value })} onBlur={saveHours} className="!w-28 !h-10" />
                  <span className="text-slate-400">–</span>
                  <Input type="time" value={h.end_time} onChange={(e) => upd(h, { end_time: e.target.value })} onBlur={saveHours} className="!w-28 !h-10" />
                  <button onClick={() => addBreak(h)} className="text-xs font-bold text-brand-600 hover:underline ml-auto">+ Pausa</button>
                  {h.breaks.map((b, i) => (
                    <span key={i} className="flex items-center gap-1 bg-amber-50 text-amber-700 rounded-full px-3 py-1 text-xs font-bold">
                      <input type="time" value={b.start} onChange={(e) => upd(h, { breaks: h.breaks.map((x, j) => j === i ? { ...x, start: e.target.value } : x) })} className="bg-transparent w-16 focus:outline-none" />
                      –
                      <input type="time" value={b.end} onChange={(e) => upd(h, { breaks: h.breaks.map((x, j) => j === i ? { ...x, end: e.target.value } : x) })} className="bg-transparent w-16 focus:outline-none" />
                      <button onClick={() => { upd(h, { breaks: h.breaks.filter((_, j) => j !== i) }); setTimeout(() => saveBreaks(h), 0); }} className="text-amber-400">×</button>
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-xs font-bold text-slate-400">Fechado</span>
              )}
            </div>
          ))}
        </div>
        <Button className="mt-4" onClick={saveHours}><Save size={16} /> Salvar expediente</Button>
      </Section>

      <Section title="Regras de agenda" desc="Intervalos entre atendimentos e limites de agendamento online.">
        {settings && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Intervalo (min)" hint="Slots na página pública"><Input type="number" value={settings.slot_interval} onChange={(e) => setSettings({ ...settings, slot_interval: Number(e.target.value) })} /></Field>
              <Field label="Antecedência mín. (h)"><Input type="number" value={settings.min_notice_hours} onChange={(e) => setSettings({ ...settings, min_notice_hours: Number(e.target.value) })} /></Field>
              <Field label="Agendar até (dias)"><Input type="number" value={settings.max_advance_days} onChange={(e) => setSettings({ ...settings, max_advance_days: Number(e.target.value) })} /></Field>
              <Field label="Lembrete (h antes)"><Input type="number" value={settings.reminder_hours} onChange={(e) => setSettings({ ...settings, reminder_hours: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <Toggle checked={settings.allow_online} onChange={(v) => setSettings({ ...settings, allow_online: v })} />
              <span className="text-sm font-semibold text-slate-700">Permitir agendamento online pelo link público</span>
            </div>
            <Button className="mt-4" onClick={saveSettings}><Save size={16} /> Salvar regras</Button>
          </>
        )}
      </Section>

      <Section title="Datas bloqueadas" desc="Feriados, férias e folgas.">
        <div className="flex flex-wrap gap-2 mb-3">
          <Input type="date" value={newBlock} onChange={(e) => setNewBlock(e.target.value)} className="!w-44" />
          <Input placeholder="Motivo (opcional)" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="!w-56" />
          <Button variant="secondary" onClick={addBlock}><Plus size={16} /> Bloquear</Button>
        </div>
        {blocks.length === 0 ? <p className="text-sm text-slate-400">Nenhuma data bloqueada.</p> : (
          <div className="flex flex-wrap gap-2">
            {blocks.map((b) => (
              <span key={b.id} className="flex items-center gap-2 bg-slate-100 rounded-full pl-3.5 pr-2 py-1.5 text-xs font-bold text-slate-600">
                {fmtDate(b.block_date)}{b.reason ? ` · ${b.reason}` : ''}
                <button onClick={async () => { await supabase.from('date_blocks').delete().eq('id', b.id); load(); }} className="p-1 rounded-full hover:bg-rose-100 text-rose-500"><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Locais de atendimento" desc="Onde você atende: studio, domicílio, unidades.">
        {locations.length === 0 ? (
          <Empty title="Nenhum local cadastrado" action={<Button variant="secondary" onClick={addLocation}><Plus size={16} /> Adicionar local</Button>} />
        ) : (
          <div className="space-y-2">
            {locations.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 border border-slate-100 rounded-2xl p-3.5">
                <Input value={l.name} onChange={(e) => setLocations((ls) => ls.map((x) => x.id === l.id ? { ...x, name: e.target.value } : x))} className="!w-44 !h-10" />
                <Input value={l.address ?? ''} placeholder="Endereço" onChange={(e) => setLocations((ls) => ls.map((x) => x.id === l.id ? { ...x, address: e.target.value } : x))} className="flex-1 !h-10 min-w-40" />
                <Toggle checked={l.active} onChange={(v) => setLocations((ls) => ls.map((x) => x.id === l.id ? { ...x, active: v } : x))} />
                <Button size="sm" variant="secondary" onClick={() => saveLocation(l)}>Salvar</Button>
                <button onClick={() => setDelLoc(l)} className="p-2 rounded-xl hover:bg-rose-50 text-rose-500"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Contatos pessoais" desc="Números para receber avisos do sistema (não aparecem para clientes).">
        {settings && (
          <>
            {settings.personal_contacts.map((c, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <Input placeholder="Nome" value={c.name} onChange={(e) => setSettings({ ...settings, personal_contacts: settings.personal_contacts.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} className="!w-48" />
                <PhoneInput value={c.phone} onChange={(v) => setSettings({ ...settings, personal_contacts: settings.personal_contacts.map((x, j) => j === i ? { ...x, phone: v } : x) })} />
                <button onClick={() => setSettings({ ...settings, personal_contacts: settings.personal_contacts.filter((_, j) => j !== i) })} className="p-2 rounded-xl hover:bg-rose-50 text-rose-500"><Trash2 size={16} /></button>
              </div>
            ))}
            <div className="flex gap-2 mt-3">
              <Button variant="secondary" onClick={() => setSettings({ ...settings, personal_contacts: [...settings.personal_contacts, { name: '', phone: '' }] })}><Plus size={16} /> Adicionar</Button>
              <Button onClick={saveContacts}><Save size={16} /> Salvar contatos</Button>
            </div>
          </>
        )}
      </Section>

      <Section title="Excluir conta" desc="Ação permanente e irreversível.">
        <button
          onClick={() => setDelAccount(true)}
          className="w-full p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 font-bold text-sm hover:bg-rose-100 transition"
        >
          <Trash2 size={16} className="inline mr-2 -mt-0.5" />
          Excluir minha conta
        </button>
        <p className="text-xs text-sub mt-2">
          Remove sua conta, sua empresa, clientes, agendamentos e todos os dados associados permanentemente.
        </p>
      </Section>

      <Confirm
        open={!!delLoc}
        title={`Excluir local "${delLoc?.name}"?`}
        onConfirm={async () => { await supabase.from('locations').delete().eq('id', delLoc!.id); toast('success', 'Local excluído.'); load(); }}
        onClose={() => setDelLoc(null)}
      />

      <Confirm
        open={delAccount}
        title="Excluir minha conta permanentemente?"
        onConfirm={async () => {
          setDelAccount(false);
          const { error } = await supabase.rpc('delete_my_account');
          if (error) { toast('error', 'Não foi possível excluir: ' + error.message); return; }
          await supabase.auth.signOut();
          toast('success', 'Sua conta foi excluída.');
          navigate('/');
        }}
        onClose={() => setDelAccount(false)}
      />
    </div>
  );
}
