-- MIGRATION 18 — token descriptografado de uma sessão (uso interno do servidor)
create or replace function public.wa_get_token(p_secret text, p_session_id uuid)
returns text
language plpgsql security definer set search_path = public, app_private as $$
declare v_key text; v_out text;
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select k into v_key from app_private.wa_key where id = 1;
  select extensions.pgp_sym_decrypt(cr.token_enc, v_key) into v_out
    from app_private.wa_credentials cr
    join public.wa_sessions s on s.id = cr.session_id
    where cr.session_id = p_session_id and s.provider = 'cloud';
  return v_out;
end $$;
