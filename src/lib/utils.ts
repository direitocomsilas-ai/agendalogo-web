export const CATEGORIES = [
  'Salão de Beleza',
  'Barbearia',
  'Nail Designer',
  'Lash Designer',
  'Designer de Sobrancelhas',
  'Massoterapia',
  'Pet Shop',
  'Clínica de Estética',
  'Bronzeamento Estético',
  'Personal Trainer',
  'Studio de Beleza',
  'Clínica de Psicologia',
  'Tattoo',
  'Consultório Odontológico',
  'Fotografia',
  'Pilates',
  'Clínica Médica',
  'Outro',
];

export const APPT_STATUS = [
  { value: 'agendado', label: 'Agendado', color: 'bg-blue-50 text-blue-700' },
  { value: 'confirmado', label: 'Confirmado', color: 'bg-brand-50 text-brand-700' },
  { value: 'em_atendimento', label: 'Em atendimento', color: 'bg-amber-50 text-amber-700' },
  { value: 'concluido', label: 'Concluído', color: 'bg-slate-100 text-slate-600' },
  { value: 'cancelado', label: 'Cancelado', color: 'bg-rose-50 text-rose-600' },
  { value: 'faltou', label: 'Faltou', color: 'bg-orange-50 text-orange-700' },
] as const;

export const statusLabel = (s: string) =>
  APPT_STATUS.find((x) => x.value === s)?.label ?? s;
export const statusColor = (s: string) =>
  APPT_STATUS.find((x) => x.value === s)?.color ?? 'bg-slate-100 text-slate-600';

export const SUB_STATUS: Record<string, { label: string; color: string }> = {
  trial: { label: 'Trial', color: 'bg-blue-50 text-blue-700' },
  gratuito: { label: 'Gratuito / Cortesia', color: 'bg-brand-50 text-brand-700' },
  ativo: { label: 'Ativo', color: 'bg-brand-50 text-brand-700' },
  pendente: { label: 'Pagamento pendente', color: 'bg-amber-50 text-amber-700' },
  vencido: { label: 'Vencido', color: 'bg-orange-50 text-orange-700' },
  cancelado: { label: 'Cancelado', color: 'bg-slate-100 text-slate-500' },
  bloqueado: { label: 'Bloqueado', color: 'bg-rose-50 text-rose-600' },
};

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const brlInput = (v: string) => {
  const n = parseFloat(v.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
};

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(`${d}T00:00:00`)
    : new Date(d);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const fmtDateTime = (d: string | Date) => `${fmtDate(d)} ${fmtTime(d)}`;

export const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const randomCode = (len = 8) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};
