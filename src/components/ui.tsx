import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Inbox, AlertTriangle } from 'lucide-react';
import { useApp } from '../ctx/AppContext';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Button ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-2xl transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none';
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    ghost: 'text-slate-600 hover:bg-slate-100',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
  };
  const sizes = { sm: 'h-9 px-3.5 text-sm', md: 'h-11 px-5 text-[15px]', lg: 'h-13 px-7 text-base' };
  return (
    <button className={cx(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 size={17} className="animate-spin" />}
      {children}
    </button>
  );
}

// ---------- Card ----------
export const Card = ({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('bg-white rounded-3xl border border-slate-100 shadow-sm', className)} {...rest}>
    {children}
  </div>
);

// ---------- Inputs ----------
const fieldCls =
  'w-full h-12 px-4 rounded-2xl border border-slate-200 bg-white text-[15px] text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => <input ref={ref} className={cx(fieldCls, className)} {...rest} />,
);
Input.displayName = 'Input';

export const Textarea = ({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx(fieldCls, 'h-auto py-3 min-h-24', className)} {...rest} />
);

export const Select = ({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cx(fieldCls, 'appearance-none pr-10', className)} {...rest}>
    {children}
  </select>
);

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</span>}
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

// ---------- Toggle ----------
export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'w-12 h-7 rounded-full transition relative shrink-0 disabled:opacity-40',
        checked ? 'bg-brand-500' : 'bg-slate-200',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}

// ---------- Badge ----------
export const Badge = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={cx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold', className ?? 'bg-slate-100 text-slate-600')}>
    {children}
  </span>
);

// ---------- Modal ----------
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null);
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const v = window.visualViewport;
    if (!v) return;
    const onResize = () => {
      // Aplica apenas quando o encolhimento vem do teclado (escala 1).
      // Pinch-zoom (escala > 1) deve ser ignorado para o modal não encolher.
      if (v.scale === 1 && v.height < window.innerHeight - 5) setVv({ h: v.height, top: v.offsetTop });
      else setVv(null);
    };
    v.addEventListener('resize', onResize);
    v.addEventListener('scroll', onResize);
    onResize();
    return () => {
      v.removeEventListener('resize', onResize);
      v.removeEventListener('scroll', onResize);
      setVv(null);
    };
  }, [open]);
  if (!open) return null;
  // Portal garante ancoragem na viewport real, mesmo com ancestrais com transform.
  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-end sm:items-center justify-center"
      style={{ height: vv ? vv.h : '100dvh', marginTop: vv ? vv.top : 0 }}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cx(
          'relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden fade-up',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        {title && (
          <div className="shrink-0 bg-white/95 backdrop-blur px-6 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-4 flex items-center justify-between border-b border-slate-100 z-10">
            <h3 className="text-lg font-bold text-ink">{title}</h3>
            <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-slate-100 text-slate-400">
              <X size={20} />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ---------- Confirm ----------
export function Confirm({
  open,
  title,
  message,
  onConfirm,
  onClose,
  danger = true,
}: {
  open: boolean;
  title: string;
  message?: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="text-center pt-2">
        <div className={cx('mx-auto w-14 h-14 rounded-full flex items-center justify-center', danger ? 'bg-rose-50 text-rose-500' : 'bg-brand-50 text-brand-600')}>
          <AlertTriangle size={26} />
        </div>
        <h3 className="mt-4 text-lg font-bold text-ink">{title}</h3>
        {message && <p className="mt-2 text-sm text-sub">{message}</p>}
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={() => { onConfirm(); onClose(); }}>
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Empty ----------
export const Empty = ({ icon, title, subtitle, action }: { icon?: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }) => (
  <div className="text-center py-14 px-6">
    <div className="mx-auto w-16 h-16 rounded-3xl bg-slate-50 flex items-center justify-center text-slate-300">
      {icon ?? <Inbox size={30} />}
    </div>
    <h4 className="mt-4 font-bold text-ink">{title}</h4>
    {subtitle && <p className="mt-1 text-sm text-sub max-w-xs mx-auto">{subtitle}</p>}
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);

// ---------- Loading ----------
export const Loading = ({ label = 'Carregando...' }: { label?: string }) => (
  <div className="flex flex-col items-center justify-center py-20 text-sub">
    <Loader2 size={30} className="animate-spin text-brand-500" />
    <p className="mt-3 text-sm">{label}</p>
  </div>
);

// ---------- PageHeader ----------
export const PageHeader = ({
  title,
  subtitle,
  right,
  back,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  back?: string;
}) => (
  <div className="flex items-start justify-between gap-4 mb-6">
    <div className="min-w-0">
      <h1 className="text-2xl font-extrabold text-ink tracking-tight truncate">{title}</h1>
      {subtitle && <p className="text-sm text-sub mt-0.5">{subtitle}</p>}
      {back && (
        <a href={back} className="text-sm font-semibold text-brand-600 hover:underline mt-1 inline-block">
          Voltar
        </a>
      )}
    </div>
    {right && <div className="shrink-0">{right}</div>}
  </div>
);

// ---------- Toasts ----------
export function ToastHost() {
  const { toasts } = useApp();
  return createPortal(
    <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] sm:bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(92vw,420px)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'fade-up rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg text-white',
            t.kind === 'success' && 'bg-brand-600',
            t.kind === 'error' && 'bg-rose-600',
            t.kind === 'info' && 'bg-slate-800',
          )}
        >
          {t.msg}
        </div>
      ))}
    </div>,
    document.body
  );
}

// ---------- Stat card ----------
export const Stat = ({
  icon,
  label,
  value,
  accent = 'text-brand-600 bg-brand-50',
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: string;
  sub?: string;
}) => (
  <Card className="p-5">
    <div className="flex items-center gap-3">
      {icon && <div className={cx('w-10 h-10 rounded-2xl flex items-center justify-center', accent)}>{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-sub truncate">{label}</p>
        <p className="text-xl font-extrabold text-ink truncate">{value}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
    </div>
  </Card>
);
