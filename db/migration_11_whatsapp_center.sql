-- ============================================================
-- MIGRATION 11 — CENTRAL DO WHATSAPP (WhatsApp Cloud API oficial)
-- Sessões por empresa/profissional, credenciais criptografadas em
-- schema privado, fila com tentativas/backoff e triggers de agenda.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- SESSÕES (sem token; credencial vive em app_private) ----------
create table public.wa_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete cascade,
  phone_number_id text not null default '',
  waba_id text not null default '',
  display_phone text not null default '',
  verified_name text not null default '',
  status text not null default 'desconectado' check (status in ('desconectado','conectando','conectado')),
  last_connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- um número por empresa OU por profissional
create unique index ux_wa_sessions_company_prof
  on public.wa_sessions (company_id, coalesce(professional_id::text, 'all'));
create index ix_wa_sessions_company on public.wa_sessions (company_id);

alter table public.wa_sessions enable row level security;
create policy wa_sessions_member on public.wa_sessions for all to authenticated
  using (company_id in (select my_company_ids()) or is_master())
  with check (company_id in (select my_company_ids()) or is_master());

-- ---------- CREDENCIAIS PRIVADAS (invisíveis via API/REST) ----------
create schema if not exists app_private;
revoke all on schema app_private from anon, authenticated;

create table if not exists app_private.wa_key (
  id int primary key default 1,
  k text not null
);
revoke all on app_private.wa_key from anon, authenticated;

create table if not exists app_private.wa_credentials (
  session_id uuid primary key references public.wa_sessions(id) on delete cascade,
  token_enc bytea
);
revoke all on app_private.wa_credentials from anon, authenticated;

-- ---------- TEMPLATES: novos tipos ----------
alter table public.whatsapp_templates drop constraint whatsapp_templates_type_check;
update public.whatsapp_templates set type = 'lembrete_24h' where type = 'lembrete';
alter table public.whatsapp_templates add constraint whatsapp_templates_type_check
  check (type in ('confirmacao','lembrete_24h','lembrete_3h','confirmado','cancelamento','reagendamento','concluido','faltou'));

-- ---------- FILA: tentativas, erro, dedupe ----------
alter table public.message_queue
  add column if not exists professional_id uuid references public.professionals(id) on delete set null,
  add column if not exists attempts int not null default 0,
  add column if not exists last_error text not null default '',
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists provider_message_id text;

alter table public.message_queue drop constraint message_queue_status_check;
alter table public.message_queue add constraint message_queue_status_check
  check (status in ('pendente','processando','enviado','erro','cancelado'));

create index if not exists ix_mq_due on public.message_queue (next_attempt_at) where status = 'pendente';
-- uma mensagem por tipo/agendamento (reagendamento e cancelamento podem repetir)
create unique index if not exists ux_mq_appt_type
  on public.message_queue (appointment_id, type)
  where appointment_id is not null
    and type in ('confirmacao','lembrete_24h','lembrete_3h','confirmado','concluido','faltou');

-- ---------- RENDERIZAÇÃO (variáveis) ----------
create or replace function public.wa_render(
  p_body text, p_client text, p_prof text, p_service text,
  p_date text, p_time text, p_dur text, p_value text, p_business text
)
returns text language plpgsql immutable as $$
declare
  v text := coalesce(p_body, '');
  m text[] := array[
    '{cliente}', coalesce(p_client, ''),
    '{profissional}', coalesce(p_prof, ''),
    '{servico}', coalesce(p_service, ''),
    '{data}', coalesce(p_date, ''),
    '{horario}', coalesce(p_time, ''),
    '{horário}', coalesce(p_time, ''),
    '{duracao}', coalesce(p_dur, ''),
    '{duração}', coalesce(p_dur, ''),
    '{valor}', coalesce(p_value, ''),
    '{empresa}', coalesce(p_business, ''),
    '{negocio}', coalesce(p_business, '')
  ];
  i int;
begin
  for i in 1 .. array_length(m, 1) / 2 loop
    v := replace(v, m[(i - 1) * 2 + 1], m[(i - 1) * 2 + 2]);
  end loop;
  return v;
end $$;

-- ---------- ENFILEIRAR (idempotente) ----------
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

  -- não duplica: já existe pendente/processando/enviada do mesmo tipo
  if exists (
    select 1 from public.message_queue m
    where m.appointment_id = p_appt and m.type = p_type
      and m.status in ('pendente','processando','enviado')
  ) then return; end if;

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

-- ---------- TRIGGER DA AGENDA ----------
create or replace function public.wa_on_appointment_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.starts_at > now() and new.status not in ('cancelado', 'faltou') then
      perform public.wa_enqueue_appt(new.id, 'confirmacao', now());
      perform public.wa_enqueue_appt(new.id, 'lembrete_24h', new.starts_at - interval '24 hours');
      perform public.wa_enqueue_appt(new.id, 'lembrete_3h', new.starts_at - interval '3 hours');
    end if;
    return new;
  end if;

  -- UPDATE: horário alterado → reagendamento + novos lembretes
  if new.starts_at is distinct from old.starts_at then
    update public.message_queue set status = 'cancelado'
      where appointment_id = new.id and status in ('pendente','processando')
        and type in ('lembrete_24h','lembrete_3h');
    if new.starts_at > now() and new.status not in ('cancelado','faltou') then
      perform public.wa_enqueue_appt(new.id, 'lembrete_24h', new.starts_at - interval '24 hours');
      perform public.wa_enqueue_appt(new.id, 'lembrete_3h', new.starts_at - interval '3 hours');
      perform public.wa_enqueue_appt(new.id, 'reagendamento', now());
    end if;
  end if;

  -- UPDATE: status alterado
  if new.status is distinct from old.status then
    if new.status = 'cancelado' then
      update public.message_queue set status = 'cancelado'
        where appointment_id = new.id and status in ('pendente','processando');
      perform public.wa_enqueue_appt(new.id, 'cancelamento', now());
    elsif new.status = 'faltou' then
      update public.message_queue set status = 'cancelado'
        where appointment_id = new.id and status in ('pendente','processando');
      perform public.wa_enqueue_appt(new.id, 'faltou', now());
    elsif new.status = 'confirmado' then
      perform public.wa_enqueue_appt(new.id, 'confirmado', now());
    elsif new.status = 'concluido' then
      perform public.wa_enqueue_appt(new.id, 'concluido', now());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists appointments_wa_sync on public.appointments;
create trigger appointments_wa_sync
  after insert or update on public.appointments
  for each row execute function public.wa_on_appointment_change();

-- ---------- RPCs DO SERVIDOR (protegidas por rpc_secret) ----------
create or replace function public.wa_claim_due(p_secret text, p_limit int default 20)
returns json
language plpgsql security definer set search_path = public, app_private as $$
declare
  v_key text;
  v_out json;
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  if p_secret is null or p_secret = '' then raise exception 'forbidden'; end if;

  -- recupera mensagens travadas em processando (crash do servidor)
  update public.message_queue set status = 'pendente'
    where status = 'processando' and next_attempt_at < now() - interval '5 minutes';

  -- lembretes cujo atendimento já passou não têm mais valor
  update public.message_queue m set status = 'cancelado', last_error = 'atendimento já ocorreu'
    where m.status = 'pendente' and m.type in ('lembrete_24h','lembrete_3h') and m.appointment_id is not null
      and (select a.starts_at from public.appointments a where a.id = m.appointment_id) < now();

  -- pendências muito antigas expiram
  update public.message_queue set status = 'cancelado', last_error = 'expirada'
    where status = 'pendente' and next_attempt_at < now() - interval '7 days';

  select k into v_key from app_private.wa_key where id = 1;
  if v_key is null then raise exception 'wa_key ausente'; end if;

  with claimed as (
    update public.message_queue m
      set status = 'processando', attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
      where m.id in (
        select id from public.message_queue
        where status = 'pendente' and next_attempt_at <= now()
        order by next_attempt_at
        limit greatest(1, least(coalesce(p_limit, 20), 100))
        for update skip locked
      )
      returning m.*
  )
  select coalesce(json_agg(json_build_object(
    'id', c.id, 'company_id', c.company_id, 'phone', c.phone, 'body', c.body,
    'phone_number_id', s.phone_number_id, 'session_id', s.id,
    'token', extensions.pgp_sym_decrypt(cr.token_enc, v_key)
  ) order by c.next_attempt_at), '[]'::json)
  into v_out
  from (
    select c.* from claimed c
  ) c
  join lateral (
    select s.* from public.wa_sessions s
    where s.company_id = c.company_id and s.status = 'conectado'
      and (s.professional_id = c.professional_id or s.professional_id is null)
    order by (s.professional_id = c.professional_id) desc nulls last
    limit 1
  ) s on true
  join app_private.wa_credentials cr on cr.session_id = s.id;

  -- mensagens reclamadas sem sessão conectada voltam pra fila
  update public.message_queue m set status = 'pendente', next_attempt_at = now() + interval '10 minutes'
    where m.status = 'processando'
      and not exists (
        select 1 from public.wa_sessions s
        join app_private.wa_credentials cr on cr.session_id = s.id
        where s.company_id = m.company_id and s.status = 'conectado'
          and (s.professional_id = m.professional_id or s.professional_id is null)
      );

  return v_out;
end $$;

create or replace function public.wa_report_result(p_secret text, p_id uuid, p_ok boolean, p_error text default '', p_provider_id text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  if p_ok then
    update public.message_queue
      set status = 'enviado', sent_at = now(), last_error = '',
          provider_message_id = coalesce(p_provider_id, provider_message_id)
      where id = p_id;
  else
    update public.message_queue
      set status = case when attempts >= 5 then 'erro' else 'pendente' end,
          last_error = coalesce(left(p_error, 500), 'erro desconhecido'),
          next_attempt_at = case when attempts >= 5 then next_attempt_at else now() + (attempts * interval '5 minutes') end
      where id = p_id;
  end if;
end $$;

-- ---------- RPCs DO USUÁRIO (conectar/desconectar) ----------
create or replace function public.wa_my_company()
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cid uuid;
begin
  select company_id into v_cid from public.company_members
    where user_id = auth.uid() and role in ('owner','admin') and status = 'active'
    limit 1;
  if v_cid is null then
    select id into v_cid from public.companies where owner_id = auth.uid();
  end if;
  return v_cid;
end $$;

create or replace function public.wa_save_session(
  p_phone_number_id text, p_waba_id text, p_display_phone text,
  p_verified_name text, p_token text, p_professional_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public, app_private as $$
declare
  v_cid uuid;
  v_sid uuid;
  v_key text;
begin
  if coalesce(trim(p_phone_number_id), '') = '' or coalesce(trim(p_token), '') = '' then
    raise exception 'Informe Phone Number ID e Access Token';
  end if;
  v_cid := public.wa_my_company();
  if v_cid is null then raise exception 'Sem empresa vinculada'; end if;
  if p_professional_id is not null and not exists (
    select 1 from public.professionals where id = p_professional_id and company_id = v_cid
  ) then raise exception 'Profissional inválido'; end if;

  select k into v_key from app_private.wa_key where id = 1;
  if v_key is null then raise exception 'wa_key ausente'; end if;

  select id into v_sid from public.wa_sessions
    where company_id = v_cid and professional_id is not distinct from p_professional_id;

  if v_sid is null then
    insert into public.wa_sessions (company_id, professional_id, phone_number_id, waba_id, display_phone, verified_name, status, last_connected_at, last_checked_at)
    values (v_cid, p_professional_id, p_phone_number_id, coalesce(p_waba_id,''), coalesce(p_display_phone,''), coalesce(p_verified_name,''), 'conectado', now(), now())
    returning id into v_sid;
  else
    update public.wa_sessions set
      phone_number_id = p_phone_number_id, waba_id = coalesce(p_waba_id,''),
      display_phone = coalesce(p_display_phone,''), verified_name = coalesce(p_verified_name,''),
      status = 'conectado', last_connected_at = now(), last_checked_at = now(), last_error = '', updated_at = now()
      where id = v_sid;
  end if;

  insert into app_private.wa_credentials (session_id, token_enc)
  values (v_sid, extensions.pgp_sym_encrypt(p_token, v_key))
  on conflict (session_id) do update set token_enc = excluded.token_enc;

  return v_sid;
end $$;
grant execute on function public.wa_save_session to authenticated;

create or replace function public.wa_disconnect(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public, app_private as $$
declare v_cid uuid;
begin
  v_cid := public.wa_my_company();
  if v_cid is null then raise exception 'Sem empresa vinculada'; end if;
  if not exists (select 1 from public.wa_sessions where id = p_session_id and company_id = v_cid) then
    raise exception 'Sessão não encontrada';
  end if;
  delete from app_private.wa_credentials where session_id = p_session_id;
  update public.wa_sessions
    set status = 'desconectado', phone_number_id = '', display_phone = '', verified_name = '', updated_at = now()
    where id = p_session_id;
end $$;
grant execute on function public.wa_disconnect to authenticated;

-- ---------- PUBLIC_BOOK: fila agora é gerada pelo trigger ----------
create or replace function public.public_book(p_slug text, p_service_id uuid, p_professional_id uuid, p_start timestamptz, p_name text, p_whatsapp text, p_email text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company record;
  v_service record;
  v_prof record;
  v_settings record;
  v_end timestamptz;
  v_client uuid;
  v_appt uuid;
begin
  if p_start < now() then raise exception 'Horário no passado'; end if;
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_whatsapp),'') = '' then
    raise exception 'Informe nome e WhatsApp';
  end if;

  select * into v_company from public.companies where slug = p_slug and public_enabled;
  if not found then raise exception 'Empresa não encontrada'; end if;

  select * into v_settings from public.company_settings where company_id = v_company.id;
  if v_settings is null or not v_settings.allow_online then raise exception 'Agendamento online desativado'; end if;
  if p_start > now() + make_interval(days => v_settings.max_advance_days) then
    raise exception 'Data fora do período permitido';
  end if;
  if p_start < now() + make_interval(hours => v_settings.min_notice_hours) then
    raise exception 'Agende com pelo menos %h de antecedência', v_settings.min_notice_hours;
  end if;

  select * into v_service from public.services
    where id = p_service_id and company_id = v_company.id and active;
  if not found then raise exception 'Serviço indisponível'; end if;

  select * into v_prof from public.professionals
    where id = p_professional_id and company_id = v_company.id and status = 'active';
  if not found then raise exception 'Profissional indisponível'; end if;
  if not exists (select 1 from public.service_professionals sp
                 where sp.service_id = p_service_id and sp.professional_id = p_professional_id) then
    raise exception 'Profissional não realiza este serviço';
  end if;

  -- Expediente
  if not exists (
    select 1 from public.business_hours bh
    where bh.company_id = v_company.id and bh.weekday = extract(isodow from p_start)::int % 7
      and bh.is_open
      and (p_start at time zone v_company.timezone)::time >= bh.start_time::time
      and ((p_start + make_interval(mins => v_service.duration_min)) at time zone v_company.timezone)::time <= bh.end_time::time
  ) then raise exception 'Fora do horário de atendimento'; end if;

  v_end := p_start + make_interval(mins => v_service.duration_min);

  if exists (
    select 1 from public.appointments a
    where a.professional_id = p_professional_id
      and a.status in ('agendado','confirmado','em_atendimento')
      and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_start, v_end)
  ) then raise exception 'Horário indisponível'; end if;

  -- Cliente: reutiliza existente por WhatsApp
  select id into v_client from public.clients
    where company_id = v_company.id and whatsapp = p_whatsapp limit 1;
  if v_client is null then
    insert into public.clients (company_id, name, whatsapp, email)
    values (v_company.id, p_name, p_whatsapp, p_email) returning id into v_client;
  else
    update public.clients set name = p_name, email = coalesce(nullif(p_email,''), email) where id = v_client;
  end if;

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  values (v_company.id, v_client, p_professional_id, p_service_id, p_start, v_end, 'agendado', v_service.price, 'online')
  returning id into v_appt;

  -- A fila de WhatsApp (confirmação, lembretes 24h/3h) é criada pelo trigger appointments_wa_sync
  return v_appt;
end $$;
