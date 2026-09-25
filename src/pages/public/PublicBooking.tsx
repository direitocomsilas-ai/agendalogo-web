import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AtSign, Phone, MapPin, ChevronLeft, Clock, User, CalendarDays, CalendarX2,
  CheckCircle2, Loader2, Copy, PiggyBank, QrCode,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button, Card, Field, Input, cx } from '../../components/ui';
import { PhoneInput, waIntlDigits } from '../../components/PhoneInput';
import { brl, fmtDate, WEEKDAYS } from '../../lib/utils';
// @ts-ignore — pacote sem tipos oficiais
import QRCode from 'qrcode';

type Company = {
  id: string; name: string; slug: string; category: string; description: string | null;
  whatsapp: string | null; instagram: string | null; address: string | null; city: string | null; state: string | null;
  logo_url: string | null; photo_url: string | null; cover_type: string; cover_color: string; cover_url: string | null;
  deposit_enabled?: boolean | null; deposit_amount?: number | null;
  deposit_pix_key?: string | null; deposit_pix_name?: string | null; deposit_pix_city?: string | null; deposit_pix_type?: string | null;
};
type Section = { id: string; name: string };
type Service = { id: string; section_id: string | null; name: string; description: string | null; price: number; duration_min: number; active: boolean };
type Prof = { id: string; name: string; specialty: string | null; photo_url: string | null; status: string };
type SP = { service_id: string; professional_id: string };
type Hours = { weekday: number; is_open: boolean; start_time: string; end_time: string };

type Step = 0 | 1 | 2 | 3 | 4 | 5; // serviço, profissional, data, dados, pagamento, sucesso

type PixCharge = { ref: string; amount: number; qr_code: string; qr_code_base64: string; expires_at: string };

// ---------- BR Code (PIX copia e cola estático da chave do profissional) ----------
const emv = (id: string, value: string) => id + String(value.length).padStart(2, '0') + value;
const crc16 = (s: string) => {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};
const emvText = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase();
// A chave é usada exatamente como cadastrada; apenas o tipo "telefone"
// recebe o prefixo +55 (padrão do BR Code para chave celular).
const pixKeyNormalize = (k: string, type: string | null | undefined) => {
  const t = k.trim();
  if (type === 'telefone') {
    const d = t.replace(/\D/g, '');
    if (d.startsWith('55') && d.length >= 12) return '+' + d;
    return '+55' + d;
  }
  return t;
};
const pixPayload = (key: string, type: string | null | undefined, name: string, city: string, amount: number, txid: string) => {
  const mai = emv('26', emv('00', 'br.gov.bcb.pix') + emv('01', pixKeyNormalize(key, type)));
  const base = emv('00', '01') + mai + emv('52', '0000') + emv('53', '986')
    + (amount > 0 ? emv('54', amount.toFixed(2)) : '')
    + emv('58', 'BR') + emv('59', (emvText(name) || 'RECEBEDOR').slice(0, 25))
    + emv('60', (emvText(city) || 'BRASIL').slice(0, 15))
    + emv('62', emv('05', (txid.replace(/[^A-Za-z0-9]/g, '') || '***').slice(0, 25)))
    + '6304';
  return base + crc16(base);
};

export default function PublicBooking() {
  const { slug } = useParams();
  const [company, setCompany] = useState<Company | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [links, setLinks] = useState<SP[]>([]);
  const [hours, setHours] = useState<Hours[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowOnline, setAllowOnline] = useState<boolean | null>(null);

  const [step, setStep] = useState<Step>(0);
  const [service, setService] = useState<Service | null>(null);
  const [prof, setProf] = useState<Prof | null>(null);
  const [date, setDate] = useState<string>('');
  const [time, setTime] = useState<string>('');
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [form, setForm] = useState({ name: '', whatsapp: '', email: '' });
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState('');
  const [apptId, setApptId] = useState<string | null>(null);
  const [charge, setCharge] = useState<PixCharge | null>(null);
  const [directPix, setDirectPix] = useState<{ payload: string; qr: string } | null>(null);
  const [payNote, setPayNote] = useState('');
  const [pixCopied, setPixCopied] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from('companies').select('*').eq('slug', slug).maybeSingle();
      if (!c) { setNotFound(true); setLoading(false); return; }
      setCompany(c as Company);
      // Registra o clique no link (1 por sessão, para não contar recargas)
      const clickKey = `link_click_${slug}`;
      try {
        if (!sessionStorage.getItem(clickKey)) {
          sessionStorage.setItem(clickKey, '1');
          supabase.rpc('link_click_log', { p_slug: slug, p_referrer: document.referrer || null }).then(() => {}, () => {});
        }
      } catch { /* ignora */ }
      const [st, sv, ss, p, sp, h] = await Promise.all([
        supabase.rpc('public_booking_settings', { p_slug: slug }),
        supabase.from('services').select('*').eq('company_id', c.id).eq('active', true).order('position'),
        supabase.from('service_sections').select('*').eq('company_id', c.id).order('position'),
        supabase.from('professionals').select('id,name,specialty,photo_url,status').eq('company_id', c.id).eq('status', 'active').order('position'),
        supabase.from('service_professionals').select('service_id,professional_id'),
        supabase.from('business_hours').select('weekday,is_open,start_time,end_time').eq('company_id', c.id).order('weekday'),
      ]);
      setAllowOnline(!!(st?.data as { allow_online?: boolean } | null)?.allow_online);
      setServices(((sv.data ?? []) as Service[]).filter((s) => s.active));
      setSections((ss.data ?? []) as Section[]);
      setProfs((p.data ?? []) as Prof[]);
      setLinks((sp.data ?? []) as SP[]);
      setHours((h.data ?? []) as Hours[]);
      setLoading(false);
    })();
  }, [slug]);

  const nextDays = useMemo(() => {
    return Array.from({ length: 21 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  const loadSlots = useCallback(async (d: string) => {
    if (!d || !service || !prof || !company) return;
    setSlotsLoading(true);
    const { data } = await supabase.rpc('public_slots', {
      p_slug: company.slug, p_service_id: service.id, p_professional_id: prof.id, p_date: d,
    });
    setSlots((data ?? []) as string[]);
    setSlotsLoading(false);
  }, [company, service, prof]);

  useEffect(() => { loadSlots(date); }, [date, loadSlots]);

  const availableProfs = useMemo(
    () => (service ? profs.filter((p) => links.some((l) => l.service_id === service.id && l.professional_id === p.id)) : profs),
    [profs, links, service],
  );

  const depositNeeded = !!(company?.deposit_enabled && Number(company?.deposit_amount) > 0);

  const createPayment = async (appointmentId: string) => {
    try {
      const r = await fetch('/api/booking-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: company!.slug, appointment_id: appointmentId, client_name: form.name.trim(), client_whatsapp: form.whatsapp.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.status === 'aprovado') { setStep(5); return; }
      if (!r.ok) {
        // Sinal é opcional: qualquer falha (profissional não conectado, etc.) segue para o sucesso
        setPayNote(j?.error === 'pro_not_connected'
          ? 'Este profissional ainda não ativou o pagamento online. Você pode pagar o sinal direto no atendimento.'
          : 'Não foi possível gerar o PIX agora. Você pode pagar o sinal direto no atendimento.');
        setStep(5);
        return;
      }
      setCharge({ ref: j.ref, amount: Number(j.amount), qr_code: j.qr_code, qr_code_base64: j.qr_code_base64, expires_at: j.expires_at });
    } catch {
      setPayNote('Não foi possível gerar o PIX agora. Você pode pagar o sinal direto no atendimento.');
      setStep(5);
    }
  };

  const book = async () => {
    if (!form.name.trim() || !form.whatsapp.trim()) { setError('Informe seu nome e WhatsApp.'); return; }
    setBooking(true);
    setError('');
    const startsAt = new Date(`${date}T${time}:00`);
    const bookingParams = {
      p_slug: company!.slug,
      p_service_id: service!.id,
      p_professional_id: prof!.id,
      p_start: startsAt.toISOString(),
      p_name: form.name.trim(),
      p_whatsapp: form.whatsapp.trim(),
      p_email: form.email.trim(),
    };
    const pixKey = (company?.deposit_pix_key ?? '').trim();
    if (depositNeeded && pixKey) {
      // Sinal obrigatório: o agendamento SÓ é criado após o cliente
      // informar que pagou o PIX (etapa 4). Nada é reservado antes.
      try {
        const txid = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/[^a-zA-Z0-9]/g, '');
        const payload = pixPayload(
          pixKey,
          company?.deposit_pix_type,
          (company?.deposit_pix_name ?? '').trim() || company!.name,
          (company?.deposit_pix_city ?? '').trim(),
          Number(company!.deposit_amount) || 0,
          txid,
        );
        const qr = await QRCode.toDataURL(payload, { margin: 1, width: 360 });
        setDirectPix({ payload, qr });
        setStep(4);
      } catch {
        setPayNote('Não foi possível gerar o PIX agora. Você pode pagar o sinal direto no atendimento.');
        setStep(5);
      } finally {
        setBooking(false);
      }
      return;
    }
    const { data: appt, error: err } = await supabase.rpc('public_book', bookingParams);
    setBooking(false);
    if (err) { setError(err.message.includes('Horário indisponível') ? 'Ops! Este horário acabou de ser preenchido. Escolha outro.' : 'Erro: ' + err.message); setStep(2); return; }
    setApptId(appt ?? null);
    if (depositNeeded && appt) { setStep(4); createPayment(appt); }
    else setStep(5);
  };

  // Cliente informou que pagou o PIX: agora sim o agendamento é criado
  const confirmPixPaid = async () => {
    if (!directPix || !company || !service || !prof) return;
    setBooking(true);
    setError('');
    const startsAt = new Date(`${date}T${time}:00`);
    const { data: appt, error: err } = await supabase.rpc('public_book', {
      p_slug: company.slug,
      p_service_id: service.id,
      p_professional_id: prof.id,
      p_start: startsAt.toISOString(),
      p_name: form.name.trim(),
      p_whatsapp: form.whatsapp.trim(),
      p_email: form.email.trim(),
    });
    setBooking(false);
    if (err) { setError(err.message.includes('Horário indisponível') ? 'Ops! Este horário acabou de ser preenchido enquanto você pagava. Escolha outro horário e refaça o pagamento ou apresente o comprovante.' : 'Erro: ' + err.message); setStep(2); return; }
    setApptId(appt ?? null);
    supabase.rpc('deposit_paid_notify', {
      p_slug: company.slug,
      p_name: form.name.trim(),
      p_amount: Number(company.deposit_amount) || 0,
    }).then(() => {}, () => {});
    setDirectPix(null);
    setPayNote('Aviso de pagamento enviado! O profissional vai confirmar o recebimento do sinal e garantir seu horário.');
    setStep(5);
  };

  // Polling do pagamento do sinal
  useEffect(() => {
    if (step !== 4 || !charge?.ref) return;
    const id = window.setInterval(async () => {
      try {
        const r = await fetch('/api/booking-pay/status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: charge.ref }),
        });
        const j = await r.json().catch(() => ({}));
        if (j?.status === 'aprovado') {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setStep(5);
        }
      } catch { /* segue tentando */ }
    }, 4000);
    pollRef.current = id;
    return () => window.clearInterval(id);
  }, [step, charge?.ref]);

  const skipPayment = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
    setPayNote('Seu agendamento está confirmado! Lembre-se de pagar o sinal no atendimento.');
    setCharge(null);
    setStep(5);
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-sub"><Loader2 className="animate-spin text-brand-500" size={30} /></div>;
  if (notFound || !company) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Card className="p-10 text-center max-w-sm">
          <h1 className="text-xl font-extrabold text-ink">Página não encontrada</h1>
          <p className="text-sm text-sub mt-2">Este link de agendamento não existe ou foi desativado.</p>
        </Card>
      </div>
    );
  }

  // Agendamento online desativado pelo profissional: mostra a página, mas sem o fluxo de reserva
  if (allowOnline === false) {
    const closedCover = company.cover_type === 'image' && company.cover_url
      ? { background: `center/cover url(${company.cover_url})` }
      : { background: company.cover_color || '#059669' };
    return (
      <div className="min-h-screen bg-slate-50 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="h-36 sm:h-48" style={closedCover} />
        <div className="max-w-2xl mx-auto px-4">
          <Card className="-mt-12 p-6 relative text-center">
            <div className="relative w-20 h-20 -mt-14 mb-3 mx-auto">
              {(company.logo_url || company.photo_url) && (
                <div className="absolute -inset-[3px] rounded-full animate-[spin_3.5s_linear_infinite]"
                  style={{ background: 'conic-gradient(from 0deg, #059669, #3b82f6, #f59e0b, #ef4444, #a855f7, #06b6d4, #059669)' }} />
              )}
              <div className="absolute inset-0 rounded-full bg-white shadow-md grid place-items-center overflow-hidden ring-2 ring-white">
                {company.logo_url || company.photo_url
                  ? <img src={(company.logo_url || company.photo_url) ?? undefined} alt={company.name} className="w-full h-full object-cover" />
                  : <span className="text-3xl font-extrabold text-brand-600">{company.name.charAt(0)}</span>}
              </div>
            </div>
            <h1 className="text-2xl font-extrabold text-ink">{company.name}</h1>
            <p className="text-xs font-bold text-brand-600 uppercase tracking-wide mt-0.5">{company.category}</p>
            <div className="mt-6 rounded-2xl bg-amber-50 border border-amber-100 p-6">
              <CalendarX2 size={32} className="mx-auto text-amber-600" />
              <p className="font-extrabold text-amber-900 mt-3">Agendamento online temporariamente indisponível</p>
              <p className="text-sm text-amber-700 mt-1.5">Este negócio não está recebendo agendamentos pelo link no momento. Entre em contato diretamente para agendar.</p>
              {company.whatsapp && (
                <a href={`https://wa.me/${waIntlDigits(company.whatsapp)}`} target="_blank" rel="noreferrer" className="inline-block mt-4">
                  <Button><Phone size={16} /> Falar no WhatsApp</Button>
                </a>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const coverStyle = company.cover_type === 'image' && company.cover_url
    ? { background: `center/cover url(${company.cover_url})` }
    : { background: company.cover_color || '#059669' };

  const steps = ['Serviço', 'Profissional', 'Data e hora', 'Seus dados'];

  return (
    <div className="min-h-screen bg-slate-50 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
      {/* Cabeçalho */}
      <div className="h-36 sm:h-48" style={coverStyle} />
      <div className="max-w-2xl mx-auto px-4">
        <Card className="-mt-12 p-6 relative">
          <div className="relative w-20 h-20 -mt-14 mb-3">
            {(company.logo_url || company.photo_url) && (
              <div className="absolute -inset-[3px] rounded-full animate-[spin_3.5s_linear_infinite]"
                style={{ background: 'conic-gradient(from 0deg, #059669, #3b82f6, #f59e0b, #ef4444, #a855f7, #06b6d4, #059669)' }} />
            )}
            <div className="absolute inset-0 rounded-full bg-white shadow-md grid place-items-center overflow-hidden ring-2 ring-white">
              {company.logo_url || company.photo_url
                ? <img src={(company.logo_url || company.photo_url) ?? undefined} alt={company.name} className="w-full h-full object-cover" />
                : <span className="text-3xl font-extrabold text-brand-600">{company.name.charAt(0)}</span>}
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-ink">{company.name}</h1>
          <p className="text-xs font-bold text-brand-600 uppercase tracking-wide mt-0.5">{company.category}</p>
          {company.description && <p className="text-sm text-sub mt-2">{company.description}</p>}
          <div className="flex flex-wrap gap-2 mt-4">
            {company.instagram && (
              <a href={`https://instagram.com/${company.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-full px-3.5 py-2"><AtSign size={14} /> {company.instagram}</span>
              </a>
            )}
            {company.whatsapp && (
              <a href={`https://wa.me/${waIntlDigits(company.whatsapp)}`} target="_blank" rel="noreferrer">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 bg-brand-50 rounded-full px-3.5 py-2"><Phone size={14} /> {company.whatsapp}</span>
              </a>
            )}
            {company.address && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-full px-3.5 py-2"><MapPin size={14} /> {company.address}{company.city ? `, ${company.city}` : ''}</span>
            )}
          </div>
        </Card>

        {/* Progresso */}
        {step > 0 && step < 4 && (
          <div className="flex items-center gap-2 py-4">
            <button onClick={() => setStep((step - 1) as Step)} className="p-2 -ml-2 rounded-full hover:bg-white text-slate-500"><ChevronLeft size={20} /></button>
            {steps.map((s, i) => (
              <div key={s} className={cx('flex items-center gap-1.5 text-xs font-bold', i < step ? 'text-brand-600' : i === step ? 'text-ink' : 'text-slate-300')}>
                {i > 0 && <span className="text-slate-200">·</span>}
                <span className={cx('w-1.5 h-1.5 rounded-full', i <= step && i < step + 1 ? 'bg-brand-500' : 'bg-slate-200')} />
                <span className="hidden sm:inline">{i + 1}. {s}</span>
              </div>
            ))}
          </div>
        )}

        {/* Etapa 1: serviço */}
        {step === 0 && (
          <div className="fade-up">
            <h2 className="font-extrabold text-ink text-lg mb-3">Escolha um serviço</h2>
            {sections.map((sec) => {
              const list = services.filter((s) => s.section_id === sec.id);
              if (list.length === 0) return null;
              return (
                <div key={sec.id} className="mb-5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">{sec.name}</p>
                  <div className="space-y-2">
                    {list.map((s) => (
                      <button key={s.id} onClick={() => { setService(s); setStep(1); }} className="w-full text-left">
                        <Card className="p-4 flex items-center gap-3 hover:border-brand-200 transition">
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-ink">{s.name}</p>
                            {s.description && <p className="text-xs text-sub truncate">{s.description}</p>}
                            <p className="text-xs text-slate-400 font-semibold mt-1 flex items-center gap-1"><Clock size={11} /> {s.duration_min} min</p>
                          </div>
                          <span className="font-extrabold text-brand-700 shrink-0">{brl(s.price)}</span>
                        </Card>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {services.filter((s) => !s.section_id).length > 0 && (
              <div className="space-y-2">
                {services.filter((s) => !s.section_id).map((s) => (
                  <button key={s.id} onClick={() => { setService(s); setStep(1); }} className="w-full text-left">
                    <Card className="p-4 flex items-center gap-3">
                      <p className="font-bold text-ink flex-1">{s.name}</p>
                      <span className="font-extrabold text-brand-700">{brl(s.price)}</span>
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Etapa 2: profissional */}
        {step === 1 && service && (
          <div className="fade-up">
            <h2 className="font-extrabold text-ink text-lg mb-1">{service.name}</h2>
            <p className="text-sm text-sub mb-4">Escolha o profissional</p>
            <div className="space-y-2">
              {availableProfs.map((p) => (
                <button key={p.id} onClick={() => { setProf(p); setStep(2); }} className="w-full text-left">
                  <Card className="p-4 flex items-center gap-3 hover:border-brand-200 transition">
                    <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center font-extrabold overflow-hidden shrink-0">
                      {p.photo_url ? <img src={p.photo_url} alt={p.name} className="w-full h-full object-cover" /> : p.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{p.name}</p>
                      {p.specialty && <p className="text-xs text-sub">{p.specialty}</p>}
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Etapa 3: data e hora */}
        {step === 2 && (
          <div className="fade-up">
            <h2 className="font-extrabold text-ink text-lg mb-1">Data e horário</h2>
            <p className="text-sm text-sub mb-4">{service?.name} com {prof?.name} · {service?.duration_min} min</p>
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
              {nextDays.map((d) => {
                const iso = d.toISOString().slice(0, 10);
                const closed = !hours.find((h) => h.weekday === d.getDay())?.is_open;
                return (
                  <button
                    key={iso}
                    disabled={closed}
                    onClick={() => { setDate(iso); setTime(''); }}
                    className={cx('shrink-0 w-16 py-3 rounded-2xl text-center transition border',
                      date === iso ? 'bg-brand-600 text-white border-brand-600' : closed ? 'bg-slate-100 text-slate-300 border-transparent' : 'bg-white border-slate-200 text-ink hover:border-brand-300')}
                  >
                    <span className="block text-[10px] font-bold uppercase opacity-70">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()]}</span>
                    <span className="block text-lg font-extrabold">{d.getDate()}</span>
                    <span className="block text-[10px] font-semibold opacity-70">{d.toLocaleDateString('pt-BR', { month: 'short' })}</span>
                  </button>
                );
              })}
            </div>
            {date && (
              <div className="mt-5">
                <p className="text-sm font-bold text-ink mb-2">Horários — {fmtDate(date)}</p>
                {slotsLoading ? (
                  <p className="text-sm text-sub flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Buscando horários...</p>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-slate-400">Nenhum horário disponível neste dia.</p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {slots.map((t) => (
                      <button key={t} onClick={() => setTime(t)}
                        className={cx('py-2.5 rounded-xl text-sm font-bold transition border',
                          time === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-200 text-ink hover:border-brand-300')}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Button size="lg" className="w-full mt-6" disabled={!time} onClick={() => setStep(3)}>
              Continuar
            </Button>
          </div>
        )}

        {/* Etapa 4: dados */}
        {step === 3 && (
          <div className="fade-up">
            <h2 className="font-extrabold text-ink text-lg mb-1">Seus dados</h2>
            <Card className="p-4 mb-4 bg-brand-50/50 border-brand-100">
              <p className="text-sm font-bold text-ink">{service?.name}</p>
              <p className="text-xs text-sub mt-0.5">
                {prof?.name} · {fmtDate(date)} às {time} · {brl(service?.price)}
              </p>
            </Card>
            <div className="space-y-4">
              <Field label="Nome completo">
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Seu nome" />
              </Field>
              <Field label="WhatsApp">
                <PhoneInput value={form.whatsapp} onChange={(v) => setForm((f) => ({ ...f, whatsapp: v }))} />
              </Field>
              <Field label="E-mail (opcional)">
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
              {error && <p className="text-sm font-semibold text-rose-600 bg-rose-50 rounded-2xl px-4 py-3">{error}</p>}
              <Button size="lg" className="w-full" loading={booking} onClick={book}>
                <CalendarDays size={18} /> Confirmar agendamento
              </Button>
            </div>
          </div>
        )}

        {/* Etapa 5: pagamento do sinal */}
        {step === 4 && (
          <div className="fade-up">
            <h2 className="font-extrabold text-ink text-lg mb-1 flex items-center gap-2"><PiggyBank size={20} className="text-brand-600" /> Sinal para confirmar</h2>
            <Card className="p-4 mb-4 bg-brand-50/50 border-brand-100">
              <p className="text-sm font-bold text-ink">{service?.name}</p>
              <p className="text-xs text-sub mt-0.5">
                {prof?.name} · {fmtDate(date)} às {time}
              </p>
            </Card>
            {directPix ? (
              <div className="text-center">
                <p className="text-sm text-sub">Pague {brl(Number(company!.deposit_amount))} via PIX para {company!.name} para garantir seu horário:</p>
                <div className="mt-4 mx-auto w-56 h-56 bg-white rounded-3xl border border-slate-200 shadow-sm grid place-items-center p-3">
                  <img src={directPix.qr} alt="QR Code PIX" className="w-full h-full object-contain" />
                </div>
                <button
                  onClick={async () => { await navigator.clipboard.writeText(directPix.payload); setPixCopied(true); setTimeout(() => setPixCopied(false), 2000); }}
                  className="mt-3 inline-flex max-w-full items-center gap-2 text-xs font-bold text-brand-700 bg-brand-50 rounded-full px-4 py-2.5 hover:bg-brand-100 transition"
                >
                  {pixCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  <span className="truncate">{pixCopied ? 'Código copiado!' : 'Copiar código PIX (copia e cola)'}</span>
                </button>
                <p className="mt-4 text-xs text-slate-400 max-w-xs mx-auto">
                  Pague com o app do seu banco escaneando o QR Code. O agendamento só é concluído após o pagamento.
                </p>
                <Button size="lg" className="mt-4 w-full" loading={booking} onClick={confirmPixPaid}>
                  <CheckCircle2 size={18} /> Já paguei — concluir agendamento
                </Button>
              </div>
            ) : charge ? (
              <div className="text-center">
                <p className="text-sm text-sub">Pague {brl(charge.amount)} via PIX para confirmar seu horário:</p>
                <div className="mt-4 mx-auto w-56 h-56 bg-white rounded-3xl border border-slate-200 shadow-sm grid place-items-center p-3">
                  {charge.qr_code_base64 ? (
                    <img src={`data:image/png;base64,${charge.qr_code_base64}`} alt="QR Code PIX" className="w-full h-full object-contain" />
                  ) : <QrCode size={80} className="text-slate-300" />}
                </div>
                {charge.qr_code && (
                  <button
                    onClick={async () => { await navigator.clipboard.writeText(charge.qr_code); setPixCopied(true); setTimeout(() => setPixCopied(false), 2000); }}
                    className="mt-3 inline-flex max-w-full items-center gap-2 text-xs font-bold text-brand-700 bg-brand-50 rounded-full px-4 py-2.5 hover:bg-brand-100 transition"
                  >
                    {pixCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    <span className="truncate">{pixCopied ? 'Código copiado!' : 'Copiar código PIX (copia e cola)'}</span>
                  </button>
                )}
                <p className="mt-4 text-sm text-sub flex items-center justify-center gap-2">
                  <Loader2 size={15} className="animate-spin" /> Aguardando pagamento...
                </p>
                <p className="text-xs text-slate-400 mt-1">A confirmação é automática assim que o PIX for pago.</p>
                <Button variant="ghost" className="mt-4 text-slate-500" onClick={skipPayment}>
                  Pagar o sinal no atendimento
                </Button>
              </div>
            ) : (
              <div className="text-center py-6">
                <Loader2 size={26} className="animate-spin text-brand-500 mx-auto" />
                <p className="text-sm text-sub mt-3">Gerando seu PIX...</p>
              </div>
            )}
          </div>
        )}

        {/* Sucesso */}
        {step === 5 && (
          <div className="fade-up text-center py-10">
            <div className="mx-auto w-20 h-20 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center">
              <CheckCircle2 size={40} />
            </div>
            <h2 className="mt-5 text-2xl font-extrabold text-ink">Agendamento confirmado!</h2>
            <p className="text-sm text-sub mt-2 max-w-xs mx-auto">
              {service?.name} com {prof?.name} em {fmtDate(date)} às {time}.
              Você receberá a confirmação no WhatsApp.
            </p>
            {payNote && (
              <div className="mt-4 max-w-sm mx-auto rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3">
                <p className="text-xs font-semibold text-amber-700">{payNote}</p>
              </div>
            )}
            <Button variant="secondary" className="mt-6" onClick={() => { setStep(0); setService(null); setProf(null); setDate(''); setTime(''); setForm({ name: '', whatsapp: '', email: '' }); setCharge(null); setDirectPix(null); setPayNote(''); setApptId(null); }}>
              Fazer outro agendamento
            </Button>
          </div>
        )}

        {/* Horários do negócio */}
        {step === 0 && (
          <div className="mt-8">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><User size={12} /> Profissionais</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {profs.map((p) => (
                <span key={p.id} className="text-xs font-bold text-slate-600 bg-white border border-slate-100 rounded-full px-3.5 py-2">{p.name}</span>
              ))}
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Clock size={12} /> Horário de atendimento</p>
            <Card className="p-4 space-y-1.5">
              {hours.map((h) => (
                <div key={h.weekday} className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 font-semibold">{WEEKDAYS[h.weekday]}</span>
                  <span className={cx('font-bold text-xs', h.is_open ? 'text-ink' : 'text-slate-300')}>
                    {h.is_open ? `${h.start_time} – ${h.end_time}` : 'Fechado'}
                  </span>
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
