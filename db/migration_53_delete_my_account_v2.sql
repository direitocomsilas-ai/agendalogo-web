-- Migration 53 — Corrige delete_my_account: limpa dependencias sem cascade
-- Problema: company_members, profiles.referred_by e support_replies bloqueavam
-- a exclusao de contas com dados (erro de FK ao confirmar).
-- Tambem protege a conta demo de ser excluida.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  uemail text;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select email into uemail from auth.users where id = uid;
  if uemail = 'demo.agendalogo@agendez.app' then
    raise exception 'CONTA_DEMO_NAO_PODE_SER_EXCLUIDA';
  end if;

  -- 1. Remove dependencias que nao tem ON DELETE CASCADE
  delete from support_replies where user_id = uid;
  update profiles set referred_by = null where referred_by = uid;
  delete from company_members where user_id = uid;

  -- 2. Apaga o usuario; a cascata remove profiles -> companies -> dados do negocio
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;
