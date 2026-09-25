-- MIGRATION 19 — expira mensagens sem sessão após o limite de tentativas
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

  -- mensagens reclamadas sem sessão conectada: volta pra fila até o limite de tentativas
  update public.message_queue m set
    status = case when m.attempts >= 5 then 'erro' else 'pendente' end,
    last_error = case when m.attempts >= 5 then 'WhatsApp não conectado para esta empresa' else m.last_error end,
    next_attempt_at = case when m.attempts >= 5 then m.next_attempt_at else now() + interval '10 minutes' end
    where m.status = 'processando'
      and not exists (
        select 1 from public.wa_sessions s
        where s.company_id = m.company_id and s.status = 'conectado'
          and (s.professional_id = m.professional_id or s.professional_id is null)
      );

  return v_out;
end $$;
