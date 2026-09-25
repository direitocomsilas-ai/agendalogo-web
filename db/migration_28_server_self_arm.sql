-- Migration 28: auto-arme do servidor no boot.
-- O servidor não pode depender de um usuário master estar online para carregar
-- o rpc_secret e as credenciais do Mercado Pago (fila de WhatsApp, bloqueio de
-- chamadas e PIX morrem após cada deploy se dependerem do front).
-- Um token exclusivo do servidor (nunca exposto ao navegador) autoriza a leitura
-- do estado armado via RPC.

alter table public.payment_settings add column if not exists server_arm_token text;

-- token aleatório gerado no banco (não usado pelo fluxo atual; reservado)
update public.payment_settings
  set server_arm_token = md5(random()::text || clock_timestamp()::text)
  where id = 1 and server_arm_token is null;

create or replace function public.server_arm_get(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  if p_token is null or (select server_arm_token from payment_settings where id = 1) is null
     or p_token <> (select server_arm_token from payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object(
    'rpc_secret', rpc_secret,
    'mp_enabled', coalesce(mp_enabled, false),
    'mp_environment', mp_environment,
    'mp_access_token', mp_access_token,
    'mp_webhook_secret', mp_webhook_secret,
    'synced_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) into v from payment_settings where id = 1;
  return v;
end $$;

revoke all on function public.server_arm_get(text) from public;
grant execute on function public.server_arm_get(text) to anon, authenticated;
