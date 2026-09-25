-- MIGRATION 17 — lista de sessões QR conectadas (para reconexão no boot)
create or replace function public.wa_qr_list(p_secret text)
returns uuid[]
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  return array(
    select id from public.wa_sessions where provider = 'qr' and status = 'conectado'
  );
end $$;
