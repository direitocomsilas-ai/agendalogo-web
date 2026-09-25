import React from 'react';
import { Package as PkgIcon, Megaphone, Gift, Receipt, FileText } from 'lucide-react';
import { Crud, money } from '../../components/Crud';
import { Badge, cx } from '../../components/ui';
import { fmtDate } from '../../lib/utils';
import { useApp } from '../../ctx/AppContext';
import { supabase } from '../../lib/supabase';

const badge = (color: string, txt: string) => <Badge className={cx(color)}>{txt}</Badge>;

// ---------- PRODUTOS ----------
export const Produtos = () => (
  <Crud
    table="products"
    title="Produtos"
    subtitle="Controle de estoque e vendas"
    singular="Produto"
    searchKeys={['name', 'code']}
    orderBy={{ column: 'name' }}
    fields={[
      { key: 'name', label: 'Nome', required: true },
      { key: 'price', label: 'Preço (R$)', type: 'money' },
      { key: 'stock', label: 'Estoque', type: 'number' },
      { key: 'code', label: 'Código' },
      { key: 'photo_url', label: 'Foto', type: 'image', imageFolder: 'products' },
      { key: 'description', label: 'Descrição' },
      { key: 'active', label: 'Ativo', type: 'switch' },
    ]}
    defaults={{ active: true, stock: 0, price: 0 }}
    renderRow={(p: Product) => (
      <div>
        <div className="flex items-start gap-3">
          {p.photo_url && <img src={p.photo_url} alt={p.name} className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-ink truncate flex-1">{p.name}</p>
              {badge(p.active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500', p.active ? 'Ativo' : 'Inativo')}
            </div>
            <div className="flex items-center gap-2 mt-2">
              {badge('bg-brand-50 text-brand-700', money(p.price))}
              <Badge className={cx(p.stock > 0 ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-600')}>Estoque: {p.stock}</Badge>
              {p.code && <Badge>{p.code}</Badge>}
            </div>
            {p.description && <p className="text-xs text-sub mt-2 line-clamp-2">{p.description}</p>}
          </div>
        </div>
      </div>
    )}
  />
);
type Product = { id: string; name: string; price: number; stock: number; code: string | null; description: string | null; active: boolean; photo_url: string | null };

// ---------- PROMOÇÕES ----------
export const Promocoes = () => (
  <Crud
    table="promotions"
    title="Promoções"
    subtitle="Descontos por período"
    singular="Promoção"
    searchKeys={['name']}
    orderBy={{ column: 'name' }}
    fields={[
      { key: 'name', label: 'Nome', required: true },
      { key: 'target_type', label: 'Aplicar a', type: 'select', options: [{ value: 'servico', label: 'Serviço' }, { value: 'produto', label: 'Produto' }] },
      { key: 'discount', label: 'Desconto', type: 'number' },
      { key: 'discount_type', label: 'Tipo', type: 'select', options: [{ value: 'percent', label: 'Percentual (%)' }, { value: 'value', label: 'Valor (R$)' }] },
      { key: 'starts_at', label: 'Data inicial', type: 'date' },
      { key: 'ends_at', label: 'Data final', type: 'date' },
      { key: 'active', label: 'Ativa', type: 'switch' },
    ]}
    defaults={{ active: true, target_type: 'servico', discount_type: 'percent' }}
    renderRow={(p: Promotion) => (
      <div>
        <div className="flex items-center gap-2">
          <p className="font-bold text-ink truncate flex-1">{p.name}</p>
          {badge(p.active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500', p.active ? 'Ativa' : 'Inativa')}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Badge className="bg-fuchsia-50 text-fuchsia-600">
            {p.discount_type === 'percent' ? `${p.discount}%` : money(p.discount)} OFF
          </Badge>
          <Badge>{p.target_type === 'servico' ? 'Serviço' : 'Produto'}</Badge>
        </div>
        <p className="text-xs text-slate-400 font-semibold mt-2">
          {p.starts_at ? fmtDate(p.starts_at) : 'Início livre'} → {p.ends_at ? fmtDate(p.ends_at) : 'Sem prazo'}
        </p>
      </div>
    )}
  />
);
type Promotion = { id: string; name: string; discount: number; discount_type: string; target_type: string; starts_at: string | null; ends_at: string | null; active: boolean };

// ---------- PACOTES ----------
export const Pacotes = () => (
  <Crud
    table="packages"
    title="Pacotes"
    subtitle="Sessões com valor especial"
    singular="Pacote"
    searchKeys={['name']}
    orderBy={{ column: 'name' }}
    fields={[
      { key: 'name', label: 'Nome', required: true, hint: 'Ex.: Pacote 5 sessões' },
      { key: 'items', label: 'Serviços incluídos (um por linha: Nome — Qtd)', full: true, hint: 'Ex.: Limpeza de pele — 5' },
      { key: 'price', label: 'Valor (R$)', type: 'money' },
      { key: 'validity_days', label: 'Validade (dias)', type: 'number' },
      { key: 'discount', label: 'Desconto (%)', type: 'number' },
      { key: 'active', label: 'Ativo', type: 'switch' },
    ]}
    defaults={{ active: true, validity_days: 90, discount: 0, items: [] }}
    renderRow={(p: Pkg) => (
      <div>
        <div className="flex items-center gap-2">
          <p className="font-bold text-ink truncate flex-1">{p.name}</p>
          {badge(p.active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500', p.active ? 'Ativo' : 'Inativo')}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {badge('bg-brand-50 text-brand-700', money(p.price))}
          <Badge className="bg-amber-50 text-amber-700">Validade {p.validity_days}d</Badge>
          {p.discount > 0 && <Badge className="bg-fuchsia-50 text-fuchsia-600">-{p.discount}%</Badge>}
        </div>
      </div>
    )}
  />
);
type Pkg = { id: string; name: string; price: number; validity_days: number; discount: number; active: boolean; items: unknown };

// ---------- PEDIDOS ----------
export const Pedidos = () => {
  const { company } = useApp();
  return (
    <Crud
      table="orders"
      title="Pedidos"
      subtitle="Vendas de produtos e serviços"
      singular="Pedido"
      select="*, clients(name)"
      searchKeys={['clients']}
      orderBy={{ column: 'created_at', ascending: false }}
      fields={[
        { key: 'client_id', label: 'Cliente (ID)', hint: 'Use a busca de clientes para copiar' },
        { key: 'items', label: 'Itens (um por linha: Nome — Qtd x Valor)', full: true },
        { key: 'total', label: 'Valor total (R$)', type: 'money' },
        { key: 'payment_method', label: 'Forma de pagamento', type: 'select', options: [{ value: 'pix', label: 'PIX' }, { value: 'credito', label: 'Crédito' }, { value: 'debito', label: 'Débito' }, { value: 'dinheiro', label: 'Dinheiro' }] },
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'pendente', label: 'Pendente' }, { value: 'pago', label: 'Pago' }, { value: 'cancelado', label: 'Cancelado' }] },
      ]}
      defaults={{ status: 'pendente', payment_method: 'pix', total: 0, items: [] }}
      renderRow={(o: Order) => (
        <div>
          <p className="font-bold text-ink truncate">{o.clients?.name ?? 'Cliente'}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {badge('bg-brand-50 text-brand-700', money(o.total))}
            <Badge>{({ pix: 'PIX', credito: 'Crédito', debito: 'Débito', dinheiro: 'Dinheiro' } as Record<string, string>)[o.payment_method ?? 'pix']}</Badge>
            {badge(
              o.status === 'pago' ? 'bg-brand-50 text-brand-700' : o.status === 'pendente' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500',
              o.status.charAt(0).toUpperCase() + o.status.slice(1),
            )}
          </div>
          <p className="text-xs text-slate-400 font-semibold mt-2">{fmtDate(o.created_at)}</p>
        </div>
      )}
    />
  );
};
type Order = { id: string; total: number; status: string; payment_method: string | null; created_at: string; clients: { name: string } | null };

// ---------- ORÇAMENTOS ----------
export const Orcamentos = () => (
  <Crud
    table="quotes"
    title="Orçamentos"
    subtitle="Propostas para seus clientes"
    singular="Orçamento"
    select="*, clients(name)"
    searchKeys={['clients']}
    orderBy={{ column: 'created_at', ascending: false }}
    fields={[
      { key: 'client_id', label: 'Cliente (ID)' },
      { key: 'items', label: 'Itens (um por linha: Nome — Valor)', full: true },
      { key: 'discount', label: 'Desconto (R$)', type: 'money' },
      { key: 'valid_until', label: 'Válido até', type: 'date' },
      { key: 'notes', label: 'Observações' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'rascunho', label: 'Rascunho' }, { value: 'enviado', label: 'Enviado' }, { value: 'aprovado', label: 'Aprovado' }, { value: 'recusado', label: 'Recusado' }, { value: 'expirado', label: 'Expirado' }] },
    ]}
    defaults={{ status: 'rascunho', discount: 0, items: [] }}
    renderRow={(q: Quote) => (
      <div>
        <p className="font-bold text-ink truncate">{q.clients?.name ?? 'Cliente'}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {badge(
            q.status === 'aprovado' ? 'bg-brand-50 text-brand-700' : q.status === 'recusado' ? 'bg-rose-50 text-rose-600' : q.status === 'enviado' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500',
            q.status.charAt(0).toUpperCase() + q.status.slice(1),
          )}
          {q.valid_until && <Badge>Válido até {fmtDate(q.valid_until)}</Badge>}
        </div>
        <p className="text-xs text-slate-400 font-semibold mt-2">{fmtDate(q.created_at)}</p>
      </div>
    )}
  />
);
type Quote = { id: string; status: string; valid_until: string | null; created_at: string; clients: { name: string } | null };
