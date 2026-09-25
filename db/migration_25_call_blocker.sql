-- MIGRATION 25 — WhatsApp Call Blocker (bloqueio automático de chamadas)
-- Configurações por empresa + log de chamadas recusadas.

create table if not exists public.wa_call_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  block_voice boolean not null default true,
  block_video boolean not null default true,
  send_message boolean not null default true,
  auto_message text not null default 'Olá! No momento não consigo atender ligações. Por favor, envie uma mensagem por aqui e responderei assim que possível. 😊',
  allow_enabled boolean not null default false,
  allowlist jsonb not null default '[]'::jsonb,
  dedupe_hours int not null default 24 check (dedupe_hours in (0,1,3,6,12,24)),
  updated_at timestamptz not null default now()
);

create table if not exists public.wa_call_log (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  call_from text not null,
  kind text not null check (kind in ('voz','video')),
  declined boolean not null default true,
  message_sent boolean not null default false,
  note text default '',
  created_at timestamptz not null default now()
);

create index if not exists wa_call_log_company_recent on public.wa_call_log (company_id, created_at desc);

-- RLS: membro lê/escreve as configurações e lê/apaga o log da própria empresa
alter table public.wa_call_settings enable row level security;
alter table public.wa_call_log enable row level security;

drop policy if exists wa_call_settings_member ON public.wa_call_settings;
create policy wa_call_settings_member ON public.wa_call_settings for all to authenticated
  using (company_id in (select public.my_company_ids()) or public.is_master())
  with check (company_id in (select public.my_company_ids()) or public.is_master());

drop policy if exists wa_call_log_member ON public.wa_call_log;
create policy wa_call_log_member ON public.wa_call_log for select to authenticated
  using (company_id in (select public.my_company_ids()) or public.is_master());
drop policy if exists wa_call_log_member_del ON public.wa_call_log;
create policy wa_call_log_member_del ON public.wa_call_log for delete to authenticated
  using (company_id in (select public.my_company_ids()) or public.is_master());

-- RPCs do servidor (protegidas pelo rpc_secret)
create or replace function public.wa_call_settings_get(p_secret text, p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select to_jsonb(s) into v from public.wa_call_settings s where s.company_id = p_company_id;
  if v is null then
    insert into public.wa_call_settings (company_id) values (p_company_id)
      on conflict (company_id) do nothing;
    select to_jsonb(s) into v from public.wa_call_settings s where s.company_id = p_company_id;
  end if;
  return v;
end $$;

create or replace function public.wa_call_log_insert(
  p_secret text, p_company_id uuid, p_call_from text, p_kind text,
  p_declined boolean, p_message_sent boolean, p_note text default ''
) returns void
language sql security definer set search_path = public as $$
  insert into public.wa_call_log (company_id, call_from, kind, declined, message_sent, note)
  values (p_company_id, p_call_from, p_kind, p_declined, p_message_sent, coalesce(p_note, ''));
$$;

-- Verifica dedupe: já enviou mensagem automática para este contato na janela?
create or replace function public.wa_call_recent_msg(p_secret text, p_company_id uuid, p_call_from text, p_hours int)
returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.wa_call_log
    where company_id = p_company_id and call_from = p_call_from
      and message_sent and created_at > now() - make_interval(hours => greatest(p_hours, 0))
  );
$$;

grant execute on function public.wa_call_settings_get to anon, authenticated;
grant execute on function public.wa_call_log_insert to anon, authenticated;
grant execute on function public.wa_call_recent_msg to anon, authenticated;
