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
