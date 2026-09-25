-- Migration 26: resolve company_id de uma sessão QR (o id interno da sessão
-- é wa_sessions.id, que NÃO é o company_id — o Call Blocker usava o id errado).
create or replace function public.wa_qr_company_id(p_secret text, p_session_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select rpc_secret from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  return (select company_id from public.wa_sessions where id = p_session_id);
end $$;

grant execute on function public.wa_qr_company_id to anon, authenticated;
