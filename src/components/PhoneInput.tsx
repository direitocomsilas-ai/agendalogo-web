import React from 'react';
import { cx } from './ui';

export const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: '55', label: 'Brasil +55' },
  { code: '351', label: 'Portugal +351' },
  { code: '1', label: 'EUA / Canadá +1' },
  { code: '54', label: 'Argentina +54' },
  { code: '52', label: 'México +52' },
  { code: '51', label: 'Peru +51' },
  { code: '56', label: 'Chile +56' },
  { code: '57', label: 'Colômbia +57' },
  { code: '58', label: 'Venezuela +58' },
  { code: '593', label: 'Equador +593' },
  { code: '595', label: 'Paraguai +595' },
  { code: '598', label: 'Uruguai +598' },
  { code: '591', label: 'Bolívia +591' },
];

// Converte um número armazenado para DDI+número garantido (para links wa.me)
export function waIntlDigits(value: string): string {
  const d = String(value ?? '').replace(/\D/g, '');
  if (!d) return '';
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (d.startsWith(c.code) && d.length >= c.code.length + 10) return d;
  }
  return '55' + d;
}

function splitValue(value: string): { code: string; local: string } {
  const d = String(value ?? '').replace(/\D/g, '');
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (c.code === '55') continue;
    if (d.startsWith(c.code) && d.length > c.code.length) return { code: c.code, local: d.slice(c.code.length) };
  }
  if (d.startsWith('55') && d.length >= 3) return { code: '55', local: d.slice(2) };
  // Legado sem DDI (ou apenas local) → Brasil
  return { code: '55', local: d };
}

function maskBrLocal(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

// Input de WhatsApp/telefone com seletor de código do país (padrão: +55 Brasil).
// O valor salvo contém o DDI junto dos dígitos (ex.: 556199999999).
export function PhoneInput({ value, onChange, placeholder, className, disabled }: Props) {
  const cur = splitValue(value);
  const isBr = cur.code === '55';
  const inputRef = React.useRef<HTMLInputElement>(null);

  const setCode = (code: string) => {
    const local = cur.local.replace(/\D/g, '');
    onChange(local ? code + local : '');
  };

  const setLocal = (raw: string, caretDigits?: number) => {
    let d = raw.replace(/\D/g, '');
    // O seletor já contém o código do país: ignora se o usuário digitar o
    // código de novo (ex.: "55 61 9..." → mantém apenas "61 9...").
    if (cur.code !== '55') {
      if (d.startsWith(cur.code)) d = d.slice(cur.code.length);
    } else {
      // Brasil: "55" digitado é sempre DDI duplicado (o seletor já é +55).
      // Como o prefixo é idêntico ao código do país, removê-lo e re-adicionar
      // o código do seletor produz sempre o mesmo número final.
      while (d.startsWith('55')) d = d.slice(2);
      if (d.startsWith('0')) d = d.slice(1);
      d = d.slice(0, 11);
    }
    onChange(d ? cur.code + d : '');
    if (caretDigits != null) {
      const shown = cur.code === '55' ? maskBrLocal(d) : d;
      let count = 0, idx = 0;
      for (let i = 0; i < shown.length; i++) {
        if (/\d/.test(shown[i])) { count++; if (count >= caretDigits) { idx = i + 1; break; } }
      }
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el && document.activeElement === el) el.setSelectionRange(idx, idx);
      });
    }
  };

  const selCls = 'h-12 rounded-2xl border border-slate-200 bg-white text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition disabled:opacity-60';

  return (
    <div className={cx('flex gap-2 min-w-0', className)}>
      <select
        value={cur.code}
        disabled={disabled}
        onChange={(e) => setCode(e.target.value)}
        className={cx(selCls, 'shrink-0 w-[100px] sm:w-[120px] appearance-none text-center font-bold')}
        aria-label="Código do país"
      >
        {COUNTRY_CODES.map((c) => (
          <option key={c.code} value={c.code}>+{c.code}</option>
        ))}
      </select>
      <input
        ref={inputRef}
        type="tel"
        inputMode="tel"
        disabled={disabled}
        value={isBr ? maskBrLocal(cur.local) : cur.local}
        onChange={(e) => {
          const el = e.currentTarget;
          const caret = el.selectionStart ?? el.value.length;
          const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
          setLocal(el.value, digitsBefore);
        }}
        placeholder={placeholder ?? (isBr ? '(61) 99999-9999' : 'número')}
        className={cx(selCls, 'flex-1 min-w-0 w-auto px-3 sm:px-4')}
      />
    </div>
  );
}
