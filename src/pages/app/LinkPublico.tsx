import React, { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, PiggyBank } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Button, Card, Field, Input, PageHeader, Select, Textarea, Toggle } from '../../components/ui';
import { ImageUpload } from '../../components/ImageUpload';
import { slugify } from '../../lib/utils';

export default function LinkPublico() {
  const { company, refreshCompany, toast } = useApp();
  const [form, setForm] = useState({
    public_enabled: true,
    slug: '',
    logo_url: '',
    photo_url: '',
    cover_type: 'color',
    cover_color: '#059669',
    cover_url: '',
    description: '',
    name: '',
    instagram: '',
    whatsapp: '',
  });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deposit, setDeposit] = useState({ enabled: false, amount: 50, pix_key: '', pix_name: '', pix_city: '', pix_type: 'cpf' });
  const [depositSaving, setDepositSaving] = useState(false);

  useEffect(() => {
    if (company) {
      setForm({
        public_enabled: company.public_enabled,
        slug: company.slug,
        logo_url: company.logo_url ?? '',
        photo_url: company.photo_url ?? '',
        cover_type: company.cover_type ?? 'color',
        cover_color: company.cover_color ?? '#059669',
        cover_url: company.cover_url ?? '',
        description: company.description ?? '',
        name: company.name,
        instagram: company.instagram ?? '',
        whatsapp: company.whatsapp ?? '',
      });
      setDeposit({
        enabled: !!(company as any).deposit_enabled,
        amount: Number((company as any).deposit_amount ?? 50),
        pix_key: (company as any).deposit_pix_key ?? '',
        pix_name: (company as any).deposit_pix_name ?? '',
        pix_city: (company as any).deposit_pix_city ?? '',
        pix_type: (company as any).deposit_pix_type ?? 'cpf',
      });
    }
  }, [company]);

  const saveDeposit = async () => {
    if (deposit.enabled && (!deposit.amount || deposit.amount < 5)) {
      toast('error', 'O sinal deve ser no mínimo R$ 5,00.'); return;
    }
    setDepositSaving(true);
    const { error } = await supabase.rpc('deposit_save_u', {
      p_enabled: deposit.enabled,
      p_amount: Number(deposit.amount) || 0,
      p_pix_key: deposit.pix_key.trim() || null,
      p_pix_name: deposit.pix_name.trim() || null,
      p_pix_city: deposit.pix_city.trim() || null,
      p_pix_type: deposit.pix_type || null,
    });
    setDepositSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Sinal atualizado!'); refreshCompany(); }
  };

  const publicUrl = `${window.location.origin}/b/${form.slug}`;

  const save = async () => {
    const slug = slugify(form.slug);
    if (!slug) { toast('error', 'Informe o link personalizado.'); return; }
    const { data: existing } = await supabase.from('companies').select('id').eq('slug', slug).neq('id', company!.id).maybeSingle();
    if (existing) { toast('error', 'Este link já está em uso. Tente outro.'); return; }
    setSaving(true);
    const { error } = await supabase.from('companies').update({ ...form, slug }).eq('id', company!.id);
    setSaving(false);
    if (error) toast('error', 'Erro: ' + error.message);
    else { toast('success', 'Página pública atualizada!'); refreshCompany(); }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    toast('success', 'Link copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fade-up max-w-3xl">
      <PageHeader title="Link público" subtitle="Seus clientes agendam online por este link" />

      <Card className="p-6 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <Toggle checked={form.public_enabled} onChange={(v) => setForm((f) => ({ ...f, public_enabled: v }))} />
          <div>
            <p className="font-bold text-ink">Agendamento online</p>
            <p className="text-xs text-sub">Ative para receber agendamentos pelo link.</p>
          </div>
        </div>
        <div className="mt-5">
          <Field label="Link personalizado" hint={`Ex.: ${window.location.origin}/b/seu-negocio`}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400 font-semibold shrink-0 hidden sm:block">/b/</span>
              <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
            </div>
          </Field>
          <div className="flex gap-2 mt-3">
            <Button onClick={copy} variant="outline">{copied ? <Check size={16} /> : <Copy size={16} />} Copiar link</Button>
            <a href={`/b/${form.slug}`} target="_blank" rel="noreferrer">
              <Button variant="secondary"><ExternalLink size={16} /> Abrir página</Button>
            </a>
          </div>
        </div>
      </Card>

      <Card className="p-6 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <Toggle checked={deposit.enabled} onChange={(v) => setDeposit((d) => ({ ...d, enabled: v }))} />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink flex items-center gap-2"><PiggyBank size={18} className="text-brand-600" /> Sinal para confirmar</p>
            <p className="text-xs text-sub">Peça um valor de sinal via PIX ao cliente agendar. Com a sua chave PIX preenchida, o valor cai direto na sua conta — sem taxa de transação.</p>
          </div>
        </div>
        {deposit.enabled && (
          <div className="mt-4 space-y-4">
            <Field label="Valor do sinal (R$)" hint="Mínimo R$ 5,00">
              <Input
                type="number" min={5} step="0.01" inputMode="decimal"
                value={deposit.amount || ''}
                onChange={(e) => setDeposit((d) => ({ ...d, amount: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Tipo de chave PIX">
              <Select value={deposit.pix_type} onChange={(e) => setDeposit((d) => ({ ...d, pix_type: e.target.value }))}>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="telefone">Telefone (celular)</option>
                <option value="aleatoria">Chave aleatória</option>
              </Select>
            </Field>
            <Field
              label="Sua chave PIX"
              hint={deposit.pix_type === 'telefone'
                ? 'DDD + número, ex.: 61999999999 (o +55 é adicionado automaticamente)'
                : deposit.pix_type === 'email' ? 'Seu e-mail cadastrado no banco'
                : deposit.pix_type === 'aleatoria' ? 'A chave aleatória gerada pelo seu banco'
                : `Somente os ${deposit.pix_type === 'cnpj' ? '14' : '11'} dígitos do ${deposit.pix_type.toUpperCase()}`}
            >
              <Input
                value={deposit.pix_key}
                onChange={(e) => setDeposit((d) => ({ ...d, pix_key: e.target.value }))}
                placeholder={deposit.pix_type === 'telefone' ? '61999999999' : deposit.pix_type === 'email' ? 'voce@email.com' : deposit.pix_type === 'cnpj' ? '00000000000000' : deposit.pix_type === 'aleatoria' ? 'xxxxxxxx-xxxx-xxxx' : '00000000000'}
                inputMode={deposit.pix_type === 'telefone' || deposit.pix_type === 'cpf' || deposit.pix_type === 'cnpj' ? 'numeric' : 'text'}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nome do titular" hint="Como aparece na conta (sem acento)">
                <Input
                  value={deposit.pix_name}
                  onChange={(e) => setDeposit((d) => ({ ...d, pix_name: e.target.value }))}
                  placeholder="Ex.: MARIA SOUZA"
                />
              </Field>
              <Field label="Cidade do titular" hint="Sem acento (padrão PIX)">
                <Input
                  value={deposit.pix_city}
                  onChange={(e) => setDeposit((d) => ({ ...d, pix_city: e.target.value }))}
                  placeholder="Ex.: BRASILIA"
                />
              </Field>
            </div>
            <p className="text-xs text-slate-400">Sem chave PIX? O sinal é cobrado pelo Mercado Pago (taxa de R$ 2,99 por transação).</p>
          </div>
        )}
        <Button className="mt-4" variant="secondary" loading={depositSaving} onClick={saveDeposit}>Salvar sinal</Button>
      </Card>

      <Card className="p-6 mb-5">
        <h2 className="font-extrabold text-ink mb-4">Personalização</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Logo"><ImageUpload folder={`company/${company!.id}/logos`} value={form.logo_url || null} onChange={(url) => setForm((f) => ({ ...f, logo_url: url ?? '' }))} aspect="square" placeholder="Enviar logo" /></Field>
          <Field label="Tipo de capa">
            <Select value={form.cover_type} onChange={(e) => setForm((f) => ({ ...f, cover_type: e.target.value }))}>
              <option value="color">Cor sólida</option>
              <option value="image">Imagem</option>
            </Select>
          </Field>
          {form.cover_type === 'color' ? (
            <Field label="Cor da capa">
              <div className="flex items-center gap-3 h-12">
                <input type="color" value={form.cover_color} onChange={(e) => setForm((f) => ({ ...f, cover_color: e.target.value }))} className="w-12 h-12 rounded-2xl border border-slate-200 cursor-pointer p-1" />
                <Input value={form.cover_color} onChange={(e) => setForm((f) => ({ ...f, cover_color: e.target.value }))} />
              </div>
            </Field>
          ) : (
            <Field label="Imagem de capa" className="col-span-2">
              <ImageUpload
                folder={`company/${company!.id}/covers`}
                value={form.cover_url || null}
                onChange={(url) => setForm((f) => ({ ...f, cover_url: url ?? '' }))}
                aspect="wide"
                placeholder="Clique para enviar a capa"
              />
            </Field>
          )}
          <Field label="Nome exibido" className="col-span-2"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Descrição" className="col-span-2"><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
          <Field label="Instagram"><Input value={form.instagram} onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))} placeholder="@seunegocio" /></Field>
          <Field label="WhatsApp"><Input value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} /></Field>
        </div>
        <Button className="mt-5" loading={saving} onClick={save}>Salvar personalização</Button>
      </Card>

      {/* Preview */}
      <Card className="overflow-hidden">
        <div className="h-24" style={form.cover_type === 'color' ? { background: form.cover_color } : { background: `center/cover url(${form.cover_url})` }} />
        <div className="px-6 pb-6">
          <div className="relative w-20 h-20 -mt-10 mb-3">
            {form.logo_url && (
              <div className="absolute -inset-[3px] rounded-full animate-[spin_3.5s_linear_infinite]"
                style={{ background: 'conic-gradient(from 0deg, #059669, #3b82f6, #f59e0b, #ef4444, #a855f7, #06b6d4, #059669)' }} />
            )}
            <div className="absolute inset-0 rounded-full bg-white shadow-md grid place-items-center overflow-hidden ring-2 ring-white">
              {form.logo_url ? <img src={form.logo_url} alt="logo" className="w-full h-full object-cover" /> : <span className="text-2xl font-extrabold text-brand-600">{form.name.charAt(0)}</span>}
            </div>
          </div>
          <p className="text-lg font-extrabold text-ink">{form.name}</p>
          <p className="text-xs font-bold text-brand-600 uppercase tracking-wide">{company?.category}</p>
          <p className="text-sm text-sub mt-2">{form.description}</p>
        </div>
      </Card>
    </div>
  );
}
