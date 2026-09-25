import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Phone, Mail, CalendarClock, Wallet, History, Plus, Cake, UserX, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../ctx/AppContext';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Textarea, cx } from '../../components/ui';
import { brl, fmtDate, fmtDateTime } from '../../lib/utils';
import { Crud } from '../../components/Crud';
import { statusColor, statusLabel } from '../../lib/utils';

type Client = {
  id: string;
  name: string;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  birthdate: string | null;
  address: string | null;
  notes: string | null;
};

type Appt = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price: number;
  services: { name: string } | null;
};

export default function Clientes() {
  const { company, toast } = useApp();
  const location = useLocation();
  const autoNew = new URLSearchParams(location.search).has('new');
  const [detail, setDetail] = useState<Client | null>(null);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [allClients, setAllClients] = useState<Client[]>([]);

  useEffect(() => {
    if (!company) return;
    supabase.from('clients').select('id,name,whatsapp,birthdate').eq('company_id', company.id)
      .then(({ data }) => setAllClients((data ?? []) as Client[]));
  }, [company]);

  // Última visita de cada cliente + agendamentos futuros (para detectar sumidos)
  const [lastVisits, setLastVisits] = useState<Record<string, string>>({});
  const [comingBack, setComingBack] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!company) return;
    supabase.from('appointments')
      .select('client_id,starts_at,status')
      .eq('company_id', company.id)
      .order('starts_at', { ascending: false })
      .limit(2000)
      .then(({ data }) => {
        const last: Record<string, string> = {};
        const future = new Set<string>();
        const now = new Date().toISOString();
        for (const a of (data ?? []) as { client_id: string; starts_at: string; status: string }[]) {
          if (a.starts_at >= now) {
            if (!['cancelado', 'faltou'].includes(a.status)) future.add(a.client_id);
            continue;
          }
          if (!last[a.client_id] && a.status === 'concluido') last[a.client_id] = a.starts_at;
        }
        setLastVisits(last);
        setComingBack(future);
      });
  }, [company]);

  // Clientes sumidos: última visita concluída há mais de 30 dias e sem horário futuro
  const missing = useMemo(() => {
    const now = Date.now();
    return allClients
      .filter((c) => {
        if (comingBack.has(c.id)) return false;
        const lv = lastVisits[c.id];
        return lv ? now - new Date(lv).getTime() > 30 * 864e5 : false;
      })
      .map((c) => ({ ...c, last: lastVisits[c.id], days: Math.floor((now - new Date(lastVisits[c.id]).getTime()) / 864e5) }))
      .sort((a, b) => b.days - a.days);
  }, [allClients, lastVisits, comingBack]);

  // Aniversariantes dos próximos 3 dias (incluindo hoje)
  const birthdays = useMemo(() => {
    const today = new Date();
    const list: { name: string; whatsapp: string | null; date: Date; turning: number | null }[] = [];
    for (const c of allClients) {
      if (!c.birthdate) continue;
      const [y, m, d] = c.birthdate.split('-').map(Number);
      for (let i = 0; i <= 3; i++) {
        const day = new Date(today);
        day.setDate(day.getDate() + i);
        if (day.getMonth() + 1 === m && day.getDate() === d) {
          list.push({ name: c.name, whatsapp: c.whatsapp, date: day, turning: day.getFullYear() - y });
          break;
        }
      }
    }
    return list.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [allClients]);

  const birthdayCard = birthdays.length > 0 ? (
    <Card className="mb-4 p-4 bg-pink-50/60 border-pink-100">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-8 h-8 rounded-xl bg-pink-100 text-pink-600 grid place-items-center"><Cake size={16} /></div>
        <div>
          <p className="text-sm font-extrabold text-ink">Aniversariantes</p>
          <p className="text-[11px] text-sub -mt-0.5">Próximos 3 dias</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {birthdays.map((b, i) => {
          const today = new Date();
          const diff = Math.round((new Date(b.date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
          const when = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : b.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          return (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-white/80 border border-pink-100 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-600 grid place-items-center font-extrabold text-xs shrink-0">
                {b.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink truncate">{b.name}</p>
                {b.whatsapp && <p className="text-[11px] text-sub truncate">{b.whatsapp}</p>}
              </div>
              <span className="ml-auto text-xs font-extrabold text-pink-600 shrink-0">
                🎂 {when}{b.turning !== null && b.turning > 0 ? ` · ${b.turning} anos` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  ) : null;

  const missingCard = missing.length > 0 ? (
    <Card className="mb-4 p-4 bg-amber-50/60 border-amber-100">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 grid place-items-center"><UserX size={16} /></div>
        <div>
          <p className="text-sm font-extrabold text-ink">Sumidos há mais de 30 dias</p>
          <p className="text-[11px] text-sub -mt-0.5">{missing.length} cliente{missing.length === 1 ? '' : 's'} sem retorno — chame para voltar</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {missing.slice(0, 10).map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-xl bg-white/80 border border-amber-100 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 grid place-items-center font-extrabold text-xs shrink-0">
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink truncate">{c.name}</p>
              <p className="text-[11px] text-sub truncate">Última visita: {fmtDate(c.last)} ({c.days}d)</p>
            </div>
            {c.whatsapp && (
              <a
                href={`https://wa.me/55${c.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá, ${c.name.split(' ')[0]}! Sentimos sua falta por aqui. Vamos agendar um horário? 😊`)}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 w-8 h-8 rounded-full bg-brand-50 text-brand-600 grid place-items-center hover:bg-brand-100 transition"
                title="Chamar no WhatsApp"
              >
                <Phone size={14} />
              </a>
            )}
          </div>
        ))}
        {missing.length > 10 && (
          <p className="text-[11px] text-sub text-center pt-1">+ {missing.length - 10} outros clientes sumidos</p>
        )}
      </div>
    </Card>
  ) : null;

  const openDetail = useCallback(
    async (c: Client) => {
      setDetail(c);
      setLoadingHist(true);
      const { data } = await supabase
        .from('appointments')
        .select('id,starts_at,ends_at,status,price,services(name)')
        .eq('company_id', company!.id)
        .eq('client_id', c.id)
        .order('starts_at', { ascending: false });
      setAppts(((data ?? []) as unknown) as Appt[]);
      setLoadingHist(false);
    },
    [company],
  );

  const stats = useMemo(() => {
    const done = appts.filter((a) => a.status === 'concluido');
    const spent = done.reduce((s, a) => s + a.price, 0);
    const next = appts.find((a) => new Date(a.starts_at) > new Date() && !['cancelado', 'faltou'].includes(a.status));
    const last = done[0];
    return { total: appts.length, spent, next, last };
  }, [appts]);

  const procedures = useMemo(() => {
    const m = new Map<string, { count: number; last: string }>();
    for (const a of appts) {
      const n = a.services?.name;
      if (!n) continue;
      const cur = m.get(n);
      m.set(n, { count: (cur?.count ?? 0) + 1, last: cur?.last ?? a.starts_at });
    }
    return Array.from(m.entries()).sort((x, y) => y[1].count - x[1].count);
  }, [appts]);

  return (
    <>
      <Crud<Client>
        table="clients"
        title="Clientes"
        subtitle="Organize e conheça seus clientes"
        singular="Cliente"
        searchKeys={['name', 'whatsapp', 'email']}
        orderBy={{ column: 'name' }}
        beforeList={<>{birthdayCard}{missingCard}</>}
        autoNew={autoNew}
        fields={[
          { key: 'name', label: 'Nome', required: true },
          { key: 'whatsapp', label: 'WhatsApp', type: 'phone' },
          { key: 'phone', label: 'Telefone' },
          { key: 'email', label: 'E-mail' },
          { key: 'birthdate', label: 'Data de nascimento (opcional)', type: 'date' },
          { key: 'address', label: 'Endereço' },
          { key: 'notes', label: 'Observações' },
        ]}
        renderRow={(c) => <ClientRow c={c} onOpen={() => openDetail(c)} />}
      />

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name} wide>
        {detail && (
          <div>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat icon={<CalendarClock size={16} />} label="Agendamentos" value={String(stats.total)} />
              <MiniStat icon={<Wallet size={16} />} label="Gastos" value={brl(stats.spent)} />
              <MiniStat icon={<History size={16} />} label="Último" value={stats.last ? fmtDate(stats.last.starts_at) : '—'} />
            </div>
            {stats.next && (
              <Card className="mt-3 p-4 bg-brand-50/50 border-brand-100">
                <p className="text-xs font-bold text-brand-700 uppercase">Próximo atendimento</p>
                <p className="text-sm font-bold text-ink mt-0.5">{fmtDateTime(stats.next.starts_at)} · {stats.next.services?.name}</p>
              </Card>
            )}
            <div className="mt-4 space-y-1.5 text-sm text-slate-600">
              {detail.whatsapp && <p className="flex items-center gap-2"><Phone size={15} className="text-slate-400" /> {detail.whatsapp}</p>}
              {detail.email && <p className="flex items-center gap-2"><Mail size={15} className="text-slate-400" /> {detail.email}</p>}
            </div>
            {procedures.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-bold text-sub uppercase tracking-wide mb-2">Procedimentos realizados</p>
                <div className="flex flex-wrap gap-2">
                  {procedures.map(([name, info]) => (
                    <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
                      <Sparkles size={12} className="text-brand-600" />
                      <span className="text-xs font-bold text-ink">{name}</span>
                      <span className="text-[10px] font-extrabold text-brand-600">×{info.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs font-bold text-sub uppercase tracking-wide mt-6 mb-2">Histórico</p>
            {loadingHist ? (
              <p className="text-sm text-sub py-4">Carregando...</p>
            ) : appts.length === 0 ? (
              <p className="text-sm text-sub py-4">Nenhum atendimento registrado.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {appts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink truncate">{a.services?.name ?? '—'}</p>
                      <p className="text-xs text-sub">{fmtDateTime(a.starts_at)}</p>
                    </div>
                    <Badge className={statusColor(a.status)}>{statusLabel(a.status)}</Badge>
                    <span className="text-sm font-bold text-ink shrink-0">{brl(a.price)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-3 text-center">
      <div className="mx-auto w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">{icon}</div>
      <p className="text-sm font-extrabold text-ink mt-1.5 truncate">{value}</p>
      <p className="text-[10px] font-semibold text-sub uppercase">{label}</p>
    </Card>
  );
}

function ClientRow({ c, onOpen }: { c: Client; onOpen: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [lastService, setLastService] = useState<string | null>(null);
  useEffect(() => {
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', c.id)
      .then(({ count }) => setCount(count ?? 0));
    supabase
      .from('appointments')
      .select('starts_at, services(name)')
      .eq('client_id', c.id)
      .order('starts_at', { ascending: false })
      .limit(1)
      .then(({ data }) => setLastService(((data?.[0] as unknown as { services?: { name?: string } | null } | undefined)?.services?.name) ?? null));
  }, [c.id]);

  const initials = c.name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <button onClick={onOpen} className="w-full text-left">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center font-bold text-sm shrink-0">
          {initials || c.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-ink truncate leading-tight">{c.name}</p>
          <p className="text-xs text-sub truncate">{c.whatsapp || c.email || '—'}</p>
          {lastService && <p className="text-[11px] text-brand-600 font-semibold truncate">✨ {lastService}</p>}
        </div>
        <span className="text-xs font-semibold text-slate-400 shrink-0 bg-slate-50 px-2 py-1 rounded-lg">{count ?? '…'}</span>
      </div>
    </button>
  );
}
