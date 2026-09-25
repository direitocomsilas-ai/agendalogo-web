import React from 'react';
import { Input, cx } from './ui';

function fmt(v: string): string {
  const digits = v.replace(/\D/g, '');
  const n = digits ? parseInt(digits, 10) : 0;
  return (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function raw(v: string): number {
  const digits = v.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) / 100 : 0;
}

function unfmt(n: number): string {
  return Math.round(n * 100).toString();
}

type Props = {
  value: number | string | null | undefined;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export function MoneyInput({ value, onChange, placeholder = 'R$ 0,00', className, disabled }: Props) {
  const [display, setDisplay] = React.useState(() => fmt(unfmt(Number(value ?? 0))));
  const wasMounted = React.useRef(false);

  React.useEffect(() => {
    if (!wasMounted.current) { wasMounted.current = true; return; }
    const parsed = Number(value ?? 0);
    if (Math.abs(parsed - raw(display)) > 0.001) {
      setDisplay(fmt(unfmt(parsed)));
    }
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={display}
      placeholder={placeholder}
      className={cx('font-medium', className)}
      onChange={(e) => {
        const next = fmt(e.target.value);
        setDisplay(next);
        onChange(raw(next));
      }}
      onBlur={() => setDisplay(fmt(display))}
    />
  );
}

export { fmt, raw, unfmt };
