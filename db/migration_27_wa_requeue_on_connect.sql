-- Migration 27: quando o WhatsApp de uma empresa (re)conectar, as mensagens
-- que falharam por "não conectado" nas últimas 24h voltam para a fila.
create or replace function public.wa_requeue_disconnected(p_secret text, p_company_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  update public.message_queue
    set status = 'pendente', attempts = 0, last_error = '', next_attempt_at = now()
    where company_id = p_company_id
      and status = 'erro'
      and last_error ilike '%não conectado%'
      and created_at > now() - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.wa_requeue_disconnected to anon, authenticated;
