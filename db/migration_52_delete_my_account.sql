-- Migration 52 — Exclusao de conta pelo proprio usuario (requisito Apple 5.1.1(v))
-- Deleta o usuario autenticado: profiles, companies e todos os dados em cascata.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  -- A cascata apaga: profiles -> companies -> todos os dados do negocio
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;
