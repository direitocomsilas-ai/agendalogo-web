-- ============================================================
-- Migration 43: Sinal (depósito) no link público via Mercado Pago
-- Split: profissional recebe o sinal; plataforma fica com taxa fixa
-- (app_settings.mp_fee, padrão R$ 2,99) via application_fee.
-- Tokens OAuth do profissional ficam criptografados em app_private.
-- ============================================================

-- ---------- Configuração do profissional na empresa ----------
alter table public.companies
  add column if not exists deposit_enabled boolean not null default false,
  add column if not exists deposit_amount numeric not null default 0,
  add column if not exists mp_user_id text,
  add column if not exists mp_connected_at timestamptz;

-- Taxa da plataforma por transação (master)
alter table public.app_settings
  add column if not exists mp_fee numeric not null default 2.99;
update public.app_settings set mp_fee = 2.99 where id = 1 and mp_fee is null;

-- ---------- Tokens OAuth do profissional (app_private, criptografados) ----------
create table if not exists app_private.mp_connect (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  mp_user_id text not null,
  refresh_enc bytea not null,
  access_enc bytea not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
revoke all on app_private.mp_connect from anon, authenticated;

-- ---------- Pagamentos de sinal ----------
create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  client_name text,
  client_whatsapp text,
  amount numeric not null check (amount > 0),
  platform_fee numeric not null default 0,
  status text not null default 'pendente' check (status in ('pendente','aprovado','recusado','cancelado','reembolsado')),
  mp_payment_id text,
  external_ref text not null unique,
  qr_code text,
  qr_code_base64 text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists bp_company on public.booking_payments (company_id, created_at);
create unique index if not exists bp_appt_pending
  on public.booking_payments (appointment_id) where status = 'pendente';
create index if not exists bp_mp_id on public.booking_payments (mp_payment_id);

alter table public.booking_payments enable row level security;
create policy bp_read on public.booking_payments for select to authenticated
  using (company_id in (select public.my_company_ids()) or public.is_master());

-- ============================================================
-- RPCs do servidor (protegidas por rpc_secret)
-- ============================================================

-- Cria (ou reaproveita) a cobrança de sinal do agendamento
create or replace function public.bp_create(
  p_secret text, p_company uuid, p_appointment uuid,
  p_client_name text default '', p_client_whatsapp text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_co record;
  v_fee numeric;
  v_existing record;
  v_ref text;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select * into v_co from public.companies where id = p_company;
  if not found or not v_co.deposit_enabled or not coalesce(v_co.deposit_amount, 0) > 0 then
    raise exception 'sinal desativado';
  end if;
  if not exists (
    select 1 from public.appointments a
    where a.id = p_appointment and a.company_id = p_company
      and a.status = 'agendado' and a.source = 'online'
  ) then raise exception 'agendamento inválido para cobrança'; end if;

  select coalesce(mp_fee, 2.99) into v_fee from public.app_settings where id = 1;

  select * into v_existing from public.booking_payments
    where appointment_id = p_appointment and status = 'pendente';
  if found then
    return jsonb_build_object('ref', v_existing.external_ref, 'amount', v_existing.amount,
      'fee', v_existing.platform_fee, 'status', 'pendente',
      'description', 'Sinal — ' || v_co.name, 'client_name', v_existing.client_name);
  end if;

  v_ref := 'bp-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.booking_payments
    (company_id, appointment_id, client_name, client_whatsapp, amount, platform_fee, external_ref)
  values
    (p_company, p_appointment, nullif(p_client_name, ''), nullif(p_client_whatsapp, ''),
     v_co.deposit_amount, v_fee, v_ref);

  return jsonb_build_object('ref', v_ref, 'amount', v_co.deposit_amount, 'fee', v_fee,
    'status', 'pendente', 'description', 'Sinal — ' || v_co.name,
    'client_name', nullif(p_client_name, ''));
end $$;
grant execute on function public.bp_create to anon, authenticated;

-- Grava QR/ID do PIX retornado pelo Mercado Pago
create or replace function public.bp_set_pix(
  p_secret text, p_ref text, p_mp_id text, p_qr text, p_qr64 text, p_expires timestamptz
)
returns void
language sql security definer set search_path = public as $$
  update public.booking_payments
    set mp_payment_id = p_mp_id, qr_code = p_qr, qr_code_base64 = p_qr64, expires_at = p_expires
    where external_ref = p_ref;
$$;
grant execute on function public.bp_set_pix to anon, authenticated;

-- Consulta por referência (polling público)
create or replace function public.bp_by_ref(p_secret text, p_ref text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select b.*, c.owner_id into v
    from public.booking_payments b join public.companies c on c.id = b.company_id
    where b.external_ref = p_ref;
  if not found then return null; end if;
  return jsonb_build_object('owner_id', v.owner_id, 'mp_payment_id', v.mp_payment_id,
    'status', v.status, 'amount', v.amount, 'company_id', v.company_id);
end $$;
grant execute on function public.bp_by_ref to anon, authenticated;

-- Localiza o dono pelo ID do pagamento MP (webhook)
create or replace function public.bp_by_mp_id(p_secret text, p_mp_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select b.external_ref, c.owner_id, b.status into v
    from public.booking_payments b join public.companies c on c.id = b.company_id
    where b.mp_payment_id = p_mp_id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('owner_id', v.owner_id, 'external_ref', v.external_ref, 'status', v.status);
end $$;
grant execute on function public.bp_by_mp_id to anon, authenticated;

-- Confirma/atualiza status do sinal (idempotente)
create or replace function public.bp_confirm(
  p_secret text, p_mp_payment_id text, p_status text, p_amount numeric default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_owner uuid;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select * into v from public.booking_payments where mp_payment_id = p_mp_payment_id for update;
  if not found then return 'nao_encontrado'; end if;
  if v.status <> 'pendente' then return v.status; end if;

  if p_status = 'approved' then
    update public.booking_payments set status = 'aprovado', paid_at = now() where id = v.id;
    update public.appointments set status = 'confirmado' where id = v.appointment_id;
    insert into public.cash_transactions
      (company_id, kind, origin, ref_type, ref_id, description, amount, occurred_at)
    values
      (v.company_id, 'entrada', 'sinal', 'booking', v.id,
       'Sinal de agendamento' || coalesce(' — ' || v.client_name, ''), v.amount, current_date);
    select c.owner_id into v_owner from public.companies c where c.id = v.company_id;
    if v_owner is not null then
      insert into public.notifications (user_id, type, title, body)
      values (v_owner, 'sinal', '💰 Sinal recebido!',
        'Cliente ' || coalesce(v.client_name, '') || ' pagou o sinal de R$ ' || v.amount::text || '. Agendamento confirmado — você recebe R$ ' || round(v.amount - v.platform_fee, 2)::text || ' líquido (taxa da plataforma R$ ' || v.platform_fee::text || ').');
    end if;
    return 'aprovado';
  end if;

  update public.booking_payments set status = case p_status
      when 'cancelled' then 'cancelado'
      when 'rejected' then 'recusado'
      when 'refunded' then 'reembolsado'
      else 'cancelado' end
    where id = v.id;
  return 'cancelado';
end $$;
grant execute on function public.bp_confirm to anon, authenticated;

-- ---------- OAuth: credenciais e tokens ----------

-- Credenciais do app MP (para o servidor trocar o código OAuth)
create or replace function public.mp_oauth_creds(p_secret text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select mp_client_id, mp_client_secret into v from public.payment_settings where id = 1;
  return jsonb_build_object('client_id', v.mp_client_id, 'client_secret', v.mp_client_secret);
end $$;
grant execute on function public.mp_oauth_creds to anon, authenticated;

-- Salva/atualiza tokens do profissional (criptografados)
create or replace function public.mp_connect_save(
  p_secret text, p_owner uuid, p_mp_user_id text,
  p_refresh text, p_access text, p_expires timestamptz
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select k into v_key from app_private.wa_key where id = 1;
  if v_key is null then raise exception 'chave ausente'; end if;

  insert into app_private.mp_connect (owner_id, mp_user_id, refresh_enc, access_enc, expires_at, updated_at)
  values (p_owner, p_mp_user_id, extensions.pgp_sym_encrypt(p_refresh, v_key),
          extensions.pgp_sym_encrypt(p_access, v_key), p_expires, now())
  on conflict (owner_id) do update set
    mp_user_id = excluded.mp_user_id,
    refresh_enc = excluded.refresh_enc,
    access_enc = excluded.access_enc,
    expires_at = excluded.expires_at,
    updated_at = now();

  update public.companies set mp_user_id = p_mp_user_id, mp_connected_at = now()
    where owner_id = p_owner;
end $$;
grant execute on function public.mp_connect_save to anon, authenticated;

-- Lê tokens descriptografados (somente servidor)
create or replace function public.mp_connect_get(p_secret text, p_owner uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_key text;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select k into v_key from app_private.wa_key where id = 1;
  select * into v from app_private.mp_connect where owner_id = p_owner;
  if not found then return null; end if;
  return jsonb_build_object(
    'mp_user_id', v.mp_user_id,
    'refresh_token', extensions.pgp_sym_decrypt(v.refresh_enc, v_key),
    'access_token', extensions.pgp_sym_decrypt(v.access_enc, v_key),
    'expires_at', v.expires_at);
end $$;
grant execute on function public.mp_connect_get to anon, authenticated;

-- Remove conexão
create or replace function public.mp_connect_clear(p_secret text, p_owner uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  delete from app_private.mp_connect where owner_id = p_owner;
  update public.companies set mp_user_id = null, mp_connected_at = null where owner_id = p_owner;
end $$;
grant execute on function public.mp_connect_clear to anon, authenticated;

-- ---------- Profissional: configura o sinal ----------
create or replace function public.deposit_save_u(p_enabled boolean, p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_co uuid;
begin
  select id into v_co from public.companies where owner_id = auth.uid() limit 1;
  if v_co is null then raise exception 'empresa não encontrada'; end if;
  if p_enabled and (p_amount is null or p_amount < 5) then
    raise exception 'O sinal deve ser de pelo menos R$ 5,00';
  end if;
  update public.companies
    set deposit_enabled = p_enabled, deposit_amount = greatest(coalesce(p_amount, 0), 0)
    where id = v_co;
  return jsonb_build_object('ok', true, 'deposit_enabled', p_enabled, 'deposit_amount', greatest(coalesce(p_amount, 0), 0));
end $$;
grant execute on function public.deposit_save_u to authenticated;
