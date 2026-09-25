-- MIGRATION 15 — dedupe de lembretes por (agendamento, tipo, horário programado)
-- Permite recriar lembretes após reagendamento e não bloqueia reenvios legítimos.
drop index if exists public.ux_mq_appt_type;
create unique index ux_mq_appt_type
  on public.message_queue (appointment_id, type, scheduled_at)
  where appointment_id is not null and type in ('lembrete_24h','lembrete_3h');

create or replace function public.wa_enqueue_appt(p_appt uuid, p_type text, p_scheduled timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
  v_t record;
  v_body text;
  v_dur int;
begin
  if p_scheduled is null then return; end if;

  select a.*, c.name as client_name, c.whatsapp as client_wa, s.name as service_name,
         pr.name as prof_name, co.name as company_name, co.timezone as tz
    into v_appt
    from public.appointments a
    join public.clients c on c.id = a.client_id
    left join public.services s on s.id = a.service_id
    left join public.professionals pr on pr.id = a.professional_id
    join public.companies co on co.id = a.company_id
    where a.id = p_appt;
  if v_appt.company_id is null or coalesce(v_appt.client_wa, '') = '' then return; end if;

  select * into v_t from public.whatsapp_templates
    where company_id = v_appt.company_id and type = p_type and active
    limit 1;
  if v_t is null then return; end if;

  -- Controle anti-duplicidade:
  -- lembretes: bloqueia apenas o MESMO horário programado (reagendamento cria novos)
  if p_type in ('lembrete_24h','lembrete_3h') then
    if exists (
      select 1 from public.message_queue m
      where m.appointment_id = p_appt and m.type = p_type and m.scheduled_at = p_scheduled
        and m.status in ('pendente','processando','enviado')
    ) then return; end if;
  -- cancelamento/reagendamento: só evita acumular envios não concluídos
  elsif p_type in ('cancelamento','reagendamento') then
    if exists (
      select 1 from public.message_queue m
      where m.appointment_id = p_appt and m.type = p_type
        and m.status in ('pendente','processando')
    ) then return; end if;
  -- demais: uma por agendamento
  else
    if exists (
      select 1 from public.message_queue m
      where m.appointment_id = p_appt and m.type = p_type
        and m.status in ('pendente','processando','enviado')
    ) then return; end if;
  end if;

  v_dur := extract(epoch from (v_appt.ends_at - v_appt.starts_at)) / 60;
  v_body := public.wa_render(v_t.body, v_appt.client_name, v_appt.prof_name, v_appt.service_name,
    to_char(v_appt.starts_at at time zone v_appt.tz, 'DD/MM/YYYY'),
    to_char(v_appt.starts_at at time zone v_appt.tz, 'HH24:MI'),
    case
      when v_dur >= 60 then (v_dur / 60)::int || 'h' || lpad((v_dur % 60)::int::text, 2, '0')
      else v_dur::int || ' min'
    end,
    'R$ ' || to_char(v_appt.price, 'FM9999990.00'),
    v_appt.company_name);

  insert into public.message_queue
    (company_id, client_id, appointment_id, professional_id, type, phone, body, status, scheduled_at, next_attempt_at)
  values
    (v_appt.company_id, v_appt.client_id, p_appt, v_appt.professional_id, p_type,
     regexp_replace(v_appt.client_wa, '[^0-9]', '', 'g'), v_body, 'pendente', p_scheduled, p_scheduled)
  on conflict do nothing;
end $$;
