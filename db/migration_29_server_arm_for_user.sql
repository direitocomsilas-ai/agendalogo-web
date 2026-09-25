-- Migration 29: arme do servidor autorizado por usuário logado.
-- O servidor busca o rpc_secret e as credenciais do Mercado Pago quando QUALQUER
-- usuário autenticado (profissional ou master) abre o app. O segredo viaja apenas
-- servidor <-> banco (JWT do usuário no header); nunca chega ao navegador.
-- Remove o token estático da migration 28 (plano abandonado pelo scanner de secrets).

alter table public.payment_settings drop column if exists server_arm_token;
drop function if exists public.server_arm_get(text);

create or replace function public.server_arm_get_for_user()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
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

revoke all on function public.server_arm_get_for_user() from public, anon;
grant execute on function public.server_arm_get_for_user() to authenticated;
