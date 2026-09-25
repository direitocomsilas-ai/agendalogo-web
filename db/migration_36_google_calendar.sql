-- ============================================================
-- MIGRATION 36 — GOOGLE CALENDAR
-- OAuth por empresa (profissional conecta a própria conta Google),
-- tokens criptografados em app_private, sincronização de agendamentos
-- feita pelo worker do servidor (idempotente).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- CONTAS GOOGLE POR EMPRESA ----------
create table if not exists public.gcal_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  google_email text not null default '',
  calendar_id text not null default 'primary',
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gcal_accounts enable row level security;
create policy gcal_accounts_member on public.gcal_accounts for all to authenticated
  using (company_id in (select my_company_ids()) or is_master())
  with check (company_id in (select my_company_ids()) or is_master());

-- ---------- TOKENS PRIVADOS (criptografados, invisíveis via REST) ----------
create table if not exists app_private.gcal_tokens (
  company_id uuid primary key references public.gcal_accounts(company_id) on delete cascade,
  access_enc bytea,
  refresh_enc bytea,
  expires_at timestamptz
);
revoke all on app_private.gcal_tokens from anon, authenticated;

create table if not exists app_private.gcal_oauth (
  id int primary key default 1,
  client_id text not null default '',
  secret_enc bytea
);
revoke all on app_private.gcal_oauth from anon, authenticated;

-- ---------- CREDENCIAIS OAuth (salvas pelo master) ----------
create or replace function public.gcal_oauth_save(p_client_id text, p_client_secret text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if not is_master() then raise exception 'forbidden'; end if;
  select k into v_key from app_private.wa_key where id = 1;
  if v_key is null then
    v_key := encode(gen_random_bytes(32), 'hex');
    insert into app_private.wa_key (id, k) values (1, v_key) on conflict (id) do nothing;
    select k into v_key from app_private.wa_key where id = 1;
  end if;
  insert into app_private.gcal_oauth (id, client_id, secret_enc)
  values (1, p_client_id, extensions.pgp_sym_encrypt(p_client_secret, v_key))
  on conflict (id) do update set client_id = excluded.client_id, secret_enc = excluded.secret_enc;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gcal_oauth_masked()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r app_private.gcal_oauth%rowtype;
begin
  if not is_master() then raise exception 'forbidden'; end if;
  select * into r from app_private.gcal_oauth where id = 1;
  if r.client_id is null or r.client_id = '' then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'client_id', r.client_id,
    'client_id_masked', left(r.client_id, 8) || '****' || right(r.client_id, 4)
  );
end $$;

-- Credenciais para o servidor (protegido pelo rpc_secret)
create or replace function public.gcal_oauth_for_server(p_secret text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_secret text;
  r app_private.gcal_oauth%rowtype;
begin
  if p_secret is distinct from (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select * into r from app_private.gcal_oauth where id = 1;
  if r.client_id is null or r.client_id = '' then return null; end if;
  select k into v_key from app_private.wa_key where id = 1;
  v_secret := extensions.pgp_sym_decrypt(r.secret_enc, v_key);
  return jsonb_build_object('client_id', r.client_id, 'client_secret', v_secret);
end $$;

-- ---------- TOKENS DA CONTA (salvos pelo servidor durante o OAuth) ----------
create or replace function public.gcal_save_tokens_svc(
  p_secret text, p_user_id uuid, p_email text,
  p_access text, p_refresh text, p_expires_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_company uuid;
begin
  if p_secret is distinct from (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  -- empresa do usuário (dono da empresa)
  select c.id into v_company from companies c where c.owner_id = p_user_id limit 1;
  if v_company is null then raise exception 'empresa não encontrada para o usuário'; end if;

  select k into v_key from app_private.wa_key where id = 1;
  if v_key is null then
    v_key := encode(gen_random_bytes(32), 'hex');
    insert into app_private.wa_key (id, k) values (1, v_key) on conflict (id) do nothing;
    select k into v_key from app_private.wa_key where id = 1;
  end if;

  insert into gcal_accounts (company_id, google_email)
  values (v_company, p_email)
  on conflict (company_id) do update set google_email = excluded.google_email, enabled = true, last_error = '', updated_at = now();

  insert into app_private.gcal_tokens (company_id, access_enc, refresh_enc, expires_at)
  values (v_company, extensions.pgp_sym_encrypt(p_access, v_key), extensions.pgp_sym_encrypt(p_refresh, v_key), p_expires_at)
  on conflict (company_id) do update set access_enc = excluded.access_enc, refresh_enc = excluded.refresh_enc, expires_at = excluded.expires_at;

  return jsonb_build_object('ok', true, 'company_id', v_company);
end $$;

-- Credenciais da conta para o servidor (worker)
create or replace function public.gcal_get_creds(p_secret text, p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_access text;
  v_refresh text;
  a public.gcal_accounts%rowtype;
  t app_private.gcal_tokens%rowtype;
begin
  if p_secret is distinct from (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select * into a from gcal_accounts where company_id = p_company_id and enabled;
  if a.company_id is null then return null; end if;
  select * into t from app_private.gcal_tokens where company_id = p_company_id;
  if t.company_id is null or t.refresh_enc is null then return null; end if;
  select k into v_key from app_private.wa_key where id = 1;
  v_access := extensions.pgp_sym_decrypt(t.access_enc, v_key);
  v_refresh := extensions.pgp_sym_decrypt(t.refresh_enc, v_key);
  return jsonb_build_object(
    'company_id', a.company_id, 'email', a.google_email, 'calendar_id', a.calendar_id,
    'access_token', v_access, 'refresh_token', v_refresh, 'expires_at', t.expires_at
  );
end $$;

-- Servidor atualiza o access token após refresh
create or replace function public.gcal_token_update(p_secret text, p_company_id uuid, p_access text, p_expires_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if p_secret is distinct from (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select k into v_key from app_private.wa_key where id = 1;
  update app_private.gcal_tokens
  set access_enc = extensions.pgp_sym_encrypt(p_access, v_key), expires_at = p_expires_at
  where company_id = p_company_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- DESCONEXÃO (usuário) ----------
create or replace function public.gcal_disconnect()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  delete from gcal_accounts where company_id in (select my_company_ids());
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.gcal_disconnect() to authenticated;
grant execute on function public.gcal_oauth_save(text, text) to authenticated;
grant execute on function public.gcal_oauth_masked() to authenticated;

-- ---------- COLUNAS DE SINCRONIZAÇÃO NOS AGENDAMENTOS ----------
alter table public.appointments
  add column if not exists google_synced_at timestamptz,
  add column if not exists google_starts_at timestamptz,
  add column if not exists google_ends_at timestamptz;

-- ---------- WORKER: agendamentos que precisam sincronizar ----------
create or replace function public.gcal_claim_due(p_secret text, p_limit int default 40)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is distinct from (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(x)
    from (
      select jsonb_build_object(
        'id', ap.id, 'company_id', ap.company_id, 'op',
        case
          when ap.google_event_id is not null and ap.status in ('cancelado','faltou') then 'delete'
          when ap.google_event_id is not null then 'update'
          else 'create'
        end,
        'event_id', ap.google_event_id,
        'starts_at', ap.starts_at, 'ends_at', ap.ends_at,
        'status', ap.status, 'price', ap.price, 'notes', ap.notes,
        'client', coalesce(cl.name, 'Cliente'),
        'professional', coalesce(pf.name, ''),
        'service', coalesce(sv.name, 'Atendimento')
      ) x
      from appointments ap
      join gcal_accounts g on g.company_id = ap.company_id and g.enabled
      left join clients cl on cl.id = ap.client_id
      left join professionals pf on pf.id = ap.professional_id
      left join services sv on sv.id = ap.service_id
      where ap.starts_at > now() - interval '2 days'
        and (
          -- criar: ativo sem evento
          (ap.google_event_id is null and ap.status in ('agendado','confirmado','em_atendimento'))
          -- atualizar: horário mudou
          or (ap.google_event_id is not null and ap.status in ('agendado','confirmado','em_atendimento')
              and (ap.google_starts_at is distinct from ap.starts_at or ap.google_ends_at is distinct from ap.ends_at))
          -- apagar: cancelado/faltou com evento ainda não removido
          or (ap.google_event_id is not null and ap.status in ('cancelado','faltou') and ap.google_synced_at is null)
        )
      order by ap.starts_at
      limit p_limit
    ) t
  ), '[]'::jsonb);
end $$;

-- WORKER: reporta o resultado de cada operação
create or replace function public.gcal_report(p_secret text, p_id uuid, p_ok boolean, p_event_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ap public.appointments%rowtype;
begin
  if p_secret is distinct from (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select * into ap from appointments where id = p_id;
  if ap.id is null then return jsonb_build_object('ok', false); end if;

  if p_ok then
    if ap.status in ('cancelado','faltou') then
      -- evento removido
      update appointments set google_event_id = null, google_synced_at = now(),
        google_starts_at = null, google_ends_at = null where id = p_id;
    else
      update appointments set google_event_id = p_event_id, google_synced_at = now(),
        google_starts_at = starts_at, google_ends_at = ends_at where id = p_id;
    end if;
  else
    -- falha: tenta de novo no próximo ciclo (google_synced_at continua null)
    update appointments set google_synced_at = null where id = p_id and google_event_id is not null and google_synced_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Sync em lote concluído: marca last_sync_at / erro da conta
create or replace function public.gcal_account_ping(p_secret text, p_company_id uuid, p_error text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is distinct from (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  update gcal_accounts set last_sync_at = now(), last_error = p_error, updated_at = now()
  where company_id = p_company_id;
  return jsonb_build_object('ok', true);
end $$;
