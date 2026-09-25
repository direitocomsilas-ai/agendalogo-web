-- MIGRATION 16 — Modo simples de conexão via QR Code (Baileys)
-- provider: 'cloud' (Cloud API oficial) | 'qr' (QR Code escaneado)

alter table public.wa_sessions add column if not exists provider text not null default 'cloud';

-- ---------- RPCs do servidor para sessões QR ----------
create or replace function public.wa_save_qr_creds(p_secret text, p_session_id uuid, p_data text)
returns void
language plpgsql security definer set search_path = public, app_private as $$
declare v_key text;
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.wa_sessions where id = p_session_id and provider = 'qr') then
    raise exception 'sessão não encontrada';
  end if;
  select k into v_key from app_private.wa_key where id = 1;
  if v_key is null then raise exception 'wa_key ausente'; end if;
  if p_data is null then
    delete from app_private.wa_credentials where session_id = p_session_id;
  else
    insert into app_private.wa_credentials (session_id, token_enc)
    values (p_session_id, extensions.pgp_sym_encrypt(p_data, v_key))
    on conflict (session_id) do update set token_enc = excluded.token_enc;
  end if;
end $$;

create or replace function public.wa_get_qr_creds(p_secret text, p_session_id uuid)
returns text
language plpgsql security definer set search_path = public, app_private as $$
declare v_key text; v_out text;
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.wa_sessions where id = p_session_id and provider = 'qr') then
    raise exception 'sessão não encontrada';
  end if;
  select k into v_key from app_private.wa_key where id = 1;
  select extensions.pgp_sym_decrypt(cr.token_enc, v_key) into v_out
    from app_private.wa_credentials cr where cr.session_id = p_session_id;
  return v_out;
end $$;

create or replace function public.wa_set_qr_status(p_secret text, p_session_id uuid, p_status text, p_phone text, p_error text default '')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  update public.wa_sessions set
    status = p_status,
    display_phone = coalesce(p_phone, display_phone),
    last_error = coalesce(p_error, ''),
    last_connected_at = case when p_status = 'conectado' then now() else last_connected_at end,
    last_checked_at = now(),
    updated_at = now()
    where id = p_session_id and provider = 'qr';
end $$;

-- ---------- RPC do usuário: cria/retoma a sessão QR ----------
create or replace function public.wa_qr_start(p_professional_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid;
  v_sid uuid;
begin
  v_cid := public.wa_my_company();
  if v_cid is null then raise exception 'Sem empresa vinculada'; end if;
  if p_professional_id is not null and not exists (
    select 1 from public.professionals where id = p_professional_id and company_id = v_cid
  ) then raise exception 'Profissional inválido'; end if;

  select id into v_sid from public.wa_sessions
    where company_id = v_cid and professional_id is not distinct from p_professional_id and provider = 'qr';

  if v_sid is null then
    insert into public.wa_sessions (company_id, professional_id, provider, status)
    values (v_cid, p_professional_id, 'qr', 'conectando')
    returning id into v_sid;
  else
    update public.wa_sessions set status = 'conectando', last_error = '', updated_at = now()
      where id = v_sid;
  end if;
  return v_sid;
end $$;
grant execute on function public.wa_qr_start to authenticated;

-- ---------- wa_claim_due atualizado: retorna provider e aceita sessões QR ----------
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
    'phone_number_id', s.phone_number_id, 'session_id', s.id, 'provider', s.provider,
    'token', case when cr.token_enc is null then null else extensions.pgp_sym_decrypt(cr.token_enc, v_key) end
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
  left join app_private.wa_credentials cr on cr.session_id = s.id;

  -- mensagens reclamadas sem sessão conectada voltam pra fila
  update public.message_queue m set status = 'pendente', next_attempt_at = now() + interval '10 minutes'
    where m.status = 'processando'
      and not exists (
        select 1 from public.wa_sessions s
        where s.company_id = m.company_id and s.status = 'conectado'
          and (s.professional_id = m.professional_id or s.professional_id is null)
      );

  return v_out;
end $$;
