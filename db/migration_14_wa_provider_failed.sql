-- MIGRATION 14 — marca falha de entrega por provider_message_id (webhook Meta)
create or replace function public.wa_mark_provider_failed(p_secret text, p_provider_id text, p_error text default '')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  if p_provider_id is null or p_provider_id = '' then return; end if;
  update public.message_queue
    set status = case when attempts >= 5 then 'erro' else 'pendente' end,
        last_error = coalesce(left(p_error, 500), 'falha na entrega'),
        next_attempt_at = case when attempts >= 5 then next_attempt_at else now() + (attempts * interval '5 minutes') end
    where provider_message_id = p_provider_id and status = 'enviado';
end $$;
