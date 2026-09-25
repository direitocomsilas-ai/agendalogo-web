import React from 'react';
import { useLocation } from 'react-router-dom';
import { MENU_OPERACAO, MENU_CATALOGO, MenuConta } from '../../components/Shell';

function MenuShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const loc = useLocation();
  void loc;
  return (
    <div className="fade-up">
      <h1 className="text-2xl font-extrabold text-ink tracking-tight">{title}</h1>
      <p className="text-sm text-sub mt-0.5 mb-6">{subtitle}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}

export const OperacaoMenu = () => (
  <MenuShell title="Operação" subtitle="Tudo o que você precisa para atender bem.">
    {MENU_OPERACAO}
  </MenuShell>
);

export const CatalogoMenu = () => (
  <MenuShell title="Catálogo" subtitle="Produtos, promoções e vendas.">
    {MENU_CATALOGO}
  </MenuShell>
);

export const ContaMenu = () => (
  <MenuShell title="Conta" subtitle="Configurações, plano e ajuda.">
    <MenuConta />
  </MenuShell>
);
